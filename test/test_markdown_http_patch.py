import home_guard  # noqa: F401 — keep tests off the real home
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest

PACKAGE = Path(__file__).resolve().parents[1] / 'patches/herdr-app/0.1.16/native-http'
spec = importlib.util.spec_from_file_location('combined_http_verifier', PACKAGE / 'verify.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class NativeMarkdownTransport(unittest.TestCase):
    def test_factory_is_the_pinned_production_source_and_adapter_is_locked(self):
        manifest = json.loads((PACKAGE / 'manifest.json').read_text())
        self.assertEqual(hashlib.sha256((PACKAGE / 'client.rs').read_bytes()).hexdigest(),
                         manifest['files']['src/document_http.rs']['after'])
        lock = (PACKAGE / 'harness/Cargo.lock').read_text()
        self.assertRegex(lock, r'name = "gpui-pre-reqwest-client"\nversion = "0.3.8"\nsource = [^\n]+\nchecksum = "' + manifest['dependency']['checksum'] + '"')

    def test_integration_patch_preserves_policy_loader_and_versions(self):
        patch = (PACKAGE / 'runtime.patch').read_text()
        targets = re.findall(r'^\+\+\+ b/(.+)$', patch, re.M)
        self.assertEqual(set(targets), {'Cargo.toml', 'Cargo.lock', 'src/main.rs',
                                       'src/document_http.rs', 'THIRD-PARTY-NOTICES'})
        self.assertNotIn('+++ b/vendor/', patch)
        self.assertIn('.with_http_client(document_http::client())', patch)
        manifest_diff = patch.split('--- a/Cargo.lock\n', 1)[0]
        self.assertNotRegex(manifest_diff, re.compile(r'^[+-]version = ', re.M))

    def test_wrong_host_is_rejected_before_creating_scratch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            (source / 'Cargo.toml').write_text('wrong host')
            with self.assertRaisesRegex(ValueError, 'Unexpected runtime bytes'):
                verifier.prepare(source, root / 'output')
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
