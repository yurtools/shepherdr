import home_guard  # noqa: F401 — keep tests off the real home
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parents[1] / 'patches/herdr-app/0.1.16/code-line-endings'
spec = importlib.util.spec_from_file_location('code_patch_verifier', PACKAGE / 'verify.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class MarkdownCodePatch(unittest.TestCase):
    def test_audit_fixtures_are_byte_exact_and_complete(self):
        raw = (PACKAGE / 'fixtures.json').read_bytes()
        manifest = json.loads((PACKAGE / 'manifest.json').read_text())
        self.assertEqual(hashlib.sha256(raw).hexdigest(), manifest['audit_fixtures_sha256'])
        fixtures = json.loads(raw)
        self.assertEqual(len(fixtures), 39)
        families = {name.rsplit('-', 1)[0] for name in fixtures}
        self.assertEqual(len(families), 13)
        for family in families:
            lf = fixtures[family + '-LF']
            self.assertNotIn('\r', lf)
            self.assertEqual(fixtures[family + '-CRLF'], lf.replace('\n', '\r\n'))
            self.assertEqual(fixtures[family + '-CR'], lf.replace('\n', '\r'))

    def test_verifier_refuses_mismatched_source_before_creating_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, work = root / 'source', root / 'work'
            source.mkdir()
            (source / 'Cargo.toml').write_text('wrong runtime')
            with self.assertRaisesRegex(ValueError, 'Unexpected runtime bytes'):
                verifier.prepare(source, work)
            self.assertFalse(work.exists())

    def test_scratch_preparation_preserves_input_and_refuses_existing_or_nested_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package, source = root / 'package', root / 'source'
            package.mkdir(); source.mkdir()
            adapter = source / verifier.ADAPTER
            adapter.parent.mkdir(parents=True)
            adapter.write_bytes(b'original runtime source\r\n')
            manifest = {'files': {str(verifier.ADAPTER): hashlib.sha256(adapter.read_bytes()).hexdigest()}}
            (package / 'manifest.json').write_text(json.dumps(manifest))
            # Exercise preparation safety with inert bytes; no Cargo process runs.
            harness = root / 'harness'; harness.mkdir()
            (harness / 'Cargo.toml').write_text('markdown-font-regression')
            lock = '\n\n'.join(f'[[package]]\nname = "{name}"\nversion = "0.0.0"' for name in ['unicode-id', 'serde_json'])
            (harness / 'Cargo.lock').write_text(lock)
            (source / 'Cargo.lock').write_text(lock)
            (package / 'harness').mkdir()
            (package / 'harness/main.rs').write_text('// fixture; never executed')
            with patch.object(verifier, 'PACKAGE', package):
                existing = root / 'exists'; existing.mkdir()
                for output in [existing, source / 'nested']:
                    with self.assertRaisesRegex(ValueError, 'NEW scratch'):
                        verifier.prepare(source, output)
                self.assertEqual(adapter.read_bytes(), b'original runtime source\r\n')
                self.assertFalse((source / 'nested').exists())
                prepared = verifier.prepare(source, root / 'prepared')
                self.assertEqual((prepared / 'runtime' / verifier.ADAPTER).read_bytes(), adapter.read_bytes())
                self.assertEqual((prepared / 'original-markdown.rs').read_bytes(), adapter.read_bytes())
                self.assertEqual(adapter.read_bytes(), b'original runtime source\r\n')

    def test_parser_lock_uses_host_versions_and_rejects_missing_entries(self):
        harness = '\n\n'.join(f'[[package]]\nname = "{name}"\nversion = "0.0.0"' for name in ['unicode-id', 'serde_json'])
        host = harness.replace('0.0.0', '0.3.6')
        self.assertEqual(verifier.parser_lock(harness, host), host)
        with self.assertRaisesRegex(ValueError, 'Missing exact host'):
            verifier.parser_lock(harness, '')


if __name__ == '__main__':
    unittest.main()
