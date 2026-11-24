"""Byte-backed native clipboard readers, on a throwaway home with no desktop access."""
import home_guard  # noqa: F401
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ChatClipboard(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_native_reader_bytes_and_delivery(self):
        with tempfile.TemporaryDirectory(prefix='chat-clipboard-') as scratch:
            r = subprocess.run(['node', str(ROOT / 'test/fixtures/chat-clipboard.mjs'), str(ROOT), scratch], cwd=scratch, env=os.environ.copy(), capture_output=True, text=True, timeout=30)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn('byte-identical', r.stdout)


if __name__ == '__main__':
    unittest.main()
