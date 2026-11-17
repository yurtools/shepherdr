import home_guard  # noqa: F401
import copy
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
LOADER = importlib.machinery.SourceFileLoader('space_folder', str(ROOT / 'mods/shepherdr-settings/space-folder.py'))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
F = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(F)


class SpaceFolder(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old = self.root / 'old'
        self.new = self.root / 'new project'
        self.old.mkdir()
        self.new.mkdir()
        self.app = self.root / 'app'
        self.data = self.app / 'data'
        self.data.mkdir(parents=True)
        self.roots = self.data / 'workspace-folders.json'
        self.roots.write_text(json.dumps({'sp1': str(self.old), 'sp2': '/other/project'}))
        self.env = mock.patch.dict(os.environ, {'HERDR_APP_HOME': str(self.app)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.doc = {'spaces': [
            {'id': 'sp1', 'name': 'One', 'folder': '/original/fallback', 'tabs': [{'id': 'tab1', 'terminal': 'worker'}]},
            {'id': 'sp2', 'name': 'Two', 'folder': '/other/project', 'tabs': []}]}
        self.version = 1
        self.writes = []

    def rpc(self, method, params):
        self.assertEqual(params['name'], 'herdr-app')
        if method == 'doc.get':
            return {'result': {'version': self.version, 'value': copy.deepcopy(self.doc)}}
        self.assertEqual(method, 'doc.set')
        self.assertEqual(params['version'], self.version)
        self.writes.append(copy.deepcopy(params['value']))
        self.doc = copy.deepcopy(params['value'])
        self.version += 1
        return {'result': {'version': self.version}}

    def save(self, **kwargs):
        return F.set_folder('sp1', str(self.new), str(self.old), call=kwargs.get('call', self.rpc))

    def test_changes_only_selected_space_and_keeps_files_root_aligned(self):
        before = copy.deepcopy(self.doc)
        result = self.save()
        expected = copy.deepcopy(before)
        expected['spaces'][0]['folder'] = str(self.new)
        self.assertEqual(self.doc, expected)
        self.assertEqual(result['folder'], str(self.new))
        self.assertEqual(json.loads(self.roots.read_text()), {'sp1': str(self.new), 'sp2': '/other/project'})
        self.assertEqual(self.roots.stat().st_mode & 0o777, 0o600)

    def test_rejects_missing_relative_and_invalid_paths_before_writing(self):
        for value in ['', '.', 'relative', str(self.root / 'missing'), str(self.new) + '\n']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                F.set_folder('sp1', value, str(self.old), call=lambda *_: self.fail('must not call core'))
        with self.assertRaisesRegex(ValueError, 'local'):
            F.set_folder('remote/sp1', str(self.new), str(self.old), call=self.rpc)
        self.assertFalse(self.writes)

    def test_changed_folder_requires_reload_instead_of_overwriting(self):
        with self.assertRaisesRegex(ValueError, 'changed elsewhere'):
            F.set_folder('sp1', str(self.new), '/stale/folder', call=self.rpc)
        self.assertFalse(self.writes)
        self.assertEqual(json.loads(self.roots.read_text())['sp1'], str(self.old))

    def test_cas_retry_preserves_tabs_changed_concurrently(self):
        conflict = [True]
        def call(method, params):
            if method == 'doc.set' and conflict[0]:
                conflict[0] = False
                self.doc['spaces'][1]['tabs'].append({'id': 'new-concurrent-tab'})
                self.version += 1
                return {'error': {'data': {'kind': 'conflict'}}}
            return self.rpc(method, params)
        self.save(call=call)
        self.assertEqual(self.doc['spaces'][1]['tabs'], [{'id': 'new-concurrent-tab'}])

    def test_closed_space_and_core_errors_do_not_change_files_roots(self):
        self.doc['spaces'] = self.doc['spaces'][1:]
        with self.assertRaisesRegex(ValueError, 'no longer'):
            self.save()
        self.assertFalse(self.writes)
        self.assertEqual(json.loads(self.roots.read_text())['sp1'], str(self.old))

    def test_core_write_error_leaves_files_roots_unchanged(self):
        def call(method, params):
            return self.rpc(method, params) if method == 'doc.get' else {'error': {'data': {'kind': 'unavailable'}}}
        with self.assertRaisesRegex(ValueError, 'could not save'):
            self.save(call=call)
        self.assertFalse(self.writes)
        self.assertEqual(json.loads(self.roots.read_text())['sp1'], str(self.old))
        self.assertEqual(list(self.data.glob('.workspace-folders-*')), [])

    def test_lost_success_response_is_reconciled_before_publishing_files_root(self):
        def call(method, params):
            result = self.rpc(method, params)
            if method == 'doc.set':
                raise TimeoutError('response lost after commit')
            return result
        self.save(call=call)
        self.assertEqual(self.doc['spaces'][0]['folder'], str(self.new))
        self.assertEqual(json.loads(self.roots.read_text())['sp1'], str(self.new))

    def test_unconfirmed_save_keeps_files_root_and_reports_uncertainty(self):
        def call(method, params):
            if method == 'doc.set':
                raise TimeoutError('not committed')
            return self.rpc(method, params)
        with self.assertRaisesRegex(ValueError, 'could not be confirmed'):
            self.save(call=call)
        self.assertFalse(self.writes)
        self.assertEqual(json.loads(self.roots.read_text())['sp1'], str(self.old))

    def test_files_write_failure_restores_native_folder(self):
        before = copy.deepcopy(self.doc)
        with mock.patch.object(F.os, 'replace', side_effect=OSError('disk unavailable')):
            with self.assertRaisesRegex(ValueError, 'was restored'):
                self.save()
        self.assertEqual(self.doc, before)
        self.assertEqual(json.loads(self.roots.read_text())['sp1'], str(self.old))
        self.assertEqual(list(self.data.glob('.workspace-folders-*')), [])

    def test_rollback_does_not_override_a_later_folder_edit(self):
        def fail_replace(*_):
            self.doc['spaces'][0]['folder'] = '/someone/elses/edit'
            raise OSError('disk unavailable')
        with mock.patch.object(F.os, 'replace', side_effect=fail_replace):
            with self.assertRaisesRegex(ValueError, 'may have changed'):
                self.save()
        self.assertEqual(self.doc['spaces'][0]['folder'], '/someone/elses/edit')


if __name__ == '__main__':
    unittest.main()
