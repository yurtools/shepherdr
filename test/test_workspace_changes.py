"""Real temporary Git repositories: discovery, diffs and commits never touch live projects."""
import home_guard  # noqa: F401
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "mods/workspace-changes/repositories.py"
spec = importlib.util.spec_from_file_location("workspace_changes", SOURCE)
changes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changes)


class WorkspaceChanges(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)

    def git(self, root, *args):
        return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.DEVNULL).decode()

    def repo(self, path, commit=True):
        root = self.folder / path; root.mkdir(parents=True, exist_ok=True)
        self.git(root, "init", "-b", "main")
        self.git(root, "config", "user.name", "Fixture")
        self.git(root, "config", "user.email", "fixture@example.invalid")
        (root / "same.txt").write_text("original\n")
        if commit:
            self.git(root, "add", "."); self.git(root, "commit", "-m", "Initial")
        return root

    def test_sibling_repos_identical_paths_have_independent_diffs(self):
        a, b = self.repo("service a"), self.repo("service 'b")
        (a / "same.txt").write_text("alpha\n"); (b / "same.txt").write_text("beta\n")
        result = changes.snapshot(str(self.folder))
        self.assertEqual({r["root"] for r in result["repos"]}, {str(a), str(b)})
        self.assertEqual([r["count"] for r in result["repos"]], [1, 1])
        for repo, word in [(a, "+alpha"), (b, "+beta")]:
            self.assertIn(word, changes.diff(str(self.folder), str(repo), "same.txt")["lines"])

    def test_commit_changes_only_selected_repo_and_has_literal_path_handling(self):
        a, b = self.repo("a"), self.repo("b")
        for root in (a, b): (root / "same.txt").write_text("modified\n")
        weird = ":(glob)*.txt"; (a / weird).write_text("literal filename\n")
        self.assertIn("+literal filename", changes.diff(str(self.folder), str(a), weird)["lines"])
        before = self.git(b, "rev-parse", "HEAD")
        changes.commit(str(self.folder), str(a), "Selected repo", [])
        self.assertEqual(self.git(a, "status", "--porcelain"), "")
        self.assertEqual(self.git(b, "rev-parse", "HEAD"), before)
        self.assertIn("same.txt", self.git(b, "status", "--porcelain"))

    def test_parent_commit_never_embeds_untracked_nested_repo(self):
        parent = self.repo("parent"); child = self.repo("parent/child")
        (parent / "same.txt").write_text("parent edit\n"); (child / "same.txt").write_text("child edit\n")
        snap = changes.snapshot(str(parent))
        p = next(r for r in snap["repos"] if r["root"] == str(parent))
        self.assertEqual([f["path"] for f in p["files"]], ["same.txt"])
        before = self.git(child, "rev-parse", "HEAD")
        changes.commit(str(parent), str(parent), "Parent only", [])
        self.assertNotIn("child", self.git(parent, "ls-files"))
        self.assertEqual(self.git(child, "rev-parse", "HEAD"), before)
        self.assertIn("same.txt", self.git(child, "status", "--porcelain"))

    def test_parent_rejects_already_staged_embedded_repo(self):
        parent = self.repo("parent"); self.repo("parent/child")
        self.git(parent, "add", "child")
        before = self.git(parent, "rev-parse", "HEAD")
        with self.assertRaisesRegex(ValueError, "already staged"):
            changes.commit(str(parent), str(parent), "Must not commit", [])
        self.assertEqual(self.git(parent, "rev-parse", "HEAD"), before)

    def test_nested_repo_under_skipped_dependency_folder_is_never_embedded(self):
        parent = self.repo("parent"); self.repo("parent/vendor/child")
        (parent / "same.txt").write_text("parent edit\n")
        changes.commit(str(parent), str(parent), "Parent without vendor repo", [])
        self.assertNotIn("vendor", self.git(parent, "ls-files"))
        self.git(parent, "add", "vendor/child")
        with self.assertRaisesRegex(ValueError, "already staged"):
            changes.commit(str(parent), str(parent), "No embedded vendor", [])

    def test_worktrees_and_submodules_are_discovered_as_git_files(self):
        parent = self.repo("parent"); source = self.repo("source")
        work = self.folder / "worktree"
        self.git(source, "worktree", "add", "-b", "parallel", str(work))
        self.git(parent, "-c", "protocol.file.allow=always", "submodule", "add", str(source), "module")
        self.git(parent, "commit", "-am", "Module")
        sub = parent / "module"; (sub / "same.txt").write_text("submodule change\n")
        (work / "same.txt").write_text("worktree change\n")
        snap = changes.snapshot(str(self.folder))
        byroot = {r["root"]: r for r in snap["repos"]}
        self.assertTrue((work / ".git").is_file()); self.assertTrue((sub / ".git").is_file())
        self.assertEqual(byroot[str(work)]["branch"], "parallel")
        self.assertIn("module", [f["path"] for f in byroot[str(parent)]["files"]])
        self.assertIn("same.txt", [f["path"] for f in byroot[str(sub)]["files"]])
        self.git(sub, "config", "user.name", "Fixture"); self.git(sub, "config", "user.email", "fixture@example.invalid")
        self.git(sub, "commit", "-am", "Submodule revision")
        revision = self.git(sub, "rev-parse", "HEAD").strip()
        changes.commit(str(parent), str(parent), "Update module ref", [])
        self.assertIn(revision, self.git(parent, "ls-tree", "HEAD", "module"))
        self.assertEqual(self.git(sub, "rev-parse", "HEAD").strip(), revision)

    def test_exclusions_symlinks_and_no_writes_during_refresh(self):
        a = self.repo("a"); self.repo("node_modules/ignored")
        external = self.repo("outside")
        (a / "link").symlink_to(external, target_is_directory=True)
        (a / "secret-link").symlink_to(external / "same.txt")
        before = (a / ".git/index").stat().st_mtime_ns
        snap = changes.snapshot(str(a))
        self.assertEqual(snap["roots"], [str(a)])
        self.assertEqual((a / ".git/index").stat().st_mtime_ns, before)
        lines = changes.diff(str(a), str(a), "secret-link")["lines"]
        self.assertNotIn("+original", lines)
        self.assertIn(str(external / "same.txt"), " ".join(lines))
        self.assertNotIn(str(self.folder / "node_modules/ignored"), changes.snapshot(str(self.folder))["roots"])

    def test_unborn_repo_staged_and_unstaged_new_files_and_binary(self):
        root = self.repo("new", commit=False)
        self.git(root, "add", "same.txt"); (root / "same.txt").write_text("latest\n")
        (root / "binary.bin").write_bytes(b"a\0b")
        self.assertIn("+latest", changes.diff(str(self.folder), str(root), "same.txt")["lines"])
        self.assertEqual(changes.diff(str(self.folder), str(root), "binary.bin")["lines"], ["Binary file · no text diff"])
        changes.commit(str(self.folder), str(root), "First", [])
        self.assertEqual(self.git(root, "status", "--porcelain"), "")

    def test_moved_repo_known_refresh_and_invalid_outside_targets(self):
        a = self.repo("a"); folder = self.folder / "empty"; folder.mkdir()
        result = changes.snapshot(str(folder), [str(a)])
        self.assertEqual(result["repos"], []); self.assertTrue(result["warnings"])
        with self.assertRaisesRegex(ValueError, "outside"):
            changes.diff(str(folder), str(a), "same.txt")
        for path in ["../outside", "/absolute", "\0bad"]:
            with self.assertRaises(ValueError): changes.diff(str(self.folder), str(a), path)
        a.rename(self.folder / "moved")
        self.assertTrue(changes.snapshot(str(self.folder), [str(a)])["warnings"])

    def test_limits_reported_and_partial_discovery_still_commits_only_selected_repo(self):
        a, b = self.repo("a"), self.repo("b")
        with patch.object(changes, "MAX_REPOS", 1):
            result = changes.snapshot(str(self.folder)); self.assertTrue(result["warnings"])
            (a / "same.txt").write_text("Selected edit\n")
            changes.commit(str(self.folder), str(a), "Selected despite discovery limit", [])
            self.assertEqual(self.git(a, "status", "--porcelain"), "")
            self.assertEqual(self.git(b, "status", "--porcelain"), "")
        for root in (a, b):
            for i in range(4): (root / (str(i) + ".txt")).write_text("new\n")
        with patch.object(changes, "MAX_FILES", 3):
            result = changes.snapshot(str(self.folder))
            self.assertEqual(sum(len(r["files"]) for r in result["repos"]), 3)
            self.assertEqual(sum(r["count"] for r in result["repos"]), 8)
            self.assertTrue(result["warnings"])

    def test_failed_hook_keeps_message_and_other_repo_untouched(self):
        a, b = self.repo("a"), self.repo("b")
        (a / "same.txt").write_text("changed\n")
        hook = a / ".git/hooks/pre-commit"; hook.write_text("#!/bin/sh\nexit 1\n"); hook.chmod(0o755)
        before = self.git(a, "rev-parse", "HEAD")
        with self.assertRaises(ValueError): changes.commit(str(self.folder), str(a), "Blocked", [])
        self.assertEqual(self.git(a, "rev-parse", "HEAD"), before)
        self.assertEqual(self.git(b, "status", "--porcelain"), "")

    def test_enclosing_repo_for_space_inside_repo_and_clean_repo(self):
        root = self.repo("project"); sub = root / "src"; sub.mkdir()
        snap = changes.snapshot(str(sub))
        self.assertEqual(snap["roots"], [str(root)]); self.assertEqual(snap["repos"][0]["count"], 0)

    def test_json_entrypoint_uses_no_shell_for_weird_names(self):
        root = self.repo("repo ; touch NOT_CREATED")
        p = subprocess.run(["python3", str(SOURCE), __import__('json').dumps({"command": "snapshot", "folder": str(self.folder)})], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertIn(str(root), p.stdout)
        self.assertFalse((self.folder / "NOT_CREATED").exists())


if __name__ == "__main__":
    unittest.main()
