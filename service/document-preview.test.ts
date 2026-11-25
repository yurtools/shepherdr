import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, truncateSync, openSync, closeSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREVIEW, canEdit, csvPage, delimiterFor, markdownExcerpt, utf8Bytes } from '../core/documents.js';
import { makeDelimited } from '../test/document-preview-fixtures.ts';

const helper = new URL('../mods/workspace-document/preview-read.py', import.meta.url).pathname;
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'document-preview-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function file(name: string, value: string | Uint8Array) { const path = join(root, name); writeFileSync(path, value); return path; }
function call(path: string, op: string, args = {}, policy = PREVIEW) {
  const proc = Bun.spawnSync(['python3', helper, JSON.stringify({path, op, policy, ...args})], { stdout: 'pipe', stderr: 'pipe' });
  const out = JSON.parse(proc.stdout.toString());
  expect(proc.exitCode).toBe(out.error ? 1 : 0);
  return { ...out, wireBytes: proc.stdout.length };
}
function page(path: string, scan: any, row: number, col = 0) {
  const index = Math.floor(row / PREVIEW.indexStride);
  return call(path, 'table', { version: scan.version, row, col, delimiter: scan.delimiter, base: index * PREVIEW.indexStride, offset: scan.offsets[index] });
}

test('full source is only returned within both byte and UTF-16 budgets; boundary source pages keep every byte', () => {
  for (const [value, editable] of [
    ['x'.repeat(PREVIEW.editChars), true], ['x'.repeat(PREVIEW.editChars + 1), false],
    ['🦀'.repeat(PREVIEW.editChars / 2), true], ['🦀'.repeat(PREVIEW.editChars / 2 + 1), false],
    ['界'.repeat(Math.floor(PREVIEW.editBytes / 3)) + 'x', true], ['界'.repeat(Math.floor(PREVIEW.editBytes / 3)) + 'xx', false],
  ] as const) {
    const path = file('text.txt', value), out = call(path, 'open');
    expect(canEdit(value)).toBe(editable); expect(utf8Bytes(value)).toBe(Buffer.byteLength(value));
    if (editable) expect(out.text).toBe(value);
    else { expect(out.text).toBeUndefined(); expect(out.source.start).toBe(0); expect(out.source.end).toBeLessThanOrEqual(PREVIEW.sourceBytes + 3); }
  }
  const source = '\uFEFF' + 'a'.repeat(PREVIEW.sourceBytes - 4) + '🦀\r\n' + 'café\r東京\n'.repeat(50000);
  const path = file('mixed.md', source), initial = call(path, 'open');
  expect(initial.text).toBeUndefined();
  const chunks = []; let end = 0;
  for (let i = 0; i < Math.ceil(initial.size / PREVIEW.sourceBytes); i++) {
    const out = call(path, 'source', { version: initial.version, page: i });
    expect(out.source.start).toBe(end); end = out.source.end;
    expect(Buffer.byteLength(out.source.text)).toBe(out.source.end - out.source.start);
    chunks.push(out.source.text);
  }
  expect(chunks.join('')).toBe(source); expect(end).toBe(initial.size);
  expect(readFileSync(path)).toEqual(Buffer.from(source));
  expect(call(file('zero.txt', ''), 'open').text).toBe('');
  expect(call(file('binary.txt', new Uint8Array([65, 0, 66])), 'open').error).toContain('Binary');
  expect(call(file('invalid.txt', new Uint8Array([0xff])), 'open').error).toContain('UTF-8');
  expect(canEdit('\ud800')).toBe(false);
}, 15000);

test('Markdown preview has an independent character/line budget and does not change source', () => {
  const source = '# Head\n' + '- line\r\n'.repeat(2000) + 'last 🦀';
  const out = markdownExcerpt(source); expect(out.limited).toBe(true);
  expect(out.text.split(/\r?\n/).length).toBeLessThanOrEqual(PREVIEW.markdownLines);
  expect(markdownExcerpt('x'.repeat(PREVIEW.markdownChars - 1) + '🦀').text.endsWith('\ud83e')).toBe(false);
  expect(source.endsWith('last 🦀')).toBe(true);
});

for (const [name, mib, delimiter] of [['orders.csv', 25, ','], ['orders.tsv', 25, '\t']] as const) {
  test(`${mib} MiB ${name}: exact count, first/middle/last page and no full-buffer transfer`, () => {
    const fixture = makeDelimited(join(root, name), mib * 1024 * 1024, delimiter);
    expect(fixture.size).toBeGreaterThanOrEqual(mib * 1024 * 1024);
    const opened = call(fixture.path, 'open'); expect(opened.text).toBeUndefined(); expect(opened.wireBytes).toBeLessThan(100000);
    const scan = call(fixture.path, 'scan', { version: opened.version });
    expect(scan.total).toBe(fixture.rows); expect(scan.cols).toBe(5); expect(scan.delimiter).toBe(delimiter); expect(scan.limited).toBe(false);
    expect(scan.rows.length).toBe(PREVIEW.pageRows); expect(scan.rows[0]).toEqual(['record', 'status', 'description', 'quantity', 'region']);
    expect(scan.wireBytes).toBeLessThan(100000); expect(scan.offsets.length).toBeLessThan(1000);
    for (const i of [40, 112, PREVIEW.indexStride - 4, PREVIEW.indexStride, 100000, fixture.rows - 1]) {
      const row = Math.floor(i / PREVIEW.pageRows) * PREVIEW.pageRows, data = page(fixture.path, scan, row);
      expect(data.rows.length).toBe(Math.min(PREVIEW.pageRows, fixture.rows - row)); expect(data.rows[0][0]).toBe(String(row));
      expect(data.rows[i - row][0]).toBe(String(i)); expect(data.rows[i - row][2]).toContain('"quoted" text');
      expect(data.wireBytes).toBeLessThan(100000);
    }
    expect(page(fixture.path, scan, 80).rows[33][2]).toContain('\r\nsecond line');
  }, 15000);
}

test('delimiter detection handles multiline header, UTF-8 BOM, empty quoted record, CR, CRLF and LF; indexed and buffer parsers agree', () => {
  const source = '\uFEFF"first\r\nline";"second";end\r' + '"a;z";"b""c";\r\n'.repeat(1100) + '""\n\n""';
  const path = file('semi.csv', source), scan = call(path, 'scan');
  expect(scan.delimiter).toBe(';'); expect(delimiterFor(source, path)).toBe(';');
  const local = csvPage(source, ';', 0, 0); expect(scan.rows).toEqual(local.rows); expect(scan.total).toBe(local.total);
  for (const row of [40, 1020, 1080]) expect(page(path, scan, row).rows).toEqual(csvPage(source, ';', row).rows);
  expect(call(file('empty.csv', '\uFEFF'), 'scan').total).toBe(0);
  expect(call(file('quoted.csv', '""'), 'scan').rows).toEqual([['']]);
  expect(call(file('forced.csv', 'x;y,z\n'), 'scan', {delimiter: ';'}).rows).toEqual([['x', 'y,z']]);
});

test('wide and long records retain exact column counts but bound the page payload', () => {
  const columns = Array.from({length: 2000}, (_, i) => `c${i}`), long = '界'.repeat(PREVIEW.cellChars + 30);
  const path = file('wide.csv', columns.join(',') + '\r\n' + [long, ...columns.slice(1)].join(',') + '\r\n');
  const scan = call(path, 'scan'); expect(scan.cols).toBe(2000); expect(scan.total).toBe(2); expect(scan.clipped).toBe(true);
  expect(scan.rows[1][0]).toBe('界'.repeat(PREVIEW.cellChars) + '…');
  expect(scan.rows[0]).toHaveLength(PREVIEW.pageCols);
  const tail = page(path, scan, 0, 1984); expect(tail.rows[0].at(-1)).toBe('c1999');
  expect(csvPage(readFileSync(path, 'utf8'), ',', 0, 1984).rows).toEqual(tail.rows);
  const worst = file('payload.csv', Array.from({length: PREVIEW.pageRows}, () => Array(PREVIEW.pageCols).fill('\x01'.repeat(PREVIEW.cellChars)).join(',')).join('\n'));
  expect(call(worst, 'scan').wireBytes).toBeLessThan(1024 * 1024);
});

test('file, record, row, and malformed-input limits are explicit; source remains available', () => {
  const path = file('large.csv', 'a\n'); truncateSync(path, PREVIEW.csvBytes + 1);
  expect(call(path, 'scan').error).toContain('32 MiB');
  // A real text file over the table limit is still source-browsable.
  const f = openSync(path, 'w'), chunk = Buffer.from('x\n'.repeat(65536));
  try { for (let n = 0; n <= PREVIEW.csvBytes; n += chunk.length) writeSync(f, chunk); } finally { closeSync(f); }
  const opened = call(path, 'open'); expect(opened.source.text).toBeDefined(); expect(opened.text).toBeUndefined();
  const maximal = file('record.csv', 'x'.repeat(PREVIEW.recordBytes - 1) + '\n');
  expect(call(maximal, 'scan').total).toBe(1);
  expect(call(file('record-too-long.csv', 'x'.repeat(PREVIEW.recordBytes) + '\n'), 'scan').error).toContain('record exceeds');
  expect(call(file('multiline.csv', '"' + 'x\n'.repeat(PREVIEW.recordBytes / 2) + '"'), 'scan').error).toContain('record exceeds');
  expect(call(file('malformed.csv', 'a,b\n"unterminated'), 'scan').error).toBeDefined();
  const rowLimit = file('row-limit.csv', 'a\n'.repeat(PREVIEW.csvRows + 1));
  const scan = call(rowLimit, 'scan'); expect(scan.total).toBe(PREVIEW.csvRows); expect(scan.limited).toBe(true);
  expect(page(rowLimit, scan, PREVIEW.csvRows - PREVIEW.pageRows).rows).toHaveLength(PREVIEW.pageRows);
  writeFileSync(rowLimit, 'a\n'.repeat(PREVIEW.csvRows)); expect(call(rowLimit, 'scan').limited).toBe(false);
}, 30000);

test('a replaced or changed source cannot use a stale table index or source version', () => {
  const path = file('changed.csv', 'a,b\r\n'.repeat(1000));
  const scan = call(path, 'scan'); writeFileSync(path, 'x,y\r\n'.repeat(1000));
  expect(page(path, scan, 40).error).toContain('File changed');
  expect(call(path, 'source', { version: scan.version, page: 0 }).error).toContain('File changed');
  expect(call(path, 'stat').version).not.toBe(scan.version);
  expect(call(path, 'scan').rows[0]).toEqual(['x', 'y']);
});
