import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from '../../service/fake-herdr';
import { fakeGpuiBase, fakeGpuiKit, built, byId } from '../../service/fake-gpui';

let ss: any[], ps: any[], actions: any[], metadata: Map<string, any>, state: Map<string, any>;
let poll: Function, work: Promise<any>[], delay: (() => Promise<void>) | null;
mock.module('gpui-kit', () => fakeGpuiKit());
mock.module('gpui-base', () => fakeGpuiBase());
mock.module('herdr', () => fakeHerdr({
  spaces: () => ss, panes: () => ps, terminals: () => [], agents: () => [], machines: () => [],
  shared: (k: string) => state.get(k), setShared: (k: string, v: any) => state.set(k, v),
  appHome: () => '/fixture/app', home: () => '/fixture', layout: () => ({}),
  theme: () => new Proxy({}, { get: () => '#444444' }), settings: () => ({}), window: () => ({ platform: 'linux' }),
  run: (...a: any[]) => actions.push(a),
  exec: async (bin: string, args: string[]) => {
    actions.push([bin, args]);
    if (args[0] !== 'tab-name') return { code: 0, stdout: '{}' };
    const record = metadata.get(args[1]);
    await delay?.();
    return record ? { code: 0, stdout: JSON.stringify(record) } : { code: 1, stdout: '{}' };
  },
}));
const { watchArtifactTabNames } = await import('../../mods/tabs-tasks/artifact-tabs.js');
const { default: Tabs } = await import('../../mods/tabs-tasks/main.js');

const cx: any = {
  notify() {},
  timer: { every(_ms: number, cb: Function) { poll = cb; } },
  spawn(f: Function) { const p = Promise.resolve(f(cx)); work.push(p); return p; },
};
const tab = (id: string, index: number, extra: any = {}) => ({ id, index, name: String(index), named: false, panes: 1, ...extra });
const pane = (tab: string, mod: string, extra: any = {}) => ({ pane: `pane-${tab}`, tab, mod, terminal: null, ...extra });
const record = (mod: string, name: string, machine: string | null = null) => ({ mod, id: 'proof-1234', machine, name });
const renames = () => actions.filter(a => a[0] === 'tab.rename');
const reads = () => actions.filter(a => Array.isArray(a[1]) && a[1][0] === 'tab-name');
const tick = async () => { poll(cx); await Promise.all(work.splice(0)); };
const text = (e: any): string => typeof e === 'string' ? e : (e?.kids ?? []).map(text).join(' ');
function draw(id: string) {
  built.length = 0;
  const v: any = Object.create(Tabs.prototype);
  v.syncPanel = () => {};
  v.render(cx);
  return text(byId(`tab-${id}`)).trim();
}
beforeEach(() => {
  ss = [{ id: 'A', active: true, machine: null, tabs: [tab('legacy', 4, { active: true })] },
        { id: 'vm/A', active: false, machine: 'vm', tabs: [] }];
  ps = [pane('legacy', 'art-proof-1234')];
  actions = []; work = []; delay = null;
  metadata = new Map([['art-proof-1234', record('art-proof-1234', 'Quality report · Proof')]]);
  state = new Map([['addons.off', ['autopilot']], ['counts.red', false], ['counts.green', false]]);
  watchArtifactTabNames(cx);
});

test('the actual native tab bar changes from default 4 to the verified artifact title', async () => {
  expect(draw('legacy')).toBe('4');
  // The stale sidebar reports a different title/version; tab repair doesn't use it.
  state.set('artifacts.titles', { 'art-proof-1234': 'Stale sidebar title · v1' });
  await tick();
  expect(renames()).toEqual([['tab.rename', { id: 'legacy', name: 'Quality report · Proof' }]]);
  // The native host may not reflect a queued rename immediately.
  await tick(); await tick();
  expect(renames()).toHaveLength(1);
  Object.assign(ss[0].tabs[0], { name: 'Quality report · Proof', named: true });
  expect(draw('legacy')).toBe('Quality report · Proof');
  // Explicit manual names, including numbers and the historical tb<number> spelling, are literal.
  ss[0].tabs[0].name = 'tb3'; expect(draw('legacy')).toBe('tb3');
  ss[0].tabs[0].name = '4'; expect(draw('legacy')).toBe('4');
  await tick(); expect(renames()).toHaveLength(1);
  // Do not endlessly restore the title if someone clears it or a delayed host update arrives.
  ss[0].tabs[0].named = false;
  await tick(); expect(renames()).toHaveLength(1);
});

test('repair considers complete pane membership, never a mixed or manually named tab', async () => {
  const tabs = ss[0].tabs;
  tabs.push(tab('manual', 5, { named: true }), tab('mixed', 6, { panes: 2 }),
    tab('two-artifacts', 7, { panes: 2 }), tab('unloaded', 8), tab('unknown', 9),
    tab('terminal', 10), tab('partial', 11, { panes: 2 }), tab('duplicate', 12), tab('wrong-machine', 13));
  ps.push(pane('manual', 'art-proof-1234'), pane('mixed', 'art-proof-1234'),
    pane('mixed', '', { pane: 'shell', terminal: 't1' }), pane('two-artifacts', 'art-proof-1234'),
    pane('two-artifacts', 'art-other-5678', { pane: 'other' }), pane('unknown', 'art-unverified'),
    pane('terminal', '', { terminal: 't2' }), pane('partial', 'art-proof-1234'),
    pane('duplicate', 'art-other-5678'), pane('wrong-machine', 'art-vm-proof-1234'));
  metadata.set('art-other-5678', { mod: 'art-other-5678', id: 'other-5678', name: 'Quality report · Proof', machine: null });
  metadata.set('art-vm-proof-1234', record('art-vm-proof-1234', 'Remote proof', 'vm'));
  for (let i = 0; i < 6; i++) await tick();
  expect(renames()).toEqual([
    ['tab.rename', { id: 'legacy', name: 'Quality report · Proof' }],
    ['tab.rename', { id: 'duplicate', name: 'Quality report · Proof' }],
  ]);
  expect(reads().map(a => a[1][1])).toEqual(['art-proof-1234', 'art-unverified', 'art-other-5678', 'art-vm-proof-1234']);
});

test('a missing record is retried on reopen, and a remote historical version remains a different pane', async () => {
  ss[0].active = false;
  ss[1].active = true; ss[1].tabs = [tab('vm/tab', 2, { active: true })];
  ps = [pane('vm/tab', 'art-vm-proof-1234--v1')];
  await tick(); await tick();
  expect(reads()).toHaveLength(1); expect(renames()).toEqual([]);
  metadata.set('art-vm-proof-1234--v1', record('art-vm-proof-1234--v1', 'Remote report', 'vm'));
  ss[1].active = false; ss[0].active = true; await tick();
  ss[0].active = false; ss[1].active = true; await tick();
  expect(renames()).toEqual([['tab.rename', { id: 'vm/tab', name: 'Remote report' }]]);
  expect(ps[0].mod).toBe('art-vm-proof-1234--v1');
});

for (const change of ['manual rename', 'split', 'pane replaced', 'space switched', 'tab closed']) {
  test(`late metadata cannot rename after a ${change}`, async () => {
    let finish!: () => void;
    delay = () => new Promise<void>(resolve => { finish = resolve; });
    poll(cx);
    if (change === 'manual rename') Object.assign(ss[0].tabs[0], { name: '4', named: true });
    if (change === 'split') { ss[0].tabs[0].panes = 2; ps.push(pane('legacy', 'chat', { pane: 'new' })); }
    if (change === 'pane replaced') ps[0].pane = 'new-pane';
    if (change === 'space switched') { ss[0].active = false; ss[1].active = true; }
    if (change === 'tab closed') ss[0].tabs = [];
    finish(); await Promise.all(work);
    expect(renames()).toEqual([]);
  });
}
