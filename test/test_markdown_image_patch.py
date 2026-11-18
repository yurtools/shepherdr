import home_guard  # noqa: F401 — keep tests off the real home
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parents[1] / 'patches/herdr-app/0.1.16/reference-images'
spec = importlib.util.spec_from_file_location('image_patch_verifier', PACKAGE / 'verify.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class MarkdownImagePatch(unittest.TestCase):
    def test_mismatched_runtime_is_refused_before_creating_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, work = Path(tmp) / 'source', Path(tmp) / 'work'
            source.mkdir()
            (source / 'Cargo.toml').write_text('wrong runtime')
            with self.assertRaisesRegex(ValueError, 'Unexpected runtime bytes'):
                verifier.prepare(source, work)
            self.assertFalse(work.exists())

    def test_new_scratch_copy_preserves_input_and_rejects_existing_or_nested_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package, source = root / 'package', root / 'source'
            package.mkdir(); source.mkdir()
            files = {}
            for path in verifier.CHANGED:
                dest = source / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(b'original runtime bytes\r\n')
                files[str(path)] = hashlib.sha256(dest.read_bytes()).hexdigest()
            (package / 'manifest.json').write_text(json.dumps({'files': files}))
            (package / 'harness').mkdir()
            for name in ['Cargo.toml', 'Cargo.lock', 'main.rs']:
                (package / 'harness' / name).write_text('inert fixture; not executed')
            with patch.object(verifier, 'PACKAGE', package):
                existing = root / 'exists'; existing.mkdir()
                for output in [existing, source / 'nested']:
                    with self.assertRaisesRegex(ValueError, 'NEW scratch'):
                        verifier.prepare(source, output)
                prepared = verifier.prepare(source, root / 'prepared')
                for path in verifier.CHANGED:
                    original = (source / path).read_bytes()
                    self.assertEqual(original, b'original runtime bytes\r\n')
                    self.assertEqual((prepared / 'runtime' / path).read_bytes(), original)
                    self.assertEqual((prepared / 'original' / path).read_bytes(), original)
                self.assertFalse((source / 'nested').exists())

    def test_patch_is_confined_to_adapter_model_and_state(self):
        targets = [line[6:] for line in (PACKAGE / 'runtime.patch').read_text().splitlines() if line.startswith('+++ b/')]
        self.assertEqual(set(targets), {str(path) for path in verifier.CHANGED})
        # The network policy/loader is compiled from exact host bytes in tests,
        # and is deliberately not altered by the deliverable.
        manifest = json.loads((PACKAGE / 'manifest.json').read_text())
        self.assertIn(str(verifier.SHELL / 'materialize/text_view.rs'), manifest['files'])
        self.assertIn(str(verifier.SHELL / 'capability.rs'), manifest['files'])

    def test_harness_locks_the_host_parser_image_and_renderer_versions(self):
        manifest = json.loads((PACKAGE / 'manifest.json').read_text())
        lock = (PACKAGE / 'harness/Cargo.lock').read_text()
        for name, expected in manifest['harness_versions'].items():
            actual = re.findall(r'\[\[package\]\]\nname = "' + re.escape(name) + r'"\nversion = "([^"]+)"', lock)
            self.assertEqual(actual, [expected], name)


if __name__ == '__main__':
    unittest.main()
