import home_guard  # noqa: F401
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest

from pdf_fixture import pdf_bytes

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    out = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(out)
    return out


reader = module('find_reader', 'mods/workspace-document/preview-read.py')
pdf = module('find_pdf', 'lib/pdf-render.py')
# Test the actual policy's limits; no helper subprocess per batch is necessary.
POLICY = dict(editBytes=1048576, editChars=400000, sourceBytes=32768,
              csvBytes=32*1024*1024, csvRows=2000000, recordBytes=262144,
              pageRows=40, pageCols=16, cellChars=160, indexStride=1024)


class DocumentFind(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def call(self, path, op, **args):
        return reader.read(dict(path=str(path), op=op, policy=POLICY, **args))

    def test_source_utf8_page_and_batch_boundary_matches(self):
        path = self.root / 'large.txt'
        # 🦀 straddles a source page; the second match straddles a 4 MiB
        # Find batch; the last match proves that no overlap skips/doubles it.
        text = 'x' * (32768 - 2) + '🦀Needle'
        data = text.encode() + b'x' * (4*1024*1024 - len(text.encode()) - 2) + b'NEEDLE needle'
        path.write_bytes(data)
        version = self.call(path, 'stat')['version']
        first = self.call(path, 'find-source', query='needle', limit=5000, version=version)
        self.assertFalse(first['done'])
        second = self.call(path, 'find-source', query='needle', start=first['next'], limit=5000, version=version)
        self.assertTrue(second['done'])
        hits = first['hits'] + second['hits']
        expected = [(m.start(), m.end()) for m in re.finditer(b'needle', data, re.I)]
        self.assertEqual([(h['start'], h['end']) for h in hits], expected)
        self.assertEqual(hits[0]['page'], 1)
        crab = self.call(path, 'find-source', query='🦀', limit=5000, version=version)
        self.assertEqual(crab['hits'][0]['page'], 1)
        page = self.call(path, 'source', page=1, version=version)['source']
        self.assertTrue(page['text'].startswith('🦀Needle'))
        self.assertEqual(path.read_bytes(), data)

    def test_full_32_mib_table_and_wide_multiline_target(self):
        path = self.root / 'wide.tsv'
        ordinary = ('x\t'*19 + 'ordinary ' + 'a'*150 + '\r\n').encode()
        suffix = ('x\t'*19 + '"quoted\r\n' + 'z'*250 + ' Needle needle"\r\n').encode()
        rows = (POLICY['csvBytes'] - len(suffix)) // len(ordinary)
        padding = POLICY['csvBytes'] - rows*len(ordinary) - len(suffix)
        path.write_bytes(ordinary * rows + b'z'*padding + suffix)
        self.assertEqual(path.stat().st_size, POLICY['csvBytes'])
        version = self.call(path, 'stat')['version']
        table = self.call(path, 'scan', version=version)
        self.assertEqual(table['total'], rows+1)
        self.assertEqual(table['cols'], 20)
        hits = []
        row, offset, batches = 0, '0', 0
        while True:
            out = self.call(path, 'find-table', version=version, query='Needle', limit=5000, row=row, offset=offset, delimiter='\t')
            batches += 1
            hits += out['hits']
            if out['done']:
                break
            row, offset = out['row'], out['offset']
        self.assertGreater(batches, 1)
        self.assertEqual([(h['row'], h['col']) for h in hits], [(rows, 19), (rows, 19)])
        self.assertIn('Needle', hits[0]['excerpt'])
        checkpoint = rows // POLICY['indexStride']
        page = self.call(path, 'table', version=version, row=rows, col=19, base=checkpoint*POLICY['indexStride'],
                         offset=table['offsets'][checkpoint], delimiter='\t')
        self.assertEqual(page['row'], rows)
        self.assertTrue(page['clipped'])
        self.assertTrue(page['rows'][0][0].startswith('quoted\r\n'))
        self.assertEqual(path.stat().st_size, POLICY['csvBytes'])

    def test_limits_and_stale_file_are_not_reported_as_complete(self):
        path = self.root / 'many.csv'
        path.write_text('α,needle\n'*8)
        version = self.call(path, 'stat')['version']
        for op in ('find-source', 'find-table'):
            result = self.call(path, op, version=version, query='NEEDLE', limit=3, delimiter=',')
            self.assertEqual(len(result['hits']), 3)
            self.assertTrue(result['limited'])
        path.write_text('edited')
        with self.assertRaisesRegex(ValueError, 'changed on disk'):
            self.call(path, 'find-source', version=version, query='needle', limit=3)
        with self.assertRaisesRegex(ValueError, '1–256'):
            self.call(path, 'find-source', query='x'*257, limit=3)
        path.write_bytes(b'hi\x00needle')
        with self.assertRaisesRegex(ValueError, 'Binary file'):
            self.call(path, 'find-source', query='needle', limit=3)


@unittest.skipUnless(shutil.which('pdftotext') and shutil.which('pdftoppm') and shutil.which('pdfinfo'), 'Poppler required')
class PdfFind(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.path = self.root / 'report.pdf'
        self.req = dict(root=str(self.root / 'cache'), token='find-test', path=str(self.path))

    def search(self, **args):
        return pdf.preview(dict(self.req, op='find', version=pdf.fingerprint(self.path), page=1, pages=2, query='page 2', limit=5000, **args))

    def test_page_specific_phrase_boxes_and_rotation(self):
        self.path.write_bytes(pdf_bytes())
        normal = self.search()
        self.assertTrue(normal['done'])
        self.assertTrue(normal['hasText'])
        self.assertEqual([h['page'] for h in normal['hits']], [2])
        self.assertEqual(len(normal['hits'][0]['boxes']), 2)
        self.path.write_bytes(pdf_bytes(rotate=90))
        result = self.search()
        # Obtained by actual Poppler text extraction, not estimated from
        # string positions. Rotation aligns with raster dimensions.
        image = pdf.preview(dict(self.req, op='render', page=2))
        self.assertGreater(image['width'], image['height'])
        self.assertEqual([h['page'] for h in result['hits']], [2])
        box = normal['hits'][0]['boxes'][0]
        rotated = result['hits'][0]['boxes'][0]
        for actual, expected in zip(rotated, [1-box[3], box[0], 1-box[1], box[2]]):
            self.assertAlmostEqual(actual, expected, places=3)

    def test_no_text_layer_and_pdf_version_guard(self):
        self.path.write_bytes(pdf_bytes(no_text=True))
        result = self.search()
        self.assertFalse(result['hasText'])
        self.assertEqual(result['hits'], [])
        self.assertTrue(result['done'])
        version = pdf.fingerprint(self.path)
        self.path.write_bytes(pdf_bytes(label='Changed'))
        with self.assertRaisesRegex(ValueError, 'changed on disk'):
            pdf.preview(dict(self.req, op='find', version=version, page=1, pages=2, query='page', limit=5000))
