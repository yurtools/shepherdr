"""Task-local resource samples made during the existing news pass, never by a renderer.

Only numeric OS counters and terminal ownership are retained. The public cache contains
aggregate values, while the private baseline (not a task list) survives separate tick processes.
"""

import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass

INTERVAL = 12                       # shared by scheduler and window/service ticks (normally 15s)
MAX_AGE = 60                        # don't bridge a stopped sampler / suspend / reboot
MAX_PROCESSES = 32768
SCAN_SECONDS = 2
MAX_ROOTS = 512
PUBLIC = ".task-usage.json"
BASELINE = ".task-usage-baseline"    # not returned as part of READ_LISTS


@dataclass(frozen=True)
class Process:
    pid: int
    parent: int
    birth: int                      # exact OS start identity, not just PID
    born_at: int                    # epoch milliseconds (for terminal creation and new-process CPU)
    cpu: float                      # own user + system seconds, NOT waited-for children
    rss: int                        # resident bytes, NOT virtual address space
    group: str = ""                 # cgroup v2 membership, if available


def linux_processes(deadline):
    hz = os.sysconf("SC_CLK_TCK")
    page = os.sysconf("SC_PAGE_SIZE")
    boot = time.time() - time.clock_gettime(time.CLOCK_BOOTTIME)
    rows = {}
    with os.scandir("/proc") as entries:
        for entry in entries:
            if not entry.name.isdecimal():
                continue
            if len(rows) >= MAX_PROCESSES or time.monotonic() > deadline:
                return None
            try:
                with open(entry.path + "/stat") as f:
                    # comm can contain ')' and spaces. Ignore it entirely.
                    fields = f.read().rsplit(")", 1)[1].split()
                pid = int(entry.name)
                birth = int(fields[19])
                group = ""
                try:
                    with open(entry.path + "/cgroup") as f:
                        group = next((line[3:].strip() for line in f if line.startswith("0::")), "")
                    # Exit/reuse between stat and cgroup reads must not assign the replacement's scope.
                    with open(entry.path + "/stat") as f:
                        if int(f.read().rsplit(")", 1)[1].split()[19]) != birth:
                            continue
                except OSError:
                    group = ""
                rows[pid] = Process(pid, int(fields[1]), birth, round((boot + birth / hz) * 1000),
                                    (int(fields[11]) + int(fields[12])) / hz, max(0, int(fields[21])) * page, group)
            except (OSError, ValueError, IndexError):
                continue                 # the process can exit at any point
    return rows


def mac_processes(deadline):
    """One numeric ps to enumerate this user, libproc for exact relationships and counters.

    Darwin's stable PROC_PIDTBSDINFO and RUSAGE_INFO_V0 ABI (sys/proc_info.h and
    sys/resource.h) give microsecond birth and own CPU/RSS, not ps's rounded lstart.
    """
    import ctypes as C

    class BsdInfo(C.Structure):
        _fields_ = [("header", C.c_uint32 * 12), ("names", C.c_char * 48),
                    ("other", C.c_uint32 * 6), ("sec", C.c_uint64), ("usec", C.c_uint64)]

    class Rusage(C.Structure):
        _fields_ = [("uuid", C.c_ubyte * 16)] + [(n, C.c_uint64) for n in
            ("user", "system", "pkg_wakeups", "interrupt_wakeups", "pageins", "wired", "rss", "footprint", "start", "exit")]

    lib = C.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    bsd = lib.proc_pidinfo
    bsd.argtypes = [C.c_int, C.c_int, C.c_uint64, C.c_void_p, C.c_int]
    bsd.restype = C.c_int
    get = lib.proc_pid_rusage
    get.argtypes = [C.c_int, C.c_int, C.c_void_p]
    get.restype = C.c_int
    result = subprocess.run(["ps", "-axo", "pid=,uid="], capture_output=True, text=True, timeout=SCAN_SECONDS)
    if result.returncode:
        return None
    rows = {}
    for line in result.stdout.splitlines():
        if len(rows) >= MAX_PROCESSES or time.monotonic() > deadline:
            return None
        f = line.split()
        if len(f) != 2 or f[1] != str(os.getuid()):
            continue
        try:
            pid = int(f[0])
            before, after, info = BsdInfo(), BsdInfo(), Rusage()
            size = C.sizeof(before)
            if bsd(pid, 3, 0, C.byref(before), size) != size or get(pid, 0, C.byref(info)) or info.exit:
                continue
            if bsd(pid, 3, 0, C.byref(after), size) != size or (before.sec, before.usec) != (after.sec, after.usec):
                continue
            birth = after.sec * 1_000_000 + after.usec
            if after.header[3] != pid or after.header[5] != os.getuid() or not birth:
                continue
            rows[pid] = Process(pid, after.header[4], birth, birth // 1000,
                                (info.user + info.system) / 1e9, info.rss)
        except ValueError:
            continue
    return rows


def processes():
    """One bounded snapshot for all Working tasks on this host, or unavailable."""
    deadline = time.monotonic() + SCAN_SECONDS
    try:
        if sys.platform.startswith("linux"):
            return linux_processes(deadline)
        if sys.platform == "darwin":
            return mac_processes(deadline)
    except (OSError, subprocess.SubprocessError, AttributeError):
        pass
    return None


def scope_cpu(group):
    """Only scopes verified from a task terminal's exact launch unit (never a shared slice).
    The scope's cumulative CPU includes children which exited between samples. An inode change
    invalidates its baseline. RSS uses the same per-process definition on every platform.
    """
    path = os.path.join("/sys/fs/cgroup", group.lstrip("/"))
    try:
        inode = os.stat(path).st_ino
        with open(os.path.join(path, "cpu.stat")) as f:
            usec = next(int(line.split()[1]) for line in f if line.startswith("usage_usec "))
        return [inode, usec / 1e6]
    except (OSError, ValueError, StopIteration):
        return None


def unit_of(k):
    """The existing low_priority() wrapper's unique unit, not any arbitrary scope name."""
    argv = k.get("argv") or []
    if not argv or os.path.basename(argv[0]) != "systemd-run" or "--scope" not in argv:
        return None
    for arg in argv[1:]:
        if arg == "--":
            break
        if re.fullmatch(r"--unit=herdr-[a-zA-Z0-9_.-]+-[0-9a-f]{6}", arg):
            return arg.split("=", 1)[1] + ".scope"
    return None


def scope_of(group, unit):
    parts = group.split("/")
    if unit and unit in parts:
        return "/".join(parts[:parts.index(unit) + 1])
    return None


def in_scope(group, scope):
    return group == scope or group.startswith(scope + "/")


def local_record(k, key):
    """Addresses from another linked host can never be resolved against this host's PIDs."""
    return (k.get("state") == "live" and k.get("address") and "/" not in k["address"]
            and (k.get("labels") or {}).get("herdr.task") == key)


def owned_records(key, task, workers, helpers):
    """The same exact task label as live_agents(), plus its own helper descendants (or
    a reviewer launched by herdr-task and recorded in the task). Never an Assistant.
    """
    from .agents import agent_running, parent_of
    mine = {k["address"]: k for k in workers if local_record(k, key) and agent_running(k)
            and (k.get("labels") or {}).get("herdr.role") not in ("coordinator", "feature", "helper", "reviewer")}
    recorded = {a.get("address") for a in task.get("reviewers") or [] if not a.get("ended")}
    pending = [k for k in [*helpers, *workers] if local_record(k, key) and agent_running(k)
               and k["address"] not in mine and (k.get("labels") or {}).get("herdr.role") in ("reviewer", "helper")]
    for _ in range(len(pending)):
        added = [k for k in pending if parent_of(k) in mine or k["address"] in recorded]
        if not added:
            break
        mine.update((k["address"], k) for k in added)
        pending = [k for k in pending if k["address"] not in mine]
    return list(mine.values())


def aggregate(inputs, rows, previous, at, mono, read_scope=scope_cpu):
    """Attribute each process at most once across all tasks and all roots on one host.

    The terminal's own PID (not a foreground command's PID) covers the execution tree and
    its sibling processes. Validate that the foreground is in that tree, and the process
    was born at terminal creation. A different terminal root bounds each traversal.
    """
    children = {}
    for p in rows.values():
        parent = rows.get(p.parent)
        if parent and parent.pid != p.pid and parent.birth <= p.birth:
            children.setdefault(p.parent, []).append(p.pid)

    def trees(pids, stops=()):
        first = set(pids)
        todo, seen = list(first), set()
        while todo:
            p = todo.pop()
            if p in seen or (p not in first and p in stops):
                continue
            seen.add(p)
            todo.extend(children.get(p, ()))
        return seen

    def tree(pid, stops=()):
        return trees([pid], stops)

    roots, root_keys, unavailable = {}, {}, set()
    root_ids = {}
    prior_ids = previous.get("root_ids") or {}
    for key, records in inputs.items():
        for k in records:
            pid, fg, created = k.get("pid"), (k.get("foreground") or {}).get("pid"), k.get("created_ms")
            p = rows.get(pid)
            addr = k["address"]
            before = prior_ids.get(addr)
            if before and before[0] == created and (not p or before[1:] != [pid, p.birth]):
                # Keep the original identity until the terminal is actually replaced.
                root_ids[addr] = before
                unavailable.add(key)
                continue
            # hc creates its record and the private terminal process at nearly the same time.
            # Reject stale/reused terminal PIDs, as well as foregrounds we cannot verify.
            if not p or not isinstance(created, (int, float)) or abs(p.born_at - created) > 10000 or fg not in tree(pid):
                unavailable.add(key)
                continue
            root_ids[addr] = [created, pid, p.birth]
            token = f"{addr}:{created}:{pid}:{p.birth}"
            roots.setdefault(key, []).append((pid, token, k))
            root_keys.setdefault(pid, set()).add(key)
    owners, scopes, tokens = {}, {}, {}
    for key, rs in roots.items():
        tokens[key] = {token for _, token, _ in rs}
        for pid, token, k in rs:
            if len(root_keys[pid]) != 1:
                unavailable.update(root_keys[pid])
                continue
            branch = tree(pid, root_keys)
            for p in branch:
                owners[p] = key
            unit = unit_of(k)
            # The wrapper's own PID can be outside the scope: use its actual descendants.
            found = {scope_of(rows[p].group, unit) for p in branch} - {None}
            if len(found) == 1:
                scopes.setdefault(found.pop(), set()).add(key)

    # Scope membership preserves ownership when a child was reparented before we ever saw it.
    # A shared/conflicting scope is never charged to any one task.
    scope_members = {scope: set() for scope in scopes}
    for pid, row in rows.items():
        # Only a process's own cgroup ancestry, not one pass per scope over the host.
        group = row.group
        while group:
            if group in scope_members:
                scope_members[group].add(pid)
            group = group.rsplit("/", 1)[0]
    scope_stats, scoped, verified = {}, {}, set()
    for scope, keys in scopes.items():
        # An ancestor counter already includes any nested scope from this same task.
        if any(other != scope and in_scope(scope, other) and keys == owners_of_scope
               for other, owners_of_scope in scopes.items()):
            continue
        members = scope_members[scope]
        if len(keys) != 1 or any(p in owners and owners[p] not in keys for p in members):
            unavailable.update(keys)
            continue
        key = next(iter(keys))
        # Descendants may themselves move into a private nested cgroup or a different group.
        for p in trees(members, root_keys):
            owners.setdefault(p, key)
        verified.add(key)
        stat = read_scope(scope)
        if stat:
            scope_stats.setdefault(key, {})[scope] = stat
            for pid in members:
                scoped[pid] = scope

    prev_tasks = previous.get("tasks") or {}
    elapsed = mono - previous.get("mono", mono)
    valid = 0 < elapsed <= MAX_AGE and abs(at - previous.get("at", at) - elapsed * 1000) < 5000
    # Retain previously observed, still-live orphans ONLY across a continuing active terminal identity.
    # No guessing from names, cwd, inherited env, process group or shared daemons.
    for key, old in prev_tasks.items():
        if not valid or not (set(old.get("roots", [])) & tokens.get(key, set())):
            continue
        orphans = [p.pid for pid, old_p in old.get("members", {}).items()
                   if (p := rows.get(int(pid))) and p.birth == old_p[0] and p.pid not in owners]
        for child in trees(orphans, root_keys):
            owners.setdefault(child, key)

    by_owner = {}
    for pid, key in owners.items():
        by_owner.setdefault(key, []).append(pid)
    result, baselines = {}, {}
    for key in inputs:
        if key in unavailable or not roots.get(key):
            continue
        old = prev_tasks.get(key) or {}
        comparable = valid and set(old.get("roots", [])) == tokens[key]
        members = {str(pid): [rows[pid].birth, rows[pid].cpu, scoped.get(pid)] for pid in by_owner.get(key, [])}
        stats = scope_stats.get(key, {})
        cpu, complete = 0.0, comparable
        for scope, stat in stats.items():
            before = (old.get("scopes") or {}).get(scope)
            if not before or before[0] != stat[0] or stat[1] < before[1]:
                complete = False
            else:
                cpu += stat[1] - before[1]
        for pid, (birth, seconds, scope) in members.items():
            before = (old.get("members") or {}).get(pid)
            if before and before[0] == birth and before[2] != scope:
                complete = False     # migration: can't separate the interval without overlap
            if scope:
                continue             # its scope counter already counts this process
            if before and before[0] == birth and seconds >= before[1]:
                cpu += seconds - before[1]
            elif rows[int(pid)].born_at >= previous.get("at", at):
                cpu += seconds       # born during the interval; its whole own CPU is new
            else:
                complete = False
        # A disappeared scope's final counter is unavailable. Don't report an incomplete CPU total as zero.
        if set(old.get("scopes") or {}) - set(stats):
            complete = False
        result[key] = {"at": at, "cpu_pct": round(100 * cpu / elapsed, 1) if complete else None,
                       "rss_bytes": sum(rows[int(pid)].rss for pid in members),
                       "coverage": "scope+tree" if key in verified else "tree",
                       "terminals": {k["address"]: k["created_ms"] for _, _, k in roots[key]},
                       "workers": {k["address"]: k["created_ms"] for _, _, k in roots[key]
                                   if (k.get("labels") or {}).get("herdr.role") not in ("reviewer", "helper")}}
        baselines[key] = {"roots": sorted(tokens[key]), "members": members, "scopes": stats}
    return result, {"at": at, "mono": mono, "tasks": baselines, "root_ids": root_ids}


def read(path):
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write(path, data):
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump(data, f, separators=(",", ":"))
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def sample_pass(store, inputs):
    """Called under the existing tick lock, for a full machine pass only. No worker or timer.
    A cache write notifies the existing list watchers once, even if multiple UIs are open.
    """
    state_path, public_path = os.path.join(store, BASELINE), os.path.join(store, PUBLIC)
    if not inputs:
        for path in (state_path, public_path):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
        return
    previous = read(state_path)
    boot = None
    if sys.platform.startswith("linux"):
        try:
            with open("/proc/sys/kernel/random/boot_id") as f:
                boot = f.read().strip()
        except OSError:
            pass
    if previous.get("boot") != boot:
        previous = {}
    mono, at = time.monotonic(), round(time.time() * 1000)
    if 0 <= mono - previous.get("mono", -INTERVAL) < INTERVAL and abs(at - previous.get("at", 0)) < MAX_AGE * 1000:
        return
    rows = processes() if sum(map(len, inputs.values())) <= MAX_ROOTS else None
    result, baseline = aggregate(inputs, rows or {}, previous, at, mono)
    write(state_path, dict(baseline, boot=boot))
    write(public_path, result)
