"""Bounded multi-repository Changes backend. All paths travel as argv, never shell text.

Derived diff/status behavior from Herdr's Changes mod (Apache-2.0; LICENSE-herdr).
The native mod also sends this source to a remote machine's python3 unchanged.
"""
import json
import os
import subprocess
import sys
import time
from collections import deque

READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"]
SKIP = {".git", ".hg", ".svn", "node_modules", "vendor", ".venv", "venv", "target", "dist", "build",
        ".terraform", ".gradle", "__pycache__", ".cache", ".next", ".idea", ".yarn", ".pnpm-store"}
MAX_DEPTH, MAX_DIRS, MAX_REPOS, MAX_FILES = 6, 4000, 50, 1000
MAX_BYTES = 2_000_000


def git(root, args, write=False):
    # A temporary file bounds memory even when Git produces an enormous status/diff.
    import tempfile
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        p = subprocess.run(["git", *([] if write else READ), *args], cwd=root, stdout=out, stderr=err,
                           stdin=subprocess.DEVNULL, timeout=30 if write else 6)
        out.seek(0); err.seek(0)
        data, errors = out.read(MAX_BYTES + 1), err.read(12000)
        if len(data) > MAX_BYTES:
            raise ValueError("Git output exceeds the 2 MB preview limit")
        return p.returncode, data.decode("utf-8", "replace"), errors.decode("utf-8", "replace").strip()


def required(root, args, write=False):
    code, out, err = git(root, args, write)
    if code:
        raise ValueError(err or out.strip() or "Git command failed")
    return out


def canonical(path):
    if not isinstance(path, str) or not os.path.isabs(path) or any(c in path for c in "\0\r\n"):
        raise ValueError("An absolute folder path is required")
    path = os.path.realpath(path)
    if not os.path.isdir(path):
        raise ValueError("Folder does not exist")
    return path


def within(path, root):
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:
        return False


def top(root):
    code, out, _ = git(root, ["rev-parse", "--show-toplevel"])
    return os.path.realpath(out.strip()) if code == 0 else None


def repository(folder, path):
    root = canonical(path)
    if not within(root, folder) and root != top(folder):
        raise ValueError("Repository is outside this space")
    if top(root) != root:
        raise ValueError("Folder is no longer a repository root")
    return root


def discover(folder):
    roots, warnings = set(), []
    enclosing = top(folder)
    if enclosing:
        roots.add(enclosing)
    queue, visited = deque([(folder, 0)]), 0
    deadline = time.monotonic() + 8
    while queue:
        if visited >= MAX_DIRS or len(roots) >= MAX_REPOS or time.monotonic() > deadline:
            warnings.append("Repository discovery limited; narrow the space folder for more results")
            break
        path, depth = queue.popleft(); visited += 1
        if os.path.lexists(os.path.join(path, ".git")):
            found = top(path)
            if found == path:
                roots.add(path)
        try:
            # Do not enumerate millions of entries, follow symlinks or descend into .git.
            children = []
            with os.scandir(path) as entries:
                for i, entry in enumerate(entries):
                    if i >= 10000:
                        warnings.append("Directory entry limit reached during discovery")
                        break
                    if entry.name not in SKIP and entry.is_dir(follow_symlinks=False):
                        children.append(entry.path)
            if depth < MAX_DEPTH:
                queue.extend((p, depth + 1) for p in sorted(children))
            elif children:
                warnings.append("Discovery stops at six directory levels")
        except OSError:
            warnings.append("Some folders could not be scanned")
    return sorted(roots), sorted(set(warnings))


def nested_paths(root, roots):
    return [os.path.relpath(p, root).replace(os.sep, "/") for p in roots if p != root and within(p, root)]


def status(root, roots):
    entries = required(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]).split("\0")
    has_head = git(root, ["rev-parse", "--verify", "HEAD"])[0] == 0
    branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])[1].strip()
    if not branch:
        branch = git(root, ["rev-parse", "--short", "HEAD"])[1].strip() or "Unborn"
    stats = {}
    commands = [["diff", "HEAD", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"]] if has_head else [
        ["diff", "--cached", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"],
        ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"]]
    for args in commands:
        for entry in required(root, args).split("\0"):
            parts = entry.split("\t", 2)
            if len(parts) != 3:
                continue
            a, d, path = parts
            prev = stats.get(path, {"add": 0, "del": 0})
            stats[path] = {"add": prev["add"] + (int(a) if a.isdigit() else 0),
                           "del": prev["del"] + (int(d) if d.isdigit() else 0), "binary": a == "-"}
    nested, files = nested_paths(root, roots), []
    for entry in filter(None, entries):
        xy, path = entry[:2], entry[3:]
        # A nested untracked repo belongs in its own group. Tracked submodule refs remain in the parent.
        if xy == "??" and (path.endswith("/") or any(path.rstrip("/") == p or path.startswith(p + "/") for p in nested)):
            continue
        conflict = "U" in xy or xy in ("AA", "DD")
        kind = "U" if conflict else "D" if "D" in xy else "A" if xy == "??" or "A" in xy else "M"
        files.append({"path": path, "status": kind, "fresh": xy == "??", **stats.get(path, {"add": 0, "del": 0})})
    return {"root": root, "branch": branch, "hasHead": has_head, "count": len(files), "files": files[:MAX_FILES]}


def snapshot(folder, known=None):
    warnings, discovery_warnings = [], []
    if known is None:
        roots, warnings = discover(folder)
        discovery_warnings = list(warnings)
    else:
        if not isinstance(known, list) or len(known) > MAX_REPOS:
            raise ValueError("Invalid repository list")
        roots = []
        for path in known:
            try:
                roots.append(repository(folder, path))
            except (ValueError, subprocess.TimeoutExpired):
                warnings.append("A repository moved or is unavailable; use Refresh to rediscover")
        roots = sorted(set(roots))
    repos, remaining = [], MAX_FILES
    deadline = time.monotonic() + 15
    for root in roots:
        if time.monotonic() > deadline:
            warnings.append("Refresh time limit reached; narrow the space folder")
            break
        try:
            repo = status(root, roots)
        except (ValueError, OSError, subprocess.TimeoutExpired) as e:
            repo = {"root": root, "branch": "", "count": 0, "files": [], "error": str(e)}
        if len(repo["files"]) > remaining or repo["count"] > len(repo["files"]):
            warnings.append("Showing the first 1,000 changed files across repositories")
        repo["files"] = repo["files"][:remaining]; remaining -= len(repo["files"])
        repo["name"] = os.path.relpath(root, folder).replace(os.sep, "/")
        repos.append(repo)
    return {"repos": repos, "roots": roots, "warnings": sorted(set(warnings)), "discoveryWarnings": discovery_warnings}


def diff(folder, root, path):
    root = repository(folder, root)
    if not isinstance(path, str) or not path or "\0" in path or os.path.isabs(path) or ".." in path.split("/"):
        raise ValueError("Invalid repository file")
    # Read only a file actually listed as changed. Never follow an untracked symlink outside the repo.
    file = next((f for f in status(root, [root])["files"] if f["path"] == path), None)
    if file is None:
        return {"lines": ["File is no longer changed"]}
    has_head = git(root, ["rev-parse", "--verify", "HEAD"])[0] == 0
    if file["fresh"] or (not has_head and file["status"] == "A"):
        full = os.path.join(root, path)
        if os.path.islink(full):
            lines = ["+" + os.readlink(full)]
        else:
            if not within(os.path.realpath(full), root):
                raise ValueError("Preview is outside the repository")
            if not os.path.isfile(full):
                return {"lines": ["Directory or submodule · no text diff"]}
            with open(full, "rb") as f:
                data = f.read(400001)
            if b"\0" in data:
                return {"lines": ["Binary file · no text diff"]}
            text = data[:400000].decode("utf-8", "replace").rstrip("\n").split("\n")
            lines = ["@@ -0,0 +1,%d @@" % len(text)] + ["+" + s for s in text]
            if len(data) > 400000:
                lines.append("Preview truncated at 400 KB")
    else:
        args = ["diff", *(["HEAD"] if has_head else []), "--no-ext-diff", "--no-textconv", "--no-color", "--", ":(literal)" + path]
        out = required(root, args).rstrip("\n").split("\n")
        first = next((i for i, line in enumerate(out) if line.startswith("@@")), None)
        lines = out[first:] if first is not None else ["Binary file or submodule · no text diff"]
    limited = len(lines) > 1500
    lines = [line[:4000] + ("… (line truncated)" if len(line) > 4000 else "") for line in lines[:1500]]
    if limited:
        lines.append("Showing the first 1,500 diff lines")
    return {"lines": lines}


def commit(folder, root, message, known):
    root = repository(folder, root)
    if not isinstance(message, str) or not message.strip() or len(message) > 10000 or "\0" in message:
        raise ValueError("Enter a commit message (up to 10,000 characters)")
    # Rediscover immediately before staging; never embed a newly created nested repository.
    roots, _ = discover(folder)
    roots = sorted(set([root, *roots]))
    nested = nested_paths(root, roots)
    index = required(root, ["ls-files", "--stage", "-z"])
    # A staged embedded repo is also mode 160000. Only paths declared in the
    # staged .gitmodules are real submodules, not accidental git-add embeddings.
    modules = git(root, ["config", "--blob", ":.gitmodules", "-z", "--get-regexp", r"^submodule\..*\.path$"])[1]
    declared = {s.split("\n", 1)[1] for s in modules.split("\0") if "\n" in s}
    gitlinks = {s.split("\t", 1)[1] for s in index.split("\0") if s.startswith("160000 ") and "\t" in s} & declared
    # Even repos under skipped dependency/build folders must never be embedded.
    # With --untracked-files=all Git still reports embedded repos as directories.
    entries = required(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]).split("\0")
    untracked_repos = [s[3:].rstrip("/") for s in entries if s.startswith("?? ") and s.endswith("/")]
    embedded = {s.split("\t", 1)[1] for s in index.split("\0") if s.startswith("160000 ") and "\t" in s} - declared
    excludes = sorted(set([p for p in nested if p not in gitlinks] + untracked_repos + list(embedded)))
    staged = required(root, ["diff", "--cached", "--name-only", "-z", "--no-renames"])
    if any(path == p or path.startswith(p + "/") for path in staged.split("\0") for p in excludes):
        raise ValueError("Nested repository content is already staged in the parent; review its index first")
    paths = [".", *[":(top,exclude,literal)" + p for p in excludes]]
    required(root, ["add", "-A", "--", *paths], write=True)
    required(root, ["commit", "-m", message.strip()], write=True)
    return {"committed": root}


def main(request):
    folder = canonical(request.get("folder"))
    command = request.get("command")
    if command == "snapshot":
        return snapshot(folder, request.get("known"))
    if command == "diff":
        return diff(folder, request.get("root"), request.get("path"))
    if command == "commit":
        return commit(folder, request.get("root"), request.get("message"), request.get("known"))
    raise ValueError("Unknown Changes operation")


if __name__ == "__main__":
    try:
        print(json.dumps(main(json.loads(sys.argv[1])), ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True))
        sys.exit(1)
