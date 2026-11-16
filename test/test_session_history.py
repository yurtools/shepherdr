import home_guard  # noqa: F401
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("session_history", str(ROOT / "mods/workspace-sessions/bin/herdr-sessions"))
spec = importlib.util.spec_from_loader(loader.name, loader)
H = importlib.util.module_from_spec(spec)
loader.exec_module(H)
SID = "00000000-0000-0000-0000-000000000001"

class SessionHistory(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.primary = self.root / "primary"
        self.second = self.root / "account-2"
        self.app = self.root / "app"
        (self.app / "data").mkdir(parents=True)
        (self.app / "data/agent-profiles.json").write_text(json.dumps({"profiles": [{"id": "second", "agent": "codex", "name": "Codex (Account 2)", "home": str(self.second)}]}))
        self.env = patch.dict(os.environ, {"HERDR_APP_HOME": str(self.app), "CODEX_HOME": str(self.primary)})
        self.env.start(); self.addCleanup(self.env.stop)
    def log(self, account, cwd="/project", sid=SID, archived=False):
        folder = account / ("archived_sessions" if archived else "sessions") / "2026/11/16"
        folder.mkdir(parents=True, exist_ok=True)
        p = folder / ("rollout-2026-11-16-" + sid + ".jsonl")
        objects = [
            {"type": "session_meta", "payload": {"id": sid, "cwd": cwd, "source": "cli"}},
            {"type": "turn_context", "payload": {"model": "model-one", "effort": "high", "approval_policy": "on-request", "sandbox_policy": {"type": "workspace-write"}}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Fix the test"}]}},
            {"type": "response_item", "payload": {"type": "reasoning", "summary": [{"text": "private thinking"}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant", "channel": "final", "content": [{"type": "output_text", "text": "The test is fixed."}]}},
        ]
        p.write_text("".join(json.dumps(x) + "\n" for x in objects))
        (account / "session_index.jsonl").write_text(json.dumps({"id": sid, "thread_name": "A saved conversation"}) + "\n")
        return p
    def rows(self, folder="/project", space="space"):
        return H.sessions(folder, space, live=False)["sessions"]
    def test_saved_sessions_from_both_accounts_keep_distinct_identity(self):
        self.log(self.primary); self.log(self.second)
        rows = self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({r["key"] for r in rows}), 2)
        self.assertEqual({r["home"] for r in rows}, {str(self.primary), str(self.second)})
        self.assertEqual({r["account"] for r in rows}, {"Codex", "Codex (Account 2)"})
        self.assertTrue(all(r["title"] == "A saved conversation" for r in rows))
    def test_folder_backfill_includes_children_but_not_sibling_prefix(self):
        self.log(self.primary, "/project/subdir")
        self.log(self.second, "/project-other")
        self.assertEqual(len(self.rows()), 1)
    def test_space_association_survives_folder_move_and_prevents_space_bleed(self):
        self.log(self.primary)
        row = self.rows()[0]
        H.capture({**row, "title": "Renamed tab", "argv": ["codex", "--no-daemon"]})
        self.assertEqual(self.rows(folder="/different")[0]["title"], "Renamed tab")
        self.assertEqual(self.rows(space="another-space"), [])
    def test_explicit_workspace_folder_overrides_the_native_home_folder(self):
        self.log(self.primary)
        (self.app / "data/workspace-folders.json").write_text('{"space":"/project"}')
        self.assertEqual(len(self.rows(folder="/home/example")), 1)
    def test_archived_sessions_remain_available_without_duplicates(self):
        self.log(self.primary)
        self.log(self.primary, archived=True)
        self.assertEqual(len(self.rows()), 1)
    def test_preview_contains_conversation_text_and_excludes_reasoning(self):
        self.log(self.primary)
        self.assertEqual(H.preview(self.rows()[0]), [{"role": "user", "text": "Fix the test"}, {"role": "assistant", "text": "The test is fixed."}])
    def test_unknown_account_cannot_capture_or_redirect_a_resume(self):
        H.capture({"kind": "codex", "home": str(self.root / "unknown"), "session": SID, "space": "space"})
        self.assertFalse((self.app / "data/session-history").exists())
    def test_corrupt_log_does_not_hide_valid_sessions(self):
        p = self.log(self.primary)
        (p.parent / "broken.jsonl").write_text("truncated {")
        self.assertEqual(len(self.rows()), 1)

    def test_legacy_event_messages_get_a_useful_title_and_no_empty_housekeeping_bubbles(self):
        p = self.log(self.primary)
        (self.primary / "session_index.jsonl").unlink()
        with p.open("a") as f:
            for obj in [
                {"type": "event_msg", "payload": {"type": "user_message", "message": "Continue the migration"}},
                {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "<hc no-reply/>"}]}},
                {"type": "response_item", "payload": []},
            ]:
                f.write(json.dumps(obj) + "\n")
        row = self.rows()[0]
        self.assertEqual(row["title"], "Fix the test")
        self.assertEqual(H.preview(row)[-1], {"role": "user", "text": "Continue the migration"})

if __name__ == "__main__":
    unittest.main()
