import home_guard  # noqa: F401 — keep tests off the real home
import hashlib
import json
from pathlib import Path
import struct
import unittest

PACKAGE = Path(__file__).resolve().parents[1] / 'patches/herdr-app/0.1.16'


def tables(data):
    count = struct.unpack_from('>H', data, 4)[0]
    result = {}
    for i in range(count):
        tag, _, offset, length = struct.unpack_from('>4sIII', data, 12 + i * 16)
        result[tag] = data[offset:offset + length]
    return result


def names(table):
    _, count, strings = struct.unpack_from('>HHH', table)
    result = {}
    for i in range(count):
        platform, encoding, language, name, length, offset = struct.unpack_from('>HHHHHH', table, 6 + 12 * i)
        if platform == 3:  # OpenType Unicode name records
            result.setdefault(name, set()).add(table[strings + offset:strings + offset + length].decode('utf-16-be'))
    return result


class BundledMarkdownFaces(unittest.TestCase):
    def test_assets_contain_real_matching_style_faces_and_their_license(self):
        manifest = json.loads((PACKAGE / 'manifest.json').read_text())
        styles = set()
        for asset in manifest['assets']:
            data = (PACKAGE / asset['file']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), asset['sha256'])
            table = tables(data)
            weight = struct.unpack_from('>H', table[b'OS/2'], 4)[0]
            flags = struct.unpack_from('>H', table[b'OS/2'], 62)[0]
            self.assertEqual(weight, asset['weight'])
            self.assertEqual(bool(flags & 1), asset['italic'])
            self.assertNotIn(b'fvar', table, 'a static face must not rely on unsupported variable axes')
            labels = names(table[b'name'])
            self.assertIn('Geist', labels.get(16, labels[1]))
            self.assertTrue(any('SIL Open Font License' in label for label in labels[13]))
            styles.add((weight, bool(flags & 1)))
        self.assertEqual(styles, {(700, False), (400, True), (700, True)})
        license = manifest['font_source']
        data = (PACKAGE / license['license_file']).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), license['license_sha256'])
        self.assertIn(b'Copyright 2024 The Geist Project Authors', data)
        self.assertIn(b'SIL OPEN FONT LICENSE Version 1.1', data)


if __name__ == '__main__':
    unittest.main()
