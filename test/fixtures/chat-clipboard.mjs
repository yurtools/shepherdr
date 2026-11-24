// Exercises the real native extraction shell commands against byte-backed clipboard tool fixtures.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, chmod, stat, access, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const [root, scratch] = process.argv.slice(2), bin = join(scratch, 'bin'), app = join(scratch, 'app');
const run = promisify(execFile), calls = [], puts = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
await mkdir(bin, { recursive: true });
const state = join(scratch, 'clipboard.json'), fixture = join(scratch, 'image.png');
await writeFile(fixture, png);
// Readers emit exactly their offered bytes. Shell metacharacters never become commands.
const tool = `#!/usr/bin/python3
import json,sys
s=json.load(open(${JSON.stringify(state)}))
a=sys.argv[1:]
t=a[-1] if a else ''
if '--list-types' in a or t=='TARGETS':
 print('\\n'.join(s['types']));sys.exit(s.get('listExit',0))
if t=='text/uri-list':
 print(s.get('uris',''));sys.exit(0)
if s.get('readExit'): sys.exit(1)
sys.stdout.buffer.write(open(${JSON.stringify(fixture)},'rb').read() if not s.get('empty') else b'')
`;
for (const name of ['wl-paste', 'xclip']) { await writeFile(join(bin, name), tool); await chmod(join(bin, name), 0o755); }
let backend = 'wayland';
const env = () => ({ ...process.env, PATH: `${bin}:/usr/bin:/bin`, WAYLAND_DISPLAY: backend === 'wayland' ? 'fixture' : '', DISPLAY: backend === 'x11' ? ':fixture' : '' });
globalThis.host = {
  appHome: () => app, window: () => ({ platform: 'linux' }),
  exec: async (cmd, args) => {
    calls.push([cmd, ...args]);
    try { const r = await run(cmd, args, { env: env(), timeout: 10000 }); return { code: 0, stdout: r.stdout, stderr: r.stderr }; }
    catch (e) { return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
  },
  hc: async ([command, addr, path]) => {
    assert.equal(command, 'put'); puts.push([addr, path]); const dest = join(scratch, 'remote', String(puts.length), 'image.png'); await mkdir(join(dest, '..'), { recursive: true }); await cp(path, dest); return { code: 0, stdout: JSON.stringify({ path: dest }) };
  },
};
const load = async (path, transform) => import('data:text/javascript;base64,' + Buffer.from(transform(await readFile(join(root, path), 'utf8'))).toString('base64'));
globalThis.clipboard = await load('lib/clipboard.js', s => s.replace('import { exec, appHome, window } from "herdr";', 'const {exec, appHome, window} = globalThis.host;'));
const clip = globalThis.clipboard;
const attach = await load('mods/chat/attach.js', s => s.replace('import { exec, hc, appHome, window } from "herdr";', 'const {exec, hc, appHome, window} = globalThis.host;').replace('export { fromClipboard, MAC_CLIPBOARD, filePaths, isImage, paths } from "./clipboard.js";', 'const {fromClipboard, MAC_CLIPBOARD, filePaths, isImage, paths} = globalThis.clipboard; export {fromClipboard, MAC_CLIPBOARD, filePaths, isImage, paths};'));
let count = 0;
const configure = (v) => writeFile(state, JSON.stringify(v));
for (const desktop of ['wayland', 'x11']) {
  backend = desktop;
  for (const types of [['image/png'], ['text/plain', 'text/html', 'text/uri-list', 'image/png']]) {
    await configure({ types, uris: 'https://example.invalid/metadata' });
    const [f] = await clip.fromClipboard(); assert.ok(f?.image); assert.ok(f.temp);
    assert.deepEqual(await readFile(f.path), png); assert.equal((await stat(f.path)).mode & 0o777, 0o600);
    assert.equal(puts.length, count); // Nothing transfers until the existing deliver path is invoked.
    assert.deepEqual(await attach.deliver([f], 'tfixture', null), [f.path]);
    const [remote] = await attach.deliver([f], 'other/tfixture', 'other');
    assert.deepEqual(await readFile(remote), png); count++;
  }
}
await configure({ types: ['image/png'] });
const realNow = Date.now; Date.now = () => 42;
const a = await clip.fromClipboard(), b = await clip.fromClipboard(); Date.now = realNow;
assert.notEqual(a[0].path, b[0].path); assert.deepEqual(await readFile(a[0].path), png); assert.deepEqual(await readFile(b[0].path), png);
await configure({ types: ['text/uri-list', 'image/png'], uris: '# copied files\r\nfile:///tmp/a%20b.png\r\nfile://localhost/tmp/notes.txt\r\nfile:///tmp/%24%28touch%20NEVER_EXECUTED%29.png\r\nfile:///bad%ZZ\r\nfile://remote/tmp/no.png\r\nfile:///tmp/control%0A.png' });
const files = await clip.fromClipboard(); assert.deepEqual(files.map(f => f.path), ['/tmp/a b.png', '/tmp/notes.txt', '/tmp/$(touch NEVER_EXECUTED).png']);
assert.ok(files.every(f => !f.temp));
for (const types of [[], ['text/plain', 'text/html'], ['application/x-unrelated']]) { await configure({ types }); assert.deepEqual(await clip.fromClipboard(), []); }
await configure({ types: ['image/svg+xml'] }); await assert.rejects(clip.fromClipboard(), /isn't supported/);
await configure({ types: ['image/png'], empty: true }); await assert.rejects(clip.fromClipboard(), /Couldn't read the clipboard image/);
await configure({ types: ['image/png'], readExit: 1 }); await assert.rejects(clip.fromClipboard(), /Couldn't read the clipboard image/);
await configure({ types: [], listExit: 1 }); await assert.rejects(clip.fromClipboard(), /desktop connection/);
await assert.rejects(clip.fromClipboard('windows'), /isn't supported/);
assert.ok(calls.some(c => c[0] === 'xclip' && c.includes('clipboard') && !c.includes('primary')));
attach.drop(a[0]);
for (let i = 0; i < 30; i++) { try { await access(a[0].path); await new Promise(r => setTimeout(r, 10)); } catch { break; } }
await assert.rejects(access(a[0].path)); assert.deepEqual(await readFile(b[0].path), png);
console.log(`PASS: screenshot-only and bitmap+metadata on Wayland/X11; ${count} byte-identical local/remote deliveries; selection formats, unique files, removal and read failures.`);
console.log(`PNG fixture: ${png.length} bytes; SHA-256 ${createHash('sha256').update(png).digest('hex')}`);
