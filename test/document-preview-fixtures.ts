// Deterministic, non-private records with delimiters, UTF-8, escaped quotes and
// quoted physical newlines. Write in batches rather than retaining the fixture.
import { closeSync, openSync, writeSync } from 'node:fs';
export function makeDelimited(path: string, bytes: number, delimiter = ',') {
  const f = openSync(path, 'w');
  let size = 0, rows = 0;
  const put = (value: string) => { size += writeSync(f, value); };
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  try {
    put(['record', 'status', 'description', 'quantity', 'region'].join(delimiter) + '\r\n'); rows++;
    while (size < bytes) {
      let batch = '';
      for (let i = 0; i < 1024; i++) {
        const note = `Synthetic order ${rows} – café 東京; comma, tab\t and "quoted" text${rows % 113 === 0 ? '\r\nsecond line' : ''}`;
        batch += [String(rows), 'complete', quote(note), String(rows % 97), 'north'].join(delimiter) + '\r\n'; rows++;
      }
      put(batch);
    }
    return { path, size, rows };
  } finally { closeSync(f); }
}
