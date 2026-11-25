// Linux: bun scripts/measure-document-preview.ts
// Measure the real subprocess boundary on synthetic files, never live documents.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREVIEW } from '../core/documents.js';
import { makeDelimited } from '../test/document-preview-fixtures.ts';
const helper = new URL('../mods/workspace-document/preview-read.py', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'measure-document-preview-'));
function measure(path: string, op: string, args = {}) {
  const runner = `import resource, subprocess, sys, time
start = time.monotonic()
result = subprocess.run([sys.executable, *sys.argv[1:]], capture_output=True)
sys.stdout.buffer.write(result.stdout)
sys.stderr.write(f'{time.monotonic()-start:.3f} s wall, {resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss} KiB peak RSS')
if result.stderr: sys.stderr.buffer.write(result.stderr)
sys.exit(result.returncode)`;
  const run = Bun.spawnSync(['python3', '-c', runner, helper, JSON.stringify({path, op, policy: PREVIEW, ...args})], {stdout:'pipe',stderr:'pipe'});
  const out = JSON.parse(run.stdout.toString());
  if (run.exitCode || out.error) throw Error(out.error ?? run.stderr.toString());
  console.log(`  ${op.padEnd(6)} ${run.stderr.toString().trim()}, ${run.stdout.length.toLocaleString('en-US')} B reply`);
  return out;
}
function jump(path: string, scan: any, row: number) {
  row = Math.floor(row / PREVIEW.pageRows) * PREVIEW.pageRows;
  const index = Math.floor(row / PREVIEW.indexStride);
  const data = measure(path, 'table', {version:scan.version,delimiter:scan.delimiter,row,col:0,base:index*PREVIEW.indexStride,offset:scan.offsets[index]});
  console.log(`    rows ${row+1}–${row+data.rows.length}; first ID ${data.rows[0]?.[0]}, last ID ${data.rows.at(-1)?.[0]}`);
}
try {
  for (const [name, mib, delimiter] of [['orders.csv',25,','],['orders.tsv',25,'\t'],['near-cap.csv',31.8,',']] as const) {
    const fixture=makeDelimited(join(root,name),mib*1024*1024,delimiter);
    console.log(`${name}: ${(fixture.size/1024/1024).toFixed(2)} MiB (${fixture.size.toLocaleString('en-US')} bytes), ${fixture.rows.toLocaleString('en-US')} records`);
    const open=measure(fixture.path,'open');
    const scan=measure(fixture.path,'scan',{version:open.version});
    if(scan.total!==fixture.rows)throw Error('Incorrect record count');
    console.log(`    total ${scan.total.toLocaleString('en-US')}; ${scan.offsets.length} checkpoints; ${scan.cols} columns; first page ${scan.rows.length} rows`);
    jump(fixture.path,scan,100000);jump(fixture.path,scan,scan.total-1);
    measure(fixture.path,'source',{version:open.version,page:Math.floor(open.size/PREVIEW.sourceBytes/2)});
  }
  const dense=join(root,'dense.csv');writeFileSync(dense,Buffer.from('a\n'.repeat(PREVIEW.csvRows)));
  console.log(`dense.csv: ${PREVIEW.csvRows.toLocaleString('en-US')} tiny records`);
  const scan=measure(dense,'scan');console.log(`    total ${scan.total.toLocaleString('en-US')}; ${scan.offsets.length} checkpoints; capped=${scan.limited}`);jump(dense,scan,scan.total-1);
} finally {rmSync(root,{recursive:true,force:true});}
