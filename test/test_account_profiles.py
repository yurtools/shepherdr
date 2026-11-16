import home_guard  # noqa: F401
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mods/tasks/bin"))
from herdr_task import settings
from herdr_task.base import Fail

class AccountProfiles(unittest.TestCase):
    def test_named_worker_uses_local_profile_and_missing_profile_fails(self):
        with tempfile.TemporaryDirectory() as root:
            data = Path(root) / "data"
            data.mkdir()
            (data / "agent-profiles.json").write_text(json.dumps({"profiles": [{"id": "secondary", "agent": "codex", "home": "/tmp/profile two"}]}))
            with mock.patch.dict(os.environ, {"HERDR_APP_HOME": root}):
                argv = settings.argv_for({"agent": "codex", "profile": "secondary", "model": "test-model"})
                self.assertIn("CODEX_HOME=/tmp/profile two", argv)
                self.assertIn("OPENAI_API_KEY", argv)
                self.assertIn("test-model", argv)
                (Path(root) / "secondary-models").mkdir(exist_ok=True)
                (data / "agent-profiles.json").write_text(json.dumps({"profiles": [{"id": "secondary", "agent": "codex", "home": str(Path(root) / "secondary-models")}]}))
                (Path(root) / "secondary-models/models_cache.json").write_text(json.dumps({"models": [{"slug": "secondary-only"}]}))
                self.assertEqual(settings.codex_models("secondary"), ["secondary-only"])
                self.assertIn("CODEX_HOME=", settings.reviewer_command("codex", profile="secondary"))
                self.assertEqual(settings.agent_key(argv), "codex")
                from herdr_task.launch import resume_argv
                resumed = resume_argv(argv, "SESSION")
                self.assertEqual(resumed[resumed.index("codex") + 1], "resume")
                self.assertIn("CODEX_HOME=/tmp/profile two", resumed)
                with self.assertRaises(Fail): settings.argv_for({"agent": "codex", "profile": "missing"})
    def test_worker_inherits_assistant_account_unless_overridden(self):
        roles = {"coordinator": {"agent": "codex", "profile": "secondary"}, "worker": {}}
        with mock.patch.object(settings, "settings_for", return_value=roles):
            self.assertEqual(settings.worker_pick(None, {})["profile"], "secondary")
            roles["worker"] = {"agent": "codex", "profile": None}
            self.assertIsNone(settings.worker_pick(None, {})["profile"])
            roles["worker"] = {"agent": "claude"}
            self.assertNotIn("profile", settings.worker_pick(None, {}))

    def test_codex_hook_flags_follow_the_profile_executable(self):
        from herdr_task import launch, revive
        argv = ["env", "-u", "OPENAI_API_KEY", "CODEX_HOME=/tmp/isolated-profile", "codex", "--no-daemon"]
        with mock.patch.object(launch, "own_codex_hooks", return_value={}), mock.patch.object(launch, "trust_roots", return_value=[]):
            result = launch.own_argv(argv)
        self.assertEqual(result[:5], argv[:5])
        self.assertEqual(result[5], "-c")
        kind, base = revive.base_argv(argv)
        self.assertEqual(kind, "codex")
        self.assertIn("CODEX_HOME=/tmp/isolated-profile", base)
        resumed = revive.resume_argv(kind, base, "SESSION")
        self.assertEqual(resumed[resumed.index("codex") + 1], "resume")

    def test_installer_records_profile_hooks_and_does_not_leave_scratch_root(self):
        import test_install
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            data = Path(root) / ".config/herdr-app/data"
            data.mkdir(parents=True)
            account = Path(root) / ".config/secondary"
            account.mkdir()
            (account / "hooks.json").write_text(json.dumps({"custom": "kept"}))
            (data / "agent-profiles.json").write_text(json.dumps({"profiles": [
                {"id": "secondary", "agent": "codex", "home": str(account)},
                {"id": "outside", "agent": "codex", "home": outside}]}))
            test_install.run("install", "--root", root, "--yes")
            hooks = json.loads((account / "hooks.json").read_text())
            self.assertEqual(hooks["custom"], "kept")
            self.assertEqual(set(hooks["hooks"]), {"SessionStart", "PermissionRequest"})
            self.assertFalse((Path(outside) / "hooks.json").exists())
            record = json.loads((data / "shepherdr/installed.json").read_text())
            self.assertTrue(any("secondary/hooks.json" in h[0] for h in record["hooks"]))

    def test_recovery_of_an_existing_account_wrapper_uses_its_session_home(self):
        from herdr_task import revive
        record = {"argv": ["secondary-codex-wrapper"], "foreground": {"pid": 999999999, "argv": ["codex", "--no-daemon"], "cwd": "/tmp/project"}, "pid": 999999999}
        with mock.patch.object(revive, "session_of", return_value=("SESSION", "/tmp/account/sessions/2026/rollout.jsonl")):
            result = revive.record_of(record)
        self.assertIn("CODEX_HOME=/tmp/account", result["argv"])
