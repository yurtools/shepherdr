import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { historyHost } from './chat-preparation.test';
import { element } from './fake-gpui';
import * as mentions from '../core/mentions.js';

const source = readFileSync(new URL('../mods/chat/main.js', import.meta.url), 'utf8');
const items = () => Array.from({ length: 320 }, (_, i) => ({ id: `m${i}`, kind: i % 3 ? 'agent' : 'user',
  text: `Message ${i}\n` + 'A realistic paragraph with [a file](./notes.md).\n'.repeat(i % 5 ? 8 : 70), at: 1772946000000 + i * 1000 }));

// Run the actual deferred native list callback after render has returned. This
// verifies the one-element-per-requested-row contract, not GPUI scheduling.
function deferred(h: any, prepared: any) {
  const at = source.indexOf('(range) => {', source.indexOf('v_virtual_list("chat-rows"'));
  const end = source.indexOf('\n        })', at);
  const callback = source.slice(at, end + 10).replace(/\)$/, '');
  return new Function('prepared', 'rows', 'sizes', 'lit', 'current', 't', 'div',
    `return (${callback});`).call(h.v, prepared, prepared.rows, prepared.sizes, new Set(), null, {}, () => element());
}

test('task and approval changes retain the displayed timeline while stale actions are refused', () => {
  const h = historyHost(items()); h.v.row = () => element(); h.request(); h.drain();
  const plan = h.v.history.snapshot, render = deferred(h, plan), rowIds = plan.rows.map((r: any) => r.id);
  let actions = 0; const click = h.v.historyEvent(plan, () => actions++);
  click(); expect(actions).toBe(1);
  h.v.tasks = [{ ref: 'TEST-1', title: 'A changed task', status: 'working' }];
  // Context can change between render and deferred row layout, before a redraw.
  expect(render({ start: 20, end: 26 })).toHaveLength(6);
  click(); expect(actions).toBe(1);
  expect(h.request() === plan).toBe(true); expect(h.v.rows().map((r: any) => r.id)).toEqual(rowIds);
  h.drain(); const next = h.v.history.snapshot; expect(next).not.toBe(plan);
  expect(render({ start: 20, end: 26 })).toHaveLength(6);
  click(); expect(actions).toBe(1);
  h.v.asks = [{ id: 'new-approval', words: { kind: 'permission', title: 'Read' } }];
  expect(h.request() === next).toBe(true); h.drain();
  expect(h.v.history.snapshot).not.toBe(next);
});

test('resize and streaming keep rows, measurements, scroll handle and unpinned position until commit', () => {
  const h = historyHost(items()); h.v.row = () => element(); h.request(); h.drain();
  const plan = h.v.history.snapshot, render = deferred(h, plan), scroll = { scroll_to_bottom() { throw Error('unexpected jump'); } };
  Object.assign(h.v, { scroll, pinned: false, scrollTop: plan.geometry.sum(100) + 5, range: { start: 100, end: 110 } });
  const key = plan.keys[100]; h.v.heights.set(key, 123); plan.measure(plan.rows[100].id, key, 123, 1);
  const top = h.v.scrollTop;
  h.v.conv = { items: [...items(), { id: 'stream', kind: 'agent', text: 'A streaming reply' }] }; h.v.end++;
  expect(h.request() === plan).toBe(true); h.one();
  h.v.width = 640; h.v.measureGen = 1; h.v.heights.clear(); h.v.measuredAt.clear();
  expect(h.request() === plan).toBe(true);
  expect(render({ start: 20, end: 26 })).toHaveLength(6);
  expect(h.v.scrollTop).toBe(top); expect(h.v.range).toEqual({ start: 100, end: 110 });
  h.drain(); expect(h.v.history.snapshot).not.toBe(plan);
  expect(h.v.scroll).toBe(scroll); expect(h.v.pinned).toBe(false); expect(h.v.scrollTop).toBe(top);
  expect(h.v.rows().some((r: any) => r.id === 'stream')).toBe(true);
  const committed = h.v.history.snapshot;
  for (let n = 0; n < 30; n++) { h.v.hoverBand = `m${n}`; expect(h.request()).toBe(committed); }
  expect(h.jobs).toHaveLength(0);
});

test('a deferred old frame cannot change scroll state, and genuine session changes detach it', () => {
  const h = historyHost(items()); h.v.row = () => element(); h.request(); h.drain();
  const plan = h.v.history.snapshot, render = deferred(h, plan);
  h.v.conv = { items: items() }; h.v.end++; h.request(); h.drain();
  Object.assign(h.v, { scrollTop: 900, range: { start: 40, end: 45 } });
  expect(render({ start: 1, end: 4 })).toHaveLength(3);
  expect(h.v.scrollTop).toBe(900); expect(h.v.range).toEqual({ start: 40, end: 45 });
  h.v.path = 'different-session'; expect(render({ start: 1, end: 4 })).toEqual([]);
  expect(h.request()).toBeNull(); h.drain(); expect(h.v.history.snapshot).not.toBe(plan);
  h.v.path = 'fixture'; h.v.clearHistory(); expect(render({ start: 1, end: 4 })).toEqual([]);
});

function polling() {
  const method = (name: string) => {
    const at = source.indexOf(`  async ${name}(`);
    return source.slice(at, source.indexOf('\n  }', at) + 4);
  };
  let payload: any = { tasks: [{ ref: 'TEST-1', title: 'Test task', status: 'working' }], folder: '/repo' };
  let release: (() => void) | null = null, gate: Promise<void> | null = null;
  const C = new Function('exec', 'mentions', 'spaces', `return class {${['loadTasks', 'loadReach', 'loadSpaceTasks'].map(method).join('\n')}}`)(
    async () => { if (gate) await gate; return { code: 0, stdout: JSON.stringify(payload) }; }, mentions, () => []);
  const v: any = new C(); Object.assign(v, { addr: 'fixture', t: { cwd: '/repo' } });
  return { v, payload(value: any) { payload = value; }, pause() { gate = new Promise(resolve => { release = resolve; }); }, resume() { release?.(); release = null; gate = null; } };
}

test('quiet task and reach polls preserve equivalent inputs; real changes still replace them', async () => {
  const h = polling(); await h.v.loadTasks(); await h.v.loadReach();
  const tasks = h.v.tasks, reach = h.v.reach;
  for (let n = 0; n < 5; n++) { await h.v.loadTasks(); await h.v.loadReach(); }
  expect(h.v.tasks).toBe(tasks); expect(h.v.reach).toBe(reach);
  h.payload({ folder: '/repo', tasks: [{ ref: 'TEST-1', title: 'New title', status: 'ready' }] });
  await h.v.loadTasks(); expect(h.v.tasks).not.toBe(tasks); expect(h.v.tasks[0].title).toBe('New title');
});

test('late task and reach polls cannot publish into another agent context', async () => {
  for (const method of ['loadTasks', 'loadReach', 'loadSpaceTasks']) {
    const h = polling(); h.payload(method === 'loadSpaceTasks' ? [{ folder: '/repo', tasks: [{ ref: 'TEST-1' }] }] : { folder: '/repo', tasks: [] });
    h.pause(); const pending = h.v[method](); await Promise.resolve(); h.v.addr = 'different-agent'; h.resume(); await pending;
    expect(h.v.tasks).toBeUndefined(); expect(h.v.reach).toBeUndefined(); expect(h.v.spaceTasks).toBeUndefined();
  }
});
