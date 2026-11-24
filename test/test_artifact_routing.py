"""Ownership routing against real scratch task/artifact registries; window calls are inert."""
import home_guard  # noqa: F401
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
loader = importlib.machinery.SourceFileLoader('routing_artifact', os.path.join(ROOT, 'mods/artifacts/bin/herdr-artifact'))
spec = importlib.util.spec_from_loader(loader.name, loader)
A = importlib.util.module_from_spec(spec)
loader.exec_module(A)

class Ownership(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.tasks = os.path.join(self.root, 'tasks')
        self.store = os.path.join(self.root, 'artifacts')
        os.makedirs(self.tasks)
        os.makedirs(self.store)
        self.a = dict(id='proof-1234', title='Same title', version=2, folder='/a', task='SHOP-4', versions=[])
        with open(os.path.join(self.store, 'a.json'), 'w') as f:
            json.dump(dict(folder='/a', artifacts=[self.a]), f)
        self.write_task('a', '/a', 'A')
        self.write_task('b', '/b', 'B')
        self.patches = [mock.patch.object(A, 'STORE', self.store), mock.patch.object(A, 'FILES', os.path.join(self.store, 'files')),
                        mock.patch.object(A, 'SHEP', lambda _: self.tasks), mock.patch.object(A.shutil, 'which', return_value='/fake/app')]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def write_task(self, slug, folder, space, proof=None):
        with open(os.path.join(self.tasks, slug + '.json'), 'w') as f:
            json.dump(dict(folder=folder, prefix='SHOP', tasks=[dict(id=4, space=space, proof=proof)]), f)

    def opts(self, **kw):
        return types.SimpleNamespace(**dict(id=self.a['id'], machine=None, tab=False, direction='right', beside=None, **kw))

    def test_cli_selects_owner_before_opening(self):
        calls = []
        def run(args):
            calls.append(args)
            if args == ['herdr-app', 'ls']:
                return types.SimpleNamespace(returncode=0, stdout=json.dumps({'spaces': [{'id': 'A', 'tabs': [{'id': 'tab-a', 'active': True, 'terminals': [{'pane': 'pane-a'}]}]}]}), stderr='')
            return types.SimpleNamespace(returncode=0, stdout='{}', stderr='')
        with mock.patch.object(A, 'local_mod', return_value='art-proof-1234'), mock.patch.object(A, 'run', side_effect=run):
            self.assertEqual(A.open_window(self.opts()), 'art-proof-1234')
        select = ['herdr-app', 'do', 'space.select', '--id', 'A']
        self.assertIn(select, calls)
        self.assertLess(calls.index(select), next(i for i, c in enumerate(calls) if 'pane.split' in c))
        self.assertFalse(any('kill' in c or 'terminal.close' in c for c in calls))

    def test_old_proof_in_a_worktree_recovers_owner_by_proof_identity(self):
        self.write_task('a', '/a', 'A', {'id': self.a['id']})
        self.assertEqual(A.public({**self.a, 'folder': '/worktree', 'task': None})['space'], 'A')
        self.assertEqual(A.public({**self.a, 'folder': '/worktree', 'taskKey': 'a#4'})['space'], 'A')

    def test_missing_or_conflicting_owner_is_not_a_folder_match(self):
        self.assertIsNone(A.public({**self.a, 'task': None})['space'])
        self.write_task('a', '/a', None)
        self.assertIsNone(A.public(self.a)['space'])
        with mock.patch.object(A, 'run') as run, self.assertRaisesRegex(A.Fail, 'owning space'):
            A.open_window(self.opts())
        run.assert_not_called()
        self.write_task('a', '/a', 'A', {'id': self.a['id']})
        self.write_task('b', '/b', 'B', {'id': self.a['id']})
        self.assertIsNone(A.public(self.a)['space'])

    def test_unavailable_window_owner_never_falls_through_to_split(self):
        with mock.patch.object(A, 'local_mod', return_value='art-proof-1234'), mock.patch.object(A, 'run', return_value=types.SimpleNamespace(returncode=1, stdout='', stderr='gone')) as run:
            with self.assertRaisesRegex(A.Fail, 'unavailable'):
                A.open_window(self.opts())
        self.assertFalse(any('pane.split' in c.args[0] for c in run.call_args_list))

    def test_remote_link_and_open_request_keep_the_original_machine(self):
        with mock.patch.object(A, 'web_base', return_value='https://example.test/'):
            self.assertEqual(A.web_link(self.a['id'], 'vm'), 'https://example.test/?artifact=vm%2Fproof-1234')
        with mock.patch.dict(os.environ, {'HC_TERMINAL_ID': 't1'}), mock.patch.object(A, 'run', return_value=types.SimpleNamespace(returncode=0)) as run:
            self.assertTrue(A.ask_screen(self.a['id'], 'vm'))
        ask = json.loads(run.call_args.args[0][-1].split('=', 1)[1])
        self.assertEqual((ask['artifact'], ask['machine']), (self.a['id'], 'vm'))
