"""Launch settings, using isolated metadata and executable fakes (no live agents)."""
import home_guard  # noqa: F401
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'mods/tasks/bin'))
from herdr_task import settings as S, launch as L, commands as C, revive, takeover
from herdr_task.base import Fail


class LaunchSettings(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.account = self.root / 'account two'
        self.account.mkdir()
        self.app = self.root / 'app'
        (self.app / 'data').mkdir(parents=True)
        self.manifest = self.app / 'data/agent-profiles.json'
        self.manifest.write_text(json.dumps({'profiles': [{'id': 'two', 'agent': 'codex', 'home': str(self.account)}]}))
        self.file = self.root / 'settings.json'
        self.cfg = {'everywhere': {'worker': {'agent': 'codex', 'profile': 'two', 'model': 'global-model',
                                            'effort': 'high', 'fast': True, 'perm': 'read-only'},
                                  'tasks': {'review_rounds': 2}, 'machine': {'low_priority': False}},
                    'spaces': {'sp1': {'folder': '/old-root', 'worker': {'agent': 'codex', 'profile': 'two',
                                          'model': 'space-model', 'effort': 'low', 'fast': False, 'perm': 'auto'},
                                      'reviewer': {'agent': 'codex', 'profile': 'two', 'fast': False}},
                               'sp2': {'folder': '/project', 'worker': {'agent': 'claude'}}}}
        self.s = SimpleNamespace(loc={'folder': '/project', 'kind': 'folder'}, dirty=False, key=lambda t: 'TEST#1')
        self.task = {'id': 1, 'title': 'fixture', 'space': 'sp1', 'mode': 'here', 'agents': []}
        self.save()
        for p in (mock.patch.object(S, 'SETTINGS', str(self.file)),
                  mock.patch.dict(os.environ, {'HERDR_APP_HOME': str(self.app)})):
            p.start(); self.addCleanup(p.stop)

    def save(self):
        self.file.write_text(json.dumps(self.cfg))

    def reviewer(self, task=None, **kw):
        with mock.patch.object(S, 'codex_lacks', return_value=None), mock.patch.object(S, 'cli_here', return_value='ready'):
            return next(r['value'] for r in S.task_settings(self.s, task or self.task, **kw) if r['label'] == 'Reviewer')

    def execute(self, argv):
        binary = self.root / 'codex'
        binary.write_text('#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({"home":os.environ.get("CODEX_HOME"),"argv":sys.argv[1:],"ambient":any(k in os.environ for k in ("OPENAI_API_KEY","CODEX_SQLITE_HOME"))}))\n')
        binary.chmod(0o755)
        env = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
               'CODEX_HOME': '/synthetic/unwanted-account', 'OPENAI_API_KEY': 'synthetic', 'CODEX_SQLITE_HOME': '/synthetic/db'}
        out = subprocess.run(argv, env=env, stdin=subprocess.DEVNULL, text=True, capture_output=True, check=True).stdout
        return json.loads(next(line for line in out.splitlines() if line.startswith('{')))

    def test_reported_folder_mismatch_uses_exact_space_for_both_assistants(self):
        for feature in (None, 'feature-with-another-account'):
            with self.subTest(feature=feature):
                t = {**self.task, 'feature': feature}
                argv = S.worker_argv(self.s, t)
                result = self.execute(argv)
                self.assertEqual(result['home'], str(self.account))
                self.assertIn('space-model', result['argv'])
                self.assertIn('service_tier="default"', result['argv'])
                self.assertIn('workspace-write', result['argv'])
                self.assertFalse(result['ambient'])
                self.assertEqual(self.execute(shlex.split(self.reviewer(t)['command']))['home'], str(self.account))

    def test_roles_are_whole_choices_with_null_role_inheritance(self):
        own = self.cfg['spaces']['sp1']
        for role, expected in ((None, self.cfg['everywhere']['worker']), ({'agent': 'claude'}, {'agent': 'claude'}),
                               ({'agent': 'codex'}, {'agent': 'codex'}),
                               ({'agent': 'codex', 'profile': None, 'model': None}, {'agent': 'codex', 'profile': None, 'model': None}),
                               ({}, {})):
            with self.subTest(role=role):
                own['worker'] = role; self.save()
                self.assertEqual(S.settings_for(self.s, 'sp1')['worker'], expected)

    def test_ambiguous_folder_does_not_choose_another_space(self):
        self.cfg['spaces']['sp1']['folder'] = '/project'; self.save()
        self.assertEqual(S.settings_for(self.s)['worker'], self.cfg['everywhere']['worker'])
        self.assertEqual(S.settings_for(self.s, 'deleted-space')['worker'], self.cfg['everywhere']['worker'])

    def test_plain_worker_does_not_borrow_coordinator_or_feature_account(self):
        self.cfg['everywhere']['coordinator'] = {'agent': 'codex', 'profile': 'two'}
        self.cfg['spaces']['sp1']['feature'] = {'agent': 'codex', 'profile': 'two'}
        self.cfg['spaces']['sp1']['worker'] = {'agent': 'codex'}; self.save()
        result = self.execute(S.worker_argv(self.s, self.task))
        self.assertEqual(result['home'], str(Path(S.HOME) / '.codex'))
        self.assertFalse(result['ambient'])

    def test_task_same_cli_keeps_role_other_cli_resets_cli_fields(self):
        same = S.worker_pick(self.s, {**self.task, 'agent': 'codex', 'model': 'task-model', 'effort': 'xhigh'})
        self.assertEqual((same['profile'], same['model'], same['effort'], same['fast'], same['perm']),
                         ('two', 'task-model', 'xhigh', False, 'auto'))
        self.assertEqual(S.worker_pick(self.s, self.task, agent='claude'), {'agent': 'claude'})

    def test_missing_invalid_deleted_and_wrong_agent_profiles_fail(self):
        for profile in ('missing', 'two'):
            for metadata in ([{'id': 'two', 'agent': 'claude', 'home': str(self.account)}],
                             [{'id': 'two', 'agent': 'codex', 'home': '/synthetic/deleted-profile'}],
                             [{'id': 'two', 'agent': 'codex', 'home': 'relative'}], [None], {}):
                with self.subTest(profile=profile, metadata=metadata):
                    self.manifest.write_text(json.dumps({'profiles': metadata}))
                    with self.assertRaises(Fail): S.argv_for({'agent': 'codex', 'profile': profile})
        with self.assertRaises(Fail): S.argv_for({'agent': 'claude', 'profile': 'two'})

    def test_queue_account_is_revalidated_before_launch(self):
        argv = S.worker_argv(self.s, self.task)
        self.account.rmdir()
        with mock.patch.object(L, 'run') as run, self.assertRaises(Fail):
            L.launch(self.s, self.task, argv, 'sp1')
        run.assert_not_called()

    def test_wrappers_and_recovery_reach_the_selected_executable(self):
        argv = S.worker_argv(self.s, self.task)
        with mock.patch.object(L, 'own_codex_hooks', return_value={}), mock.patch.object(L, 'trust_roots', return_value=[]), \
             mock.patch.object(L, 'scope_argv', return_value=None), mock.patch.object(S, 'machine_option', return_value=True):
            wrapped = L.low_priority(L.clean_env(L.in_shell(L.own_argv(L.resume_argv(argv, 'saved-session')))), 'test')
            result = self.execute(wrapped)
        self.assertEqual(result['home'], str(self.account))
        self.assertIn('saved-session', result['argv'])
        kind, recovered = revive.base_argv(wrapped)
        self.assertEqual(kind, 'codex')
        self.assertEqual(self.execute(revive.resume_argv(kind, recovered, 'saved-session'))['home'], str(self.account))

    def test_reviewer_default_is_bound_and_named_command_is_allowed(self):
        rv = self.reviewer()
        command = 'hc run --bg --name test-review --label herdr.role=reviewer -- ' + rv['command'] + " 'Review fixture'"
        self.assertTrue(L.helper_hc(shlex.split(command)))
        self.assertFalse(L.helper_hc(shlex.split(command.replace(str(self.account), '/synthetic/unconfigured'))))
        plain = S.reviewer_command('codex')
        self.assertEqual(self.execute(shlex.split(plain))['home'], str(Path(S.HOME) / '.codex'))

    def test_backup_honors_its_complete_selection(self):
        self.cfg['everywhere']['backup'] = {'agent': 'codex', 'profile': 'two', 'model': 'backup-model', 'fast': True}
        self.save()
        argv = takeover.backup_argv(self.s, self.task, 'codex')
        self.assertEqual(self.execute(argv)['home'], str(self.account))
        self.assertIn('backup-model', argv)

    def test_saved_session_keeps_account_and_new_account_gets_a_handoff(self):
        old = S.argv_for({'agent': 'codex', 'profile': 'two'})
        self.task['agents'] = [{'agent': 'codex', 'argv': old, 'session': 'saved-session', 'at': 100}]
        with mock.patch.object(C, 'parent_for', return_value=None), mock.patch.object(C, 'launch', return_value={}) as launch, \
             mock.patch.object(C, 'handoff', return_value='handoff'), mock.patch.object(C, 'brief', return_value='brief'):
            _, resumed = C.start_again(self.s, self.task, 'sp1')
            self.assertTrue(resumed)
            self.assertIn('CODEX_HOME=' + str(self.account), launch.call_args.kwargs['resume'])
            _, resumed = C.start_again(self.s, self.task, 'sp1', argv_json=json.dumps(S.argv_for({'agent': 'codex'})))
            self.assertFalse(resumed, 'a session must never be resumed in a different account')

    def test_native_and_assistant_resolvers_agree_for_global_machine_space_and_other_settings(self):
        from herdr_task import assistant_settings as A
        self.cfg['here'] = 'destination'
        self.cfg['machines'] = {'destination': {'worker': {'agent': 'claude', 'model': 'machine-model'},
                                                'tasks': {'merge': 'checks', 'proof': False}}}
        self.cfg['spaces']['sp1']['tasks'] = {'worktrees': False, 'start_notes': 'Start here', 'finish_notes': 'Finish here'}
        self.save()
        for space in ('sp1', 'sp2', 'missing'):
            self.assertEqual(S.settings_for(self.s, space), A.resolve(A.layers(self.cfg, space)))
        cfg = S.settings_for(self.s, 'sp1')
        self.assertEqual((cfg['tasks']['merge'], cfg['tasks']['proof'], cfg['tasks']['worktrees']), ('checks', False, False))
        self.assertEqual(S.notes(self.s, self.task, 'start'), 'Start here')
        self.assertEqual(S.notes(self.s, {**self.task, 'start_notes': 'Task note'}, 'start'), 'Task note')

    def test_reviewer_overrides_fallback_and_permissions(self):
        self.cfg['spaces']['sp1']['reviewer'].update(model='review-model', effort='high', fast=True, perm='full')
        self.save()
        same = self.reviewer({**self.task, 'reviewer': 'codex', 'reviewer_model': 'task-review-model'})
        result = self.execute(shlex.split(same['command']))
        self.assertEqual(result['home'], str(self.account))
        self.assertIn('task-review-model', result['argv'])
        self.assertIn('service_tier="fast"', result['argv'])
        self.assertIn('read-only', result['argv'])
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', result['argv'])
        other = self.reviewer({**self.task, 'reviewer': 'claude'})
        self.assertNotIn('profile', other)
        self.assertNotIn('review-model', other['command'])
        self.cfg['spaces']['sp1']['reviewer'] = None
        self.save()
        with mock.patch.object(S, 'cli_here', return_value='signed-out'), mock.patch.object(S.shutil, 'which', return_value='/fake/cli'):
            rv = next(r['value'] for r in S.task_settings(self.s, self.task) if r['label'] == 'Reviewer')
        self.assertEqual(self.execute(shlex.split(rv['command']))['home'], str(self.account))

    def test_helper_account_is_scoped_to_this_task_and_reviewer_selection(self):
        from herdr_task import store
        data = {'folder': '/project', 'tasks': [self.task]}
        words = shlex.split('hc run --bg --name test-review --label herdr.task=TEST#1 --label herdr.role=reviewer -- ' + self.reviewer()['command'] + " 'Review'")
        with mock.patch.dict(os.environ, {'HERDR_BROWSER_TASK': 'TEST#1'}), mock.patch.object(store, 'read_list', return_value=data):
            self.assertTrue(L.helper_hc(words))
            self.assertFalse(L.helper_hc([w.replace('TEST#1', 'TEST#2') for w in words]))
            plain = shlex.split('hc run --bg --name test-review --label herdr.task=TEST#1 --label herdr.role=reviewer -- ' + S.reviewer_command('codex') + " 'Review'")
            self.assertFalse(L.helper_hc(plain))
            for bad in (['env', 'PATH=/untrusted', *shlex.split(self.reviewer()['command'])],
                        shlex.split(self.reviewer()['command'].replace('read-only', 'workspace-write'))):
                self.assertFalse(L.helper_hc(words[:words.index('--') + 1] + bad + ['Review']))

    def test_launch_hc_argv_and_approval_wrapper_keep_the_account(self):
        argv = S.worker_argv(self.s, self.task)
        calls = []
        def run(words):
            calls.append(words)
            self.assertEqual(self.execute(words[words.index('--') + 1:])['home'], str(self.account))
            return SimpleNamespace(returncode=0, stdout='{"address":"fake-worker"}', stderr='')
        self.task['approval_mode'] = 'codex-review'
        with mock.patch.object(L, 'run', side_effect=run), mock.patch.object(L, 'hc_json', return_value=None), \
             mock.patch.object(L, 'agent_name', return_value='test-worker'), mock.patch.object(L, 'track'), \
             mock.patch.object(L, 'own_codex_hooks', return_value={}), mock.patch.object(L, 'trust_roots', return_value=[]):
            L.launch(self.s, self.task, argv, 'sp1', message='Synthetic prompt')
            L.launch(self.s, self.task, shlex.split(self.reviewer()['command']), 'sp1', role='reviewer')
        self.assertIn('herdr.task.space=sp1', calls[0])
        self.assertIn('approvals_reviewer="auto_review"', calls[0])
        self.assertIn('CODEX_HOME=' + str(self.account), self.task['agents'][-1]['argv'])
        self.assertIn('herdr.role=reviewer', calls[1])
        self.assertIn('read-only', calls[1])
        self.assertIn('CODEX_HOME=' + str(self.account), self.task['reviewers'][-1]['argv'])

    def test_background_dispatch_has_fresh_session_owned_labels_and_worker_settings(self):
        for feature in (None, 'feature-one'):
            with self.subTest(feature=feature):
                task = {**self.task, 'agents': [], **({'feature': feature} if feature else {})}
                argv = S.worker_argv(self.s, task)
                owner = {'state': 'live', 'labels': {'herdr.role': 'feature' if feature else 'coordinator',
                         'herdr.coordinator.space': 'sp1', **({'herdr.feature': feature} if feature else {})}}
                with mock.patch.object(L, 'run', return_value=SimpleNamespace(returncode=0, stdout='{"address":"new-worker"}', stderr='')) as run, \
                     mock.patch.object(L, 'hc_json', return_value=owner), mock.patch.object(L, 'agent_name', return_value='test-worker'), \
                     mock.patch.object(L, 'track'), mock.patch.object(L, 'own_codex_hooks', return_value={}), \
                     mock.patch.object(L, 'trust_roots', return_value=[]):
                    record = L.launch(self.s, task, argv, 'sp1', message='Build and report', parent='owner')
                words = run.call_args.args[0]
                self.assertIn('--bg', words)
                self.assertIn('--outlive-parent', words)
                self.assertEqual(words[words.index('--parent') + 1], 'owner')
                self.assertIn('herdr.owner=owner', words)
                self.assertIn('herdr.role=worker', words)
                self.assertIn('herdr.task=TEST#1', words)
                self.assertNotIn('--resume', words)
                self.assertNotIn('resume', words)
                self.assertEqual(record['argv'], argv)
                self.assertIn('CODEX_HOME=' + str(self.account), record['argv'])
                self.assertIn('space-model', record['argv'])
                self.assertIn('model_reasoning_effort="low"', record['argv'])
                self.assertEqual(record['parent'], 'owner')
                if feature:
                    self.assertIn('herdr.feature=' + feature, words)
                    self.assertEqual(task['feature'], feature)
                else:
                    self.assertFalse(any(w.startswith('herdr.feature=') for w in words))

    def test_same_cli_reviewer_can_use_another_named_account_or_explicit_default(self):
        third = self.root / 'review account'
        third.mkdir()
        self.manifest.write_text(json.dumps({'profiles': [
            {'id': 'two', 'agent': 'codex', 'home': str(self.account)},
            {'id': 'review', 'agent': 'codex', 'home': str(third)}]}))
        for selection, home in (({'agent': 'codex', 'profile': 'review'}, third),
                                ({'agent': 'codex'}, Path(S.HOME) / '.codex'),
                                ({'agent': 'codex', 'profile': None}, Path(S.HOME) / '.codex')):
            with self.subTest(selection=selection):
                self.cfg['spaces']['sp1']['reviewer'] = selection; self.save()
                result = self.execute(shlex.split(self.reviewer()['command']))
                self.assertEqual(result['home'], str(home))
                self.assertIn('read-only', result['argv'])

    def test_unavailable_other_cli_fallback_keeps_worker_account_and_explains_it(self):
        self.cfg['spaces']['sp1']['reviewer'] = None; self.save()
        for installed, state, reason in ((False, None, 'no other is installed'),
                                         (True, 'signed-out', "isn't signed in")):
            with self.subTest(installed=installed, state=state), \
                 mock.patch.object(S.shutil, 'which', return_value='/fake/other' if installed else None), \
                 mock.patch.object(S, 'cli_here', return_value=state):
                row = next(r for r in S.task_settings(self.s, self.task) if r['label'] == 'Reviewer')
                self.assertIn(reason, row['text'])
                self.assertEqual(self.execute(shlex.split(row['value']['command']))['home'], str(self.account))

    def test_model_fallback_changes_only_model_and_missing_named_reviewer_never_falls_back(self):
        self.cfg['spaces']['sp1']['reviewer'].update(model='unavailable-model', effort='high')
        self.save()
        with mock.patch.object(S, 'codex_lacks', return_value=['available-model']), \
             mock.patch.object(S, 'cli_here', return_value='signed-out'):
            row = next(r for r in S.task_settings(self.s, self.task) if r['label'] == 'Reviewer')
        result = self.execute(shlex.split(row['value']['command']))
        self.assertIn("doesn't offer unavailable-model", row['text'])
        self.assertNotIn('-m', result['argv'])
        self.assertEqual(result['home'], str(self.account))
        self.assertIn('model_reasoning_effort="high"', result['argv'])
        self.manifest.write_text('{"profiles":[]}')
        with mock.patch.object(S, 'cli_here', return_value='signed-out'), self.assertRaises(Fail):
            self.reviewer(argv=['claude'])

    def test_deleted_queued_account_preserves_queue_and_crash_recovery_sends_nothing(self):
        argv = S.worker_argv(self.s, self.task)
        self.task.update(state='queued', queue={'space': 'sp1', 'argv': argv})
        self.account.rmdir()
        with mock.patch.object(C, 'folder_for') as folder, self.assertRaises(Fail):
            C.begin(self.s, self.task, argv, 'sp1')
        folder.assert_not_called()
        self.assertEqual(self.task['state'], 'queued')
        self.assertEqual(self.task['queue']['argv'], argv)
        term = {'address': 'fake-worker', 'state': 'live', 'pid': 1}
        report = {}
        with mock.patch.object(revive, 'hc_json', side_effect=[{'terminals': [term]}, term]), \
             mock.patch.object(revive, 'watched', return_value=True), mock.patch.object(revive, 'agent_running', return_value=False), \
             mock.patch.object(revive, 'restarted', return_value=True), mock.patch.object(revive, 'read_record', return_value={}), \
             mock.patch.object(revive, 'plan', return_value=('resume', argv, False)), mock.patch.object(revive, 'run') as run:
            revive.revive_pass(report)
        run.assert_not_called()
        self.assertIn('unavailable', report['revive_failed'][0]['why'])

    def test_reviewer_model_validation_uses_selected_account_cache(self):
        (self.account / 'models_cache.json').write_text(json.dumps({'models': [{'slug': 'account-only-model'}]}))
        with mock.patch.object(S, 'codex_models', wraps=S.codex_models) as models:
            S.set_opts(self.task, SimpleNamespace(reviewer_model='account-only-model'), self.s)
        models.assert_called_with('two')
        self.assertEqual(self.task['reviewer_model'], 'account-only-model')

    def test_account_and_fast_permission_changes_reach_assistant_notices(self):
        from herdr_task import assistant_settings as A
        before = A.rows('sp1', self.cfg, auto=(False, '', ''))
        self.cfg['spaces']['sp1']['worker'].update(profile=None, fast=True, perm='read-only')
        after = A.rows('sp1', self.cfg, auto=(False, '', ''))
        old = next(r for r in before if r['key'] == 'agent')
        new = next(r for r in after if r['key'] == 'agent')
        self.assertIn('account two', old['text'])
        self.assertNotEqual(A.digest([old]), A.digest([new]))
        self.assertIn('Fast on', new['text'])
        self.assertIn('permissions read-only', new['text'])


class TaskSpaceIdentity(unittest.TestCase):
    # Reuse real throwaway task-store/git setup, without inheriting and rerunning its test methods.
    from test_herdr_task import Scheduled as _Fixture
    setUp = _Fixture.setUp
    run_cmd = _Fixture.run_cmd
    task = _Fixture.task
    tick_at = _Fixture.tick_at

    def test_add_and_delayed_start_keep_space_and_its_worktree_policy(self):
        with mock.patch.object(C, 'caller_space', return_value='sp-owned'), \
             mock.patch.object(C, 'caller_labels', return_value={'herdr.feature': 'feature-owned'}), \
             mock.patch.object(C, 'worktrees_on', side_effect=lambda s, space=None: space != 'sp-owned'):
            v = self.run_cmd(C.cmd_add, title='fixture')
        t = self.task(v['id'])
        self.assertEqual((t.get('space'), t.get('feature'), t['mode']), ('sp-owned', 'feature-owned', 'here'))
        self.run_cmd(C.cmd_start, id=v['id'], in_='1h')
        self.assertEqual(self.task(v['id'])['queue']['space'], 'sp-owned')
        self.tick_at(self.task(v['id'])['scheduled_for'] + 1)
        self.assertEqual(self.started[-1][2], 'sp-owned')

    def test_queue_snapshot_survives_settings_change_and_explicit_space_reselects(self):
        cfg = {'everywhere': {'worker': {'agent': 'claude'}}, 'spaces': {
            'sp1': {'folder': self.folder, 'worker': {'agent': 'codex', 'model': 'queued-model'}},
            'sp2': {'folder': self.folder, 'worker': {'agent': 'claude', 'model': 'other-space'}}}}
        file = Path(self.tmp) / 'settings.json'
        file.write_text(json.dumps(cfg))
        with mock.patch.object(C, 'worker_argv', S.worker_argv), mock.patch.object(self.tick, 'worker_argv', S.worker_argv):
            v = self.run_cmd(C.cmd_add, title='snapshot', space='sp1')
            self.run_cmd(C.cmd_start, id=v['id'], in_='1h')
            at = self.task(v['id'])['scheduled_for']
            cfg['spaces']['sp1']['worker'] = {'agent': 'claude', 'model': 'changed-after-queue'}
            file.write_text(json.dumps(cfg))
            self.tick_at(at + 1)
            self.assertIn('queued-model', self.started[-1][1])
            v = self.run_cmd(C.cmd_add, title='move', space='sp1')
            self.run_cmd(C.cmd_start, id=v['id'], in_='1h')
            self.run_cmd(C.cmd_start, id=v['id'], space='sp2', now=True)
            self.assertIn('other-space', self.started[-1][1])
            self.assertEqual(self.started[-1][2], 'sp2')

    def test_automation_captures_space_and_uses_same_worker_resolver(self):
        from herdr_task import automations as A
        cfg = {'everywhere': {'worker': {'agent': 'claude'}}, 'spaces': {'sp-auto': {
            'folder': '/old-folder', 'worker': {'agent': 'codex', 'model': 'automation-model'}, 'tasks': {'worktrees': False}}}}
        (Path(self.tmp) / 'settings.json').write_text(json.dumps(cfg))
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s, \
             mock.patch.object(A, 'begin') as begin, mock.patch.object(A, 'queue_reason', return_value=None):
            t = A.fire(s, {'id': 1, 'title': 'automation', 'space': 'sp-auto'}, 'manual')
            self.assertEqual((t['space'], t['mode']), ('sp-auto', 'here'))
            self.assertIn('automation-model', begin.call_args.args[2])

