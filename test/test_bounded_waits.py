import home_guard  # noqa: F401
import pathlib
import subprocess
import unittest


class BoundedWaits(unittest.TestCase):
    def test_actual_native_wait_loops(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        result = subprocess.run(
            ["node", "--expose-gc", "test/fixtures/bounded-waits.mjs"],
            cwd=root, capture_output=True, text=True, timeout=90,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
