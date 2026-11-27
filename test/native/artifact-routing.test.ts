import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fakeHerdr } from '../../service/fake-herdr';
import { fakeGpuiKit, fakeGpuiBase } from '../../service/fake-gpui';
let ss: any[], actions: any[], state: Map<string, any>, viewProps: any, work: Promise<any>[];
let gate: (() => Promise<void>) | null, onWrite: (() => void) | null;
let record: any;
mock.module('gpui-kit', () => fakeGpuiKit());
mock.module('gpui-base', () => fakeGpuiBase());
mock.module('herdr', () => fakeHerdr({
 spaces: () => ss, panes: () => [], terminals: () => [], agents: () => [], home: () => '/fixture', appHome: () => '/fixture/app',
 theme: () => new Proxy({}, { get: () => '#444444' }), settings: () => ({}), props: () => viewProps,
 shared: (k: string) => state.get(k), setShared: (k: string, v: any) => state.set(k, v), run: (...a: any[]) => actions.push(a),
 layout: () => ({ id: 'artifacts-view-body', content: { mod: 'blank' } }),
 readTextFile: async () => JSON.stringify({ id: 'artifacts-view-body', content: { mod: 'blank' } }),
 writeTextFile: async () => onWrite?.(),
 openOverlay: (p: any) => actions.push(['overlay', ss.find(s => s.active)?.id, p]),
 exec: async (bin: string, args: string[]) => {
  actions.push([bin, args]);
  if (bin === 'herdr-app') { for (const s of ss) s.active = s.id === args[3]; return { code: 0, stdout: '{}' }; }
  if (args.includes('show')) return { code: 0, stdout: JSON.stringify(record) };
  if (args.includes('pull')) { await gate?.(); return { code: 0, stdout: JSON.stringify({ mod: `art-${record.id}${args.includes('--version') ? '--v1' : ''}` }) }; }
  return { code: 0, stdout: '{}' };
 }
}));
const { openViewer } = await import('../../lib/artview.js');
const { showInSidebar } = await import('../../lib/artifact-sidebar.js');
const { default: Accept } = await import('../../mods/accept-card/main.js');
const { default: Artifacts } = await import('../../mods/artifacts/main.js');
const { default: TaskArtifacts } = await import('../../mods/task-artifacts/main.js');
const { PanelHost } = await import('../../mods/chat/panel.js');
const cx: any = { notify() {}, spawn(f: any) { const p = Promise.resolve(f(cx)); work.push(p); return p; } };
const active = (id: string) => { for (const s of ss) s.active = s.id === id; };
const overlays = () => actions.filter(a => a[0] === 'overlay');
beforeEach(() => {
 ss = [{ id: 'A', machine: null, folder: '/a', active: false }, { id: 'B', machine: null, folder: '/b', active: true }, { id: 'vm/A', machine: 'vm', active: false }];
 actions = []; state = new Map(); viewProps = {}; work = []; gate = null; onWrite = null;
 record = { id: 'proof-1234', title: 'Proof', version: 3, space: 'A' };
});
test('proof opens over its recorded owner while B is active', async () => {
 await openViewer({ id: record.id }, { x: 9, y: 9, width: 99, height: 99 });
 expect(overlays().map(a => a[1])).toEqual(['A']);
 expect(overlays()[0][2].at).toEqual({ x: 0, y: 0 });
 expect(actions.filter(a => a[0] === 'herdr-app').map(a => a[1])).toEqual([['do', 'space.select', '--id', 'A']]);
});
test('switching during pull retains owner, requested historical version and original machine', async () => {
 let finish!: () => void; let started!: () => void;
 const pulling = new Promise<void>(r => { started = r; });
 gate = () => new Promise<void>(r => { finish = r; started(); });
 const pending = openViewer({ id: record.id, machine: 'vm', version: 1, latest: 3 });
 await pulling;
 active('B'); finish(); await pending;
 expect(overlays()[0][1]).toBe('vm/A');
 expect(actions.find(a => a[1]?.includes('pull'))[1]).toContain('--from');
 const art = overlays()[0][2].layout.children[0].content.props.artifact;
 expect([art.machine, art.space, art.version, art.mod]).toEqual(['vm', 'vm/A', 1, 'art-proof-1234--v1']);
});
test('deleted or unrecorded owners do not open under B', async () => {
 for (const owner of [null, 'gone']) { record.space = owner; await openViewer({ id: record.id }); }
 expect(overlays()).toEqual([]);
 expect(ss.find(s => s.active)?.id).toBe('B');
});
test('Accept proof and task artifact cards use the same owner route', async () => {
 viewProps = { machine: 'vm' };
 const accept: any = Object.create(Accept.prototype); accept.opening = false;
 accept.openProof(cx, { id: record.id, title: 'Stale proof title' }); await Promise.all(work);
 expect(overlays()[0][1]).toBe('vm/A'); expect(overlays()[0][2].kind).toBe('dialog');
 expect(overlays()[0][2].layout.children[0].content.props.artifact.title).toBe('Proof');
 active('B'); work = [];
 const task: any = Object.create(TaskArtifacts.prototype); task.opening = null;
 task.open({ id: record.id, title: 'Proof', v: 3 }, null, cx); await Promise.all(work);
 expect(overlays()[1][1]).toBe('A');
 expect(actions.some(a => a[0] === 'tab.rename' || a[1]?.includes?.('tab.new'))).toBe(false);
});
test('chat card keeps the captured machine through retrieval', async () => {
 const src = readFileSync(new URL('../../mods/chat/main.js', import.meta.url), 'utf8');
 const match = src.match(/  openArtifact\(row\) \{([\s\S]*?)\n  \}/);
 expect(match).not.toBeNull();
 const method = new Function('openViewer', `return function(row) {${match![1]}}`)((a: any, area: any) => { work.push(openViewer(a, area)); });
 method.call({ machine: 'vm', paneArea: () => null }, { art: record.id, title: 'Proof', version: 3 });
 await Promise.all(work); expect(overlays()[0][1]).toBe('vm/A');
});
test('sidebar reselects its owner after the layout write and keeps Back local', async () => {
 onWrite = () => active('B');
 await openViewer({ id: record.id }, null, showInSidebar);
 expect(ss.find(s => s.active)?.id).toBe('A');
 expect(state.get('artifacts.view').space).toBe('A');
 expect(state.get('artifacts.view').title).toBe('Proof');
 expect(actions.filter(a => a[0] === 'layout.select').length).toBe(2);
 expect(actions.some(a => a[0] === 'tab.rename' || a[1]?.includes?.('tab.new'))).toBe(false);
});
test('late task-artifact lists cannot overwrite another stopped task', async () => {
 const h: any = Object.create(PanelHost.prototype); const first = { terminal: null, task: 'SHOP-4' };
 h.cur = first; h.rec = { ref: 'SHOP-4', folder: '/a', machine: null, agents: [], proof: null };
 // list returns no artifacts: the identity guard still matters when both terminals are null.
 const p = h.loadArts(h.rec, null, cx); h.cur = { terminal: null, task: 'SHOP-5' }; h.rec = { ref: 'SHOP-5', folder: '/b' };
 await p; expect(state.has('tasks.thread.artifacts')).toBe(false);
});

test('a remembered native sidebar proof does not follow a later selection of B', async () => {
 state.set('artifacts.view', { id: record.id, space: 'A', machine: null });
 const view: any = Object.create(Artifacts.prototype); view.viewHead(cx); await Promise.all(work);
 expect(actions).toContainEqual(['layout.select', { stack: 'artifacts', child: 'artifacts-list' }]);
});
