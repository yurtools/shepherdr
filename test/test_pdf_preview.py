import home_guard  # noqa: F401
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock
from pdf_fixture import pdf_bytes

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pdf_render', ROOT / 'lib/pdf-render.py')
pdf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pdf)


@unittest.skipUnless(shutil.which('pdfinfo') and shutil.which('pdftoppm'), 'Poppler is required for actual raster tests')
class PdfPreview(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.file = self.root / 'sample.pdf'; self.file.write_bytes(pdf_bytes())
        self.request = {'root': str(self.root / 'cache'), 'token': 'test-session', 'path': str(self.file), 'op': 'render'}

    def test_real_pages_are_pngs_navigation_and_cleanup_are_bounded(self):
        first = pdf.preview(self.request)
        self.assertEqual((first['pages'], first['page']), (2, 1))
        self.assertLessEqual(max(first['width'], first['height']), 2000)
        self.assertGreater(Path(first['image']).stat().st_size, 10000)
        second = pdf.preview({**self.request, 'page': 2, 'keep': Path(first['image']).name})
        self.assertNotEqual(Path(first['image']).read_bytes(), Path(second['image']).read_bytes())
        for i in range(6):
            second = pdf.preview({**self.request, 'page': i % 2 + 1, 'keep': Path(second['image']).name})
            self.assertLessEqual(len(list((self.root / 'cache/test-session').iterdir())), 2)
        pdf.preview({**self.request, 'op': 'close'})
        self.assertFalse((self.root / 'cache/test-session').exists())
        self.assertEqual(self.file.read_bytes(), pdf_bytes())

    def test_identical_relative_paths_and_external_changes_remain_distinct(self):
        other = self.root / 'other'; other.mkdir(); other = other / self.file.name; other.write_bytes(pdf_bytes(label='Other space'))
        one = pdf.preview(self.request)
        two = pdf.preview({**self.request, 'path': str(other), 'token': 'other-session'})
        self.assertNotEqual(one['image'], two['image'])
        self.assertNotEqual(Path(one['image']).read_bytes(), Path(two['image']).read_bytes())
        self.file.write_bytes(pdf_bytes(label='External edit'))
        changed = pdf.preview({**self.request, 'op': 'stat'})
        self.assertNotEqual(one['version'], changed['version'])
        reopened = pdf.preview(self.request)
        self.assertEqual(changed['version'], reopened['version'])

    def test_corrupt_encrypted_missing_and_oversize_files_fail_without_writes(self):
        self.file.write_bytes(b'%PDF-1.7\ncorrupt')
        with self.assertRaisesRegex(ValueError, 'password-protected, corrupt or unsupported'): pdf.preview(self.request)
        if shutil.which('qpdf'):
            self.file.write_bytes(pdf_bytes()); encrypted = self.root / 'locked.pdf'
            subprocess.run(['qpdf', '--encrypt', 'fixture-password', 'fixture-owner', '256', '--', str(self.file), str(encrypted)], check=True)
            with self.assertRaisesRegex(ValueError, 'password-protected'): pdf.preview({**self.request, 'path': str(encrypted)})
        self.file.unlink()
        with self.assertRaises(FileNotFoundError): pdf.preview(self.request)
        with self.file.open('wb') as f: f.truncate(pdf.MAX_FILE + 1)
        with self.assertRaisesRegex(ValueError, '128 MiB'): pdf.preview(self.request)

    def test_large_page_count_renders_only_requested_page(self):
        self.file.write_bytes(pdf_bytes(pages=1200))
        out = pdf.preview({**self.request, 'page': 1199})
        self.assertEqual((out['pages'], out['page']), (1200, 1199))
        self.assertEqual(len(list((self.root / 'cache/test-session').glob('*.png'))), 1)

    def test_missing_dependency_timeout_and_invalid_token_have_actionable_errors(self):
        with mock.patch.object(pdf.subprocess, 'run', side_effect=FileNotFoundError):
            with self.assertRaisesRegex(ValueError, 'needs Poppler'): pdf.preview(self.request)
        with mock.patch.object(pdf.subprocess, 'run', side_effect=subprocess.TimeoutExpired('pdfinfo', 12)):
            with self.assertRaisesRegex(ValueError, 'too long'): pdf.preview(self.request)
        with self.assertRaisesRegex(ValueError, 'cache session'): pdf.preview({**self.request, 'token': '../escape'})

    def test_cli_json_and_real_exit_codes(self):
        result = subprocess.run(['python3', str(ROOT / 'lib/pdf-render.py'), json.dumps(self.request)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0); self.assertEqual(json.loads(result.stdout)['pages'], 2)
        self.file.write_bytes(b'corrupt')
        result = subprocess.run(['python3', str(ROOT / 'lib/pdf-render.py'), json.dumps(self.request)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1); self.assertIn('error', json.loads(result.stdout))
