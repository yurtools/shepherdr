"""Task usage: real isolated workloads plus deterministic scope and lifecycle cases."""
import home_guard  # noqa: F401
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/tasks/bin"))
from herdr_task import task_usage as U


def record(address, pid, created, key="repo#1", parent=None, role="worker", unit=None):
    return {"address": address, "pid": pid, "foreground": {"pid": pid, "name": "python3"},
            "state": "live", "created_ms": created, "parent": parent,
            "labels": {"herdr.task": key, "herdr.role": role},
            "argv": ["systemd-run", "--user", "--scope", f"--unit={unit}", "--", "python3"] if unit else ["python3"]}


def proc(pid, parent, birth=100, cpu=0, rss=10, group="", born_at=1000):
    return U.Process(pid, parent, birth, born_at, cpu, rss, group)


class Accounting(unittest.TestCase):
    def test_cpu_memory_scope_orphans_and_separate_helper(self):
        group = "/user.slice/herdr-build-abcdef.scope"
        a = record("t1", 1, 1000, unit="herdr-build-abcdef")
        h = record("t2", 3, 1000, parent="t1", role="helper")
        b = record("t3", 9, 1000, key="repo#2")
        rows = {p.pid: p for p in [proc(1, 0), proc(2, 1, group=group), proc(3, 0), proc(4, 3),
                                  proc(5, 99, group=group), proc(6, 5, group=group + "/nested"),
                                  proc(9, 0), proc(10, 9), proc(99, 0, rss=10000)]}
        inputs = {"repo#1": [a, h], "repo#2": [b]}
        v, state = U.aggregate(inputs, rows, {}, 2000, 2, lambda _: [101, 5])
        self.assertEqual(v["repo#1"]["rss_bytes"], 60)
        self.assertEqual(v["repo#2"]["rss_bytes"], 20)
        self.assertIsNone(v["repo#1"]["cpu_pct"])
        # Exited scoped process still contributes to the scope's interval CPU, not to RSS.
        rows.pop(6)
        rows[2] = proc(2, 1, cpu=5, group=group)
        rows[4] = proc(4, 3, cpu=1)
        rows[10] = proc(10, 9, cpu=0.5)
        v, state = U.aggregate(inputs, rows, state, 4000, 4, lambda _: [101, 9])
        self.assertEqual(v["repo#1"]["cpu_pct"], 250)  # 4 scope seconds + 1 helper second / 2s
        self.assertEqual(v["repo#1"]["rss_bytes"], 50)
        self.assertEqual(v["repo#2"]["cpu_pct"], 25)
        self.assertEqual(v["repo#1"]["coverage"], "scope+tree")
        self.assertNotIn("99", state["tasks"]["repo#1"]["members"])

    def test_pid_reuse_root_replacement_and_reparent(self):
        a = record("t1", 1, 1000)
        b = record("t2", 8, 1000, key="repo#2")
        inputs = {"repo#1": [a], "repo#2": [b]}
        rows = {p.pid: p for p in [proc(1, 0), proc(2, 1, birth=101), proc(3, 2, birth=102), proc(8, 0)]}
        _, state = U.aggregate(inputs, rows, {}, 2000, 2)
        rows[2] = proc(2, 99, birth=999, rss=999, born_at=2500)  # a different process with the same PID
        rows[3] = proc(3, 99, birth=102, cpu=1)
        v, state = U.aggregate(inputs, rows, state, 3000, 3)
        self.assertEqual(v["repo#1"]["rss_bytes"], 20)
        self.assertEqual(v["repo#1"]["cpu_pct"], 100)
        self.assertNotIn("2", state["tasks"]["repo#1"]["members"])
        rows[1] = proc(1, 0, birth=500, born_at=3000)
        v, state = U.aggregate(inputs, rows, state, 4000, 4)
        self.assertNotIn("repo#1", v)  # stale hc terminal identity cannot be rebound to a reused PID
        v, _ = U.aggregate(inputs, rows, state, 5000, 5)
        self.assertNotIn("repo#1", v)
        a = record("t1", 1, 3000)
        v, _ = U.aggregate({"repo#1": [a]}, rows, state, 5000, 5)
        self.assertIsNone(v["repo#1"]["cpu_pct"])
        self.assertEqual(v["repo#1"]["rss_bytes"], 10)

    def test_same_task_two_workers_and_nested_helper_no_double_count(self):
        a = record("t1", 1, 1000)
        b = record("t2", 3, 1000)
        h = record("t3", 2, 1000, parent="t1", role="reviewer")
        rows = {p.pid: p for p in [proc(1, 0), proc(2, 1), proc(3, 0), proc(4, 2)]}
        v, _ = U.aggregate({"repo#1": [a, b, h]}, rows, {}, 2000, 2)
        self.assertEqual(v["repo#1"]["rss_bytes"], 40)
        self.assertEqual(set(v["repo#1"]["terminals"]), {"t1", "t2", "t3"})

    def test_remote_pid_same_task_key_not_owned(self):
        a = record("t1", 1, 1000)
        r = record("other/t1", 1, 1000)
        h = record("t2", 2, 1000, parent="t1", role="helper")
        h2 = record("t3", 3, 1000, parent="t2", role="reviewer")
        stranger = record("t4", 4, 1000, parent="t9", role="helper")
        reviewer = record("t5", 5, 1000, parent="t9", role="reviewer")
        self.assertEqual([k["address"] for k in U.owned_records("repo#1", {"reviewers": [{"address": "t5"}]}, [a, r], [h2, h, stranger, reviewer])],
                         ["t1", "t2", "t5", "t3"])

    def test_ambiguous_scope_does_not_claim_unrelated_task(self):
        grp = "/user.slice/herdr-one-abcdef.scope"
        rows = {p.pid: p for p in [proc(1, 0, group=grp), proc(2, 0, group=grp), proc(3, 0)]}
        v, _ = U.aggregate({"repo#1": [record("t1", 1, 1000, unit="herdr-one-abcdef")],
                            "repo#2": [record("t2", 2, 1000, key="repo#2")]}, rows, {}, 2000, 2)
        self.assertNotIn("repo#1", v)
        self.assertEqual(v["repo#2"]["rss_bytes"], 10)

    def test_cache_is_bounded_shared_and_clears_when_idle(self):
        with tempfile.TemporaryDirectory() as folder:
            rows = {1: proc(1, 0)}
            inputs = {"repo#1": [record("t1", 1, 1000)]}
            with mock.patch.object(U, "processes", return_value=rows) as scan:
                U.sample_pass(folder, inputs)
                U.sample_pass(folder, inputs)  # e.g. service and scheduler's ticks overlap in time
                self.assertEqual(scan.call_count, 1)
                pub = U.read(os.path.join(folder, U.PUBLIC))
                self.assertEqual(pub["repo#1"]["rss_bytes"], 10)
                self.assertNotIn("members", pub["repo#1"])
                self.assertEqual(set(os.listdir(folder)), {U.PUBLIC, U.CACHE_DIR})
                self.assertEqual(os.listdir(os.path.join(folder, U.CACHE_DIR)), ["baseline"])
                U.sample_pass(folder, {})
                U.sample_pass(folder, {})
                self.assertEqual(scan.call_count, 1)
                self.assertFalse(os.path.exists(os.path.join(folder, U.PUBLIC)))
                self.assertFalse(os.path.exists(os.path.join(folder, U.BASELINE)))


# Each worker holds two direct children, each with a grandchild; one direct child exits on
# request. Every child reserves and touches its own memory and does a short CPU duty cycle.
WORKLOAD = r'''
import os,sys,time
from pathlib import Path
folder=Path(sys.argv[1]); n=int(sys.argv[2]); mib=int(sys.argv[3]); deadline=time.monotonic()+12

def burn(name, parent=False):
    a=bytearray(mib*1024*1024)
    for i in range(0,len(a),4096): a[i]=1
    (folder/name).write_text(str(os.getpid()))
    while time.monotonic()<deadline and not (parent and (folder/'exit-parent').exists()):
        end=time.process_time()+.008
        while time.process_time()<end: pass
        time.sleep(.025)
    os._exit(0)
for i in range(n):
    if os.fork()==0:
        if os.fork()==0: burn(f'g{i}')
        burn(f'c{i}',i==0)
while time.monotonic()<deadline:
    try: os.waitpid(-1,os.WNOHANG)
    except ChildProcessError: pass
    time.sleep(.03)
'''


@unittest.skipUnless(sys.platform.startswith("linux") or sys.platform == "darwin", "requires fork and OS process counters")
class RealTree(unittest.TestCase):
    def worker(self, folder, pairs, mib, key, address, scope=False):
        unit = None
        argv = [sys.executable, "-c", WORKLOAD, str(folder), str(pairs), str(mib)]
        if scope:
            import secrets
            unit = "herdr-usage-fixture-" + secrets.token_hex(3)
            argv = ["systemd-run", "--user", "--scope", "--quiet", "--collect", f"--unit={unit}", "--", *argv]
        created = round(time.time() * 1000)
        p = subprocess.Popen(argv, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def cleanup():
            try: os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            p.wait(timeout=5)
        self.addCleanup(cleanup)
        limit = time.monotonic()+4
        files = [folder / f"{x}{i}" for x in ("c", "g") for i in range(pairs)]
        while not all(f.exists() and f.stat().st_size for f in files):
            if time.monotonic() > limit or p.poll() is not None:
                self.fail("synthetic worker failed to start")
            time.sleep(.025)
        return record(address, p.pid, created, key=key, unit=unit), {int(f.read_text()) for f in files}

    def measure(self, scope=False):
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder)/"a", Path(folder)/"b"
            a.mkdir(); b.mkdir()
            root, kids = self.worker(a, 2, 18, "test#1", "ta", scope)
            other, other_kids = self.worker(b, 1, 8, "test#2", "tb")
            inputs = {"test#1": [root], "test#2": [other]}
            def sample(old):
                rows = U.processes()
                self.assertIsNotNone(rows)
                v, state = U.aggregate(inputs, rows, old, round(time.time()*1000), time.monotonic())
                self.assertEqual(v["test#1"]["rss_bytes"], sum(rows[int(pid)].rss for pid in state["tasks"]["test#1"]["members"]))
                return v, state
            v, old = sample({})
            self.assertIsNone(v["test#1"]["cpu_pct"])
            self.assertTrue(kids <= set(map(int, old["tasks"]["test#1"]["members"])))
            self.assertTrue(other_kids.isdisjoint(set(map(int, old["tasks"]["test#1"]["members"]))))
            self.assertGreater(v["test#1"]["rss_bytes"], 70*2**20)
            time.sleep(.65)
            v, old = sample(old)
            self.assertGreater(v["test#1"]["cpu_pct"], 10)
            self.assertGreater(v["test#2"]["cpu_pct"], 3)
            self.assertGreater(v["test#1"]["rss_bytes"], v["test#2"]["rss_bytes"])
            if scope:
                self.assertEqual(v["test#1"]["coverage"], "scope+tree")
            print("Synthetic four-process task: CPU %.1f%%, RSS %.1f MiB; concurrent task: CPU %.1f%%, RSS %.1f MiB" %
                  (v["test#1"]["cpu_pct"], v["test#1"]["rss_bytes"]/2**20, v["test#2"]["cpu_pct"], v["test#2"]["rss_bytes"]/2**20))
            (a/"exit-parent").touch()
            orphan = int((a/"g0").read_text()); exited = int((a/"c0").read_text())
            limit = time.monotonic()+2
            while time.monotonic()<limit:
                rows = U.processes() or {}
                if orphan in rows and rows[orphan].parent != exited and exited not in rows:
                    break
                time.sleep(.05)
            self.assertIn(orphan, rows)
            self.assertNotEqual(rows[orphan].parent, exited)
            self.assertNotIn(exited, rows)
            time.sleep(.3)
            v, old = sample(old)
            self.assertIn(str(orphan), old["tasks"]["test#1"]["members"])
            self.assertNotIn(str(exited), old["tasks"]["test#1"]["members"])
            self.assertGreater(v["test#1"]["rss_bytes"], 50*2**20)
            print("After parent exit: orphan still owned, exited process removed; CPU %.1f%%, RSS %.1f MiB" %
                  (v["test#1"]["cpu_pct"], v["test#1"]["rss_bytes"]/2**20))
            if scope:
                fresh, fresh_state = sample({})
                self.assertIn(str(orphan), fresh_state["tasks"]["test#1"]["members"])
                self.assertEqual(fresh["test#1"]["coverage"], "scope+tree")
                print("Fresh baseline after reparent: scope independently recovers the orphan")
            return v

    def test_real_four_process_tree_and_reparent(self):
        self.measure()

    @unittest.skipUnless(os.environ.get("SHEP_TEST_SYSTEMD_SCOPE") == "1", "opt-in real user systemd scope fixture")
    def test_real_systemd_scope(self):
        self.measure(scope=True)
