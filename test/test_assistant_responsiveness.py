"""Real permission-hook delivery against a fake core, with no auxiliary agent.

This verifies the supported request/answer protocol, not native CLI scheduling.
"""
import home_guard  # noqa: F401
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('jq'), 'jq is required by the hook protocol')
class AssistantResponsiveness(unittest.TestCase):
    def test_space_and_feature_owner_can_receive_chat_and_review_during_worker_activity(self):
        for role in ('coordinator', 'feature'):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                app = root / 'app'
                chat = app / 'mods/chat'
                chat.mkdir(parents=True)
                (app / 'mods/tasks').mkdir()
                (app / 'mods/tasks/bin').symlink_to(ROOT / 'mods/tasks/bin', target_is_directory=True)
                for name in ('ask-hook.sh', 'approval-policy.py', 'ask-end.py'):
                    shutil.copy2(ROOT / 'mods/chat' / name, chat / name)
                bin_dir = root / 'bin'
                bin_dir.mkdir()
                account = str(root / 'worker-account')
                project = str(root / 'project')
                Path(project).mkdir()
                owner_labels = {'herdr.role': role, 'herdr.coordinator.space': 'fixture-space'}
                worker_labels = {'herdr.role': 'worker', 'herdr.task.space': 'fixture-space',
                                 'herdr.task': 'FIX-1', 'herdr.owner': 'towner'}
                if role == 'feature':
                    owner_labels['herdr.feature'] = worker_labels['herdr.feature'] = 'feature-one'
                records = {
                    'towner': {'state': 'live', 'pid': 42, 'status': {'state': 'idle', 'app': 'codex'}, 'argv': ['codex'],
                               'foreground': {'name': 'codex', 'pid': 42, 'argv': ['codex']}, 'labels': owner_labels},
                    'tworker': {'state': 'live', 'status': {'state': 'working'},
                                'argv': ['env', 'CODEX_HOME=' + account, 'codex'], 'cwd': project, 'labels': worker_labels},
                    'tother': {'state': 'live', 'pid': 44, 'status': {'state': 'idle', 'app': 'codex'}, 'argv': ['codex'],
                               'labels': {**owner_labels, 'herdr.feature': 'feature-two'}},
                }
                state = root / 'core.json'
                state.write_text(json.dumps(records))
                log = root / 'sends.jsonl'
                hc = bin_dir / 'hc'
                hc.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
rows=json.loads(Path(os.environ['FIXTURE_CORE']).read_text())
a=sys.argv[1:]
if a[0]=='get': print(json.dumps(rows.get(a[1],{'state':'gone'})))
elif a[0]=='ls': print(json.dumps({'terminals':[{'address':k,'state':v['state']} for k,v in rows.items()]}))
elif a[0]=='send':
 with open(os.environ['FIXTURE_SENDS'],'a') as f: f.write(json.dumps({'to':a[1],'text':a[2]})+'\\n')
 print('{}')
''')
                hc.chmod(0o755)
                settings = root / 'settings.json'
                settings.write_text(json.dumps({'everywhere': {'approvals': {'mode': 'assistant'}}}))
                env = {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                       'HERDR_APP_HOME': str(app), 'HERDR_TASK_SETTINGS': str(settings),
                       'HC_TERMINAL_ID': 'tworker', 'HERDR_ASK_CHAINED': '1',
                       'FIXTURE_CORE': str(state), 'FIXTURE_SENDS': str(log)}
                req = {'session_id': 'fixture-worker-session', 'cwd': project, 'tool_name': 'Bash',
                       'tool_input': {'command': 'git status --short'}}
                hook = subprocess.Popen(['sh', str(chat / 'ask-hook.sh')], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
                try:
                    hook.stdin.write(json.dumps(req))
                    hook.stdin.close()
                    hook.stdin = None
                    until = time.monotonic() + 10
                    tickets = []
                    while time.monotonic() < until:
                        tickets = list((app / 'data/approvals/pending').glob('*.json'))
                        if tickets:
                            ticket = json.loads(tickets[0].read_text())
                            if ticket.get('status') == 'pending' and log.exists():
                                break
                        time.sleep(.02)
                    else:
                        self.fail('the real hook did not deliver a pending ticket')
                    self.assertEqual(ticket['reviewer'], 'towner')
                    self.assertEqual(ticket['context']['account'], account)
                    self.assertEqual(ticket['context']['cwd'], project)
                    self.assertEqual(ticket['context']['task'], 'FIX-1')
                    self.assertEqual(ticket['context']['feature'], 'feature-one' if role == 'feature' else '')
                    # The owner receives another message before the permission hook returns.
                    sent = subprocess.run([str(hc), 'send', 'towner', 'Can we chat while the build runs?'],
                                          env=env, capture_output=True, text=True, timeout=3)
                    self.assertEqual(sent.returncode, 0, sent.stderr)
                    self.assertIsNone(hook.poll())
                    decision_env = {**env, 'HC_TERMINAL_ID': 'towner'}
                    command = [sys.executable, str(chat / 'approval-policy.py'), 'decide', '--id', ticket['id'],
                               '--token', ticket['token'], '--decision', 'allow', '--reason',
                               'Read-only inspection in the delegated project.']
                    # Ordinary workers cannot consume the original ticket.
                    refused = subprocess.run(command, env=env, capture_output=True, text=True, timeout=3)
                    self.assertNotEqual(refused.returncode, 0)
                    decision = subprocess.run(command, env=decision_env, capture_output=True, text=True, timeout=3)
                    self.assertEqual(decision.returncode, 0, decision.stderr)
                    # The ticket has one winning decision, even before hook cleanup.
                    replay = subprocess.run(command, env=decision_env, capture_output=True, text=True, timeout=3)
                    self.assertNotEqual(replay.returncode, 0)
                    out, err = hook.communicate(timeout=10)
                    self.assertEqual(hook.returncode, 0, err)
                    self.assertEqual(json.loads(out)['hookSpecificOutput']['decision']['behavior'], 'allow')
                    sends = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertEqual([line['to'] for line in sends], ['towner', 'towner'])
                    self.assertIn('Exact request:', sends[0]['text'])
                    self.assertEqual(sends[1]['text'], 'Can we chat while the build runs?')
                    history = json.loads((app / 'data/approvals/history.json').read_text())
                    self.assertEqual(len(history), 1)
                    self.assertEqual(history[0]['source'], 'assistant')
                    # Neither delivery nor review changes ownership, worker liveness, or policy.
                    self.assertEqual(json.loads(state.read_text()), records)
                    self.assertEqual(json.loads(settings.read_text())['everywhere']['approvals']['mode'], 'assistant')
                    self.assertFalse(list((app / 'data/chat-asks/req').glob('*.json')))
                finally:
                    if hook.poll() is None:
                        hook.terminate()
                    hook.communicate(timeout=5)
