"""Ownership routing against real scratch task/artifact registries; window calls are inert."""
import home_guard  # noqa: F401
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
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
        return types.SimpleNamespace(**{**dict(id=self.a['id'], machine=None, tab=False, direction='right', beside=None), **kw})

    def command_json(self, *args):
        out = io.StringIO()
        with mock.patch('sys.argv', ['herdr-artifact', *args, '--json']), contextlib.redirect_stdout(out):
            self.assertEqual(A.main(), 0)
        return json.loads(out.getvalue())

    def snapshot(self, folder):
        return {str(p.relative_to(folder)): p.read_bytes() for p in Path(folder).rglob('*') if p.is_file()}

    def ownership_views(self):
        return [A.public(self.a),
                A.public({**self.a, 'folder': '/worktree', 'taskKey': 'a#4'}),
                A.public({**self.a, 'folder': '/worktree', 'task': None}),
                self.command_json('show', self.a['id']),
                self.command_json('list', '--all')]

    def test_auxiliary_json_values_preserve_task_and_proof_ownership(self):
        self.write_task('a', '/a', 'A', {'id': self.a['id']})
        Path(self.tasks, 'legacy.json').write_text(json.dumps(dict(folder='/legacy', tasks=[dict(id=8, space='C', proof='old-proof')])))
        tasks, views = A.ownership_tasks(), self.ownership_views()
        self.assertTrue(all(v['space'] == 'A' for v in views[:-1]))
        self.assertEqual(views[-1]['artifacts'][0]['space'], 'A')
        for value in ([], [{'news': 'synthetic entry'}], None, 'auxiliary', 7, True):
            with self.subTest(value=value):
                Path(self.tasks, '.newslog.json').write_text(json.dumps(value))
                before = self.snapshot(self.root)
                self.assertEqual(A.ownership_tasks(), tasks)
                self.assertEqual(self.ownership_views(), views)
                self.assertEqual(A.public(dict(id='old-proof', folder='/legacy', task='#8'))['space'], 'C')
                self.assertEqual(self.snapshot(self.root), before)

    def test_absent_and_invalid_tasks_collections_preserve_valid_lists(self):
        tasks, views = A.ownership_tasks(), self.ownership_views()
        for value in ({}, {'tasks': None}, {'tasks': []}, {'tasks': False}, {'tasks': 0},
                      {'tasks': 7}, {'tasks': True}, {'tasks': 'invalid'}, {'tasks': {}},
                      {'tasks': {'id': 4, 'space': 'wrong'}}):
            with self.subTest(value=value):
                Path(self.tasks, 'auxiliary.json').write_text(json.dumps(value))
                before = self.snapshot(self.root)
                self.assertEqual(A.ownership_tasks(), tasks)
                self.assertEqual(self.ownership_views(), views)
                self.assertEqual(self.snapshot(self.root), before)

    def test_non_object_rows_preserve_all_valid_associations_and_ambiguity(self):
        path = Path(self.tasks, 'a.json')
        data = json.loads(path.read_text())
        data['tasks'].append(dict(id=5, space='A', proof=self.a['id']))
        path.write_text(json.dumps(data))
        tasks, views = A.ownership_tasks(), self.ownership_views()
        data['tasks'] = [None, [], 'invalid', 7, False, data['tasks'][0], ['nested'], data['tasks'][1], True]
        path.write_text(json.dumps(data))
        before = self.snapshot(self.root)
        self.assertEqual(A.ownership_tasks(), tasks)
        self.assertEqual(self.ownership_views(), views)
        self.assertEqual(self.snapshot(self.root), before)
        Path(self.tasks, '.newslog.json').write_text('[{"news":"synthetic entry"}]')
        self.write_task('b', '/b', 'B', {'id': self.a['id']})
        before = self.snapshot(self.root)
        self.assertTrue(all(v['space'] is None for v in self.ownership_views()[:-1]))
        self.assertIsNone(self.command_json('list', '--all')['artifacts'][0]['space'])
        self.assertEqual(self.snapshot(self.root), before)

    def test_publish_and_update_keep_durable_owner_beside_news_log(self):
        Path(self.tasks, '.newslog.json').write_text('[{"news":"synthetic entry"}]')
        source = Path(self.root, 'recipe')
        source.mkdir()
        (source / 'recipe.json').write_text('{"recipe":1,"blocks":[{"type":"text","md":"Synthetic proof"}]}')
        folder = Path(self.root, 'project')
        folder.mkdir()
        self.write_task('a', str(folder), 'A')
        before = self.snapshot(self.tasks)
        opts = dict(id=None, title='SHOP-4: Synthetic proof', folder=str(folder), task=None, note=None, json=True,
                    custom=False, dir=str(source), no_install=True)
        # Only native drawing and terminal identity are inert; publishing and ownership use the real helper/store.
        with mock.patch.object(A, 'APP', os.path.join(self.root, 'app')), \
                mock.patch.object(A, 'check', return_value=(None, [], None)), \
                mock.patch.object(A, 'me', return_value=dict(terminal='t1', task='SHOP-4', taskKey='a#4', space='A')):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(A.cmd_publish(types.SimpleNamespace(**opts)), 0)
            published = json.loads(out.getvalue())
            self.assertEqual((published['task'], published['taskKey'], published['space']), ('SHOP-4', 'a#4', 'A'))
            with mock.patch.object(A, 'me', return_value=dict(terminal='t2', task='SHOP-4', taskKey='b#4', space='B')):
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(A.cmd_publish(types.SimpleNamespace(**{**opts, 'id': published['id']})), 0)
        shown = self.command_json('show', published['id'])
        self.assertEqual((shown['version'], shown['task'], shown['taskKey'], shown['space']), (2, 'SHOP-4', 'a#4', 'A'))
        listed = self.command_json('list', '--folder', str(folder))['artifacts']
        self.assertEqual(listed, [shown])
        self.assertEqual(self.snapshot(self.tasks), before)

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
        with mock.patch.object(A, 'web_base', return_value='https://example.test/'), mock.patch.object(A, 'source_id', return_value='vm-core'):
            self.assertEqual(A.web_link(self.a['id'], 'vm'), 'https://example.test/?artifact=proof-1234&origin=vm-core')
        with mock.patch.dict(os.environ, {'HC_TERMINAL_ID': 't1'}), mock.patch.object(A, 'source_id', return_value='vm-core'), mock.patch.object(A, 'run', return_value=types.SimpleNamespace(returncode=0)) as run:
            self.assertTrue(A.ask_screen(self.a['id'], 'vm'))
        ask = json.loads(run.call_args.args[0][-1].split('=', 1)[1])
        self.assertEqual((ask['artifact'], ask['machine']), (self.a['id'], 'vm'))

    def test_remote_cli_open_qualifies_the_owner_and_targets_its_own_tab(self):
        def run(args):
            if 'show' in args:
                data = dict(self.a, space='A')
            elif args == ['herdr-app', 'ls']:
                data = {'spaces': [{'id': 'vm/A', 'machine': 'vm', 'tabs': []}]}
            else:
                data = {}
            return types.SimpleNamespace(returncode=0, stdout=json.dumps(data), stderr='')
        with mock.patch.object(A, 'run', side_effect=run) as calls, mock.patch.object(A, 'pull', return_value='art-vm-proof-1234'):
            A.open_window(self.opts(machine='vm', tab=True))
        self.assertIn(mock.call(['herdr-app', 'do', 'space.select', '--id', 'vm/A']), calls.call_args_list)
        self.assertIn(mock.call(['herdr-app', 'do', 'tab.new', '--space', 'vm/A', '--mod', 'art-vm-proof-1234']), calls.call_args_list)

    def test_explicit_pane_from_another_space_is_refused(self):
        listing = {'spaces': [{'id': 'A', 'tabs': [{'terminals': [{'pane': 'pane-a'}]}]}]}
        with mock.patch.object(A, 'local_mod', return_value='art-proof-1234'), mock.patch.object(A, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=json.dumps(listing))) as run:
            with self.assertRaisesRegex(A.Fail, 'not in.*owning space'):
                A.open_window(self.opts(beside='pane-b'))
        self.assertFalse(any('space.select' in c.args[0] or 'pane.split' in c.args[0] for c in run.call_args_list))

    def test_remote_viewer_name_collision_is_refused_without_renaming_mods(self):
        app = os.path.join(self.root, 'app')
        mod = 'art-vm-a-proof-1234'
        path = os.path.join(app, 'mods', mod)
        os.makedirs(path)
        with open(os.path.join(path, 'artifact.js'), 'w') as f:
            f.write('export const machine = "vm.a";\n')
        with mock.patch.object(A, 'APP', app):
            A.remote_viewer_owner(mod, 'vm.a')
            with self.assertRaisesRegex(A.Fail, 'another machine'):
                A.remote_viewer_owner(mod, 'vm-a')

            # Exercise pull itself: a cached equal version must not bypass that ownership check.
            def transfer(argv, **kwargs):
                if argv[0] == 'tar':
                    with open(os.path.join(argv[2], '.record.json'), 'w') as f:
                        json.dump(dict(self.a, publisher=None), f)
                return types.SimpleNamespace(returncode=0, stdout=b'pack', stderr=b'')
            with mock.patch.object(A.subprocess, 'run', side_effect=transfer), mock.patch.object(A, 'current', return_value=True):
                with self.assertRaisesRegex(A.Fail, 'another machine'):
                    A.pull(self.a['id'], 'vm-a')
