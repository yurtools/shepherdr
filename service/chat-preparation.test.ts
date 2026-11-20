import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as view from '../core/chat-view.js';
import * as preparation from '../core/chat-preparation.js';
import * as geometry from '../core/chat-layout.js';
import { dayLabel, dayOf } from '../mods/chat/days.js';
import { pilotLine } from '../core/chat-log.js';

const source = readFileSync(new URL('../mods/chat/main.js', import.meta.url), 'utf8');
function method(name: string) {
  const match = new RegExp(`^  (?:async |\\*)?${name}\\(`, 'm').exec(source);
  if (!match) return '';
  return source.slice(match.index, source.indexOf('\n  }', match.index) + 4);
}
const names = ['rows', 'rowPlan', 'spaced', 'spacedPlan', 'foldOf', 'key', 'guess', 'guessBare', 'findMatches',
  'newsLines', 'newsPlan', 'resolveArts', 'resolveArtsPlan', 'timelineCards', 'timelinePlan',
  'historyCurrent', 'historyEvent', 'historyContext', 'historyStamp', 'historyPlan', 'prepareHistory', 'scheduleHistory', 'clearHistory'];
export function historyHost(items: any[], sharedRead: (key: string) => any = () => null) {
  const jobs: any[] = [], stats = { items: 0, keys: 0, guesses: 0, lookups: 0, notifies: 0 };
  const dependencies: any = { ...view, ...geometry, ...preparation,
    dayLabel: (at: number) => `Day ${Math.floor(at / 86400000)}`, dayOf: (at: number) => Math.floor(at / 86400000) * 86400000, pilotLine,
    askAt: () => 1772946000000, openCard: () => null, assistant: () => false,
    linkCtl: (id: string, label: string, fn: any) => ({id,label,fn}),
    inRender: (fn: any) => fn(), home: () => '/test-home', cardsOf: () => [], shared: sharedRead, zoomOf: () => 1, strips: { sig: () => '' } };
  const C = new Function(...Object.keys(dependencies), `
    const ACT=22,BAND_IN=4,ACT_ROW=26,GAP=16,QUIET_IN={top:5,bottom:6},FOLD=20,FOLD_TALL=28,LINE_H=21,PEEK_W=420;
    const norm=s=>String(s??'').replace(/\\s+/g,' ').trim(),taskRef=x=>x.ref;
    ${source.slice(source.indexOf('const wrapLines ='), source.indexOf('const ICONS ='))}
    ${source.slice(source.indexOf('function parts(text)'), source.indexOf('\nlet bound'))}
    return class {${names.map(method).join('\n')}}`)(...Object.values(dependencies));
  const v: any = new C();
  const cx: any = { timer: { after: (_ms: number, fn: any) => { const job = { fn, cancel() { job.fn = null; } }; jobs.push(job); return job; } }, notify() { stats.notifies++; } };
  Object.assign(v, { conv: { items }, start: 0, end: 1, kind: 'codex', addr: 'fixture', path: 'fixture', width: 1000,
    opened: new Set(), unfolded: new Set(), pending: [], replied: [], askEnds: [], asks: [], wasks: [], sasks: [],
    screenBusy: new Set(), screenErr: new Map(), accepting: new Set(), myReacts: new Map(),
    heights: new Map(), measuredAt: new Map(), rowRevisions: new Map(), results: new Map(), views: {},
    t: { cwd: '/repo' }, phase: 'ready', status: () => 'blocked', column: () => 1000, findQuery: () => '', pickKey: () => 'pane',
    resolveArts() { stats.lookups++; return new Map(); }, newsLines() { stats.lookups++; return { inline: new Map(), extra: [] }; },
    *resolveArtsPlan() { stats.lookups++; return new Map(); }, *newsPlan() { stats.lookups++; return { inline: new Map(), extra: [] }; },
    loadAskEnds() {}, workerTasks: () => new Map(), timelineCards: () => [], *timelinePlan() { return []; }, brief: () => null, pills: () => [], mentioned: () => [],
    needViews() {}, needPeeks() {}, loadArts() {}, fitThumbs: () => ({ h: 100 }), areaKey: () => 'pane' });
  for (const [name, counter] of [['key', 'keys'], ['guess', 'guesses']] as const) {
    const fn = v[name]; v[name] = function (...args: any[]) { stats[counter]++; return fn.apply(this, args); };
  }
  function request() {
    // The old render's complete preparation path is intentionally exercised for
    // a failing-before run, rather than testing only a new helper in isolation.
    if (v.prepareHistory) return v.prepareHistory({}, cx);
    const rows = v.rows(), index = new Map(), keys = rows.map((r: any) => { index.set(r.id, r); return v.key(r); });
    return { rows, index, keys, sizes: rows.map((r: any) => v.guess(r)) };
  }
  function one() { const job = jobs.shift(); if (job?.fn) job.fn(cx); }
  function drain(limit = 100000) { while (jobs.length && limit-- > 0) one(); expect(jobs).toHaveLength(0); }
  return { v, cx, jobs, stats, request, one, drain };
}

const large = () => Array.from({ length: 1200 }, (_, i) => ({ kind: i % 3 ? 'agent' : 'user', id: `m${i}`,
  text: `Reply ${i}\n` + 'A complete line of history.\n'.repeat(i % 5 ? 8 : 70), at: 1772946000000 + i * 1000 }));

export function complexHistory() {
  const at = 1772946000000;
  const h = historyHost([
    { kind: 'user', id: 'user', text: 'Hello\nPROJECT-1', replyTo: 'An earlier reply', paths: ['/repo/user.png'], at },
    { kind: 'agent', id: 'media', text: '**Before:** ![chart](/repo/chart.png)\n\nA [clip](./demo.mp4).\n\n```js\nconst value = 1;\n```', at: at + 1000 },
    { kind: 'agent', id: 'long', text: 'A long answer with all its words.\n'.repeat(80), at: at + 2000 },
    { kind: 'news', id: 'news', ref: 'PROJECT-1', event: 'ready', text: 'Ready to read', at: at + 3000 },
    { kind: 'sent', id: 'sent', to: 'other', text: 'Sent words', at: at + 4000 },
    { kind: 'artifact', id: 'art', at: at + 5000 },
    { kind: 'tools', id: 'tools', steps: [{ id: 'call', line: 'Read a file', out: 10 }], at: at + 6000 },
    { kind: 'ask', id: 'question', text: 'Pick an answer', at: at + 7000 },
  ]);
  for (const name of ['resolveArts', 'resolveArtsPlan', 'newsLines', 'newsPlan', 'timelineCards', 'timelinePlan']) delete h.v[name];
  Object.assign(h.v, {
    assistant: () => 'space', cli: () => 'Codex', codexCard: () => null, afterNews: (_ref: string, time: number) => time,
    secretCards: { items: () => [] }, cards: { strips: () => [{ key: 'question', kind: 'title', text: 'Pick an answer' }] },
    asks: [{ id: 'question', words: { kind: 'questions' } }],
    arts: [{ id: 'published', title: 'A chart', version: 1, versions: [{ publisher: 'fixture', v: 1, at: at + 5000 }] }],
    spaceTasks: [{ ref: 'PROJECT-1', id: 1, title: 'A task', space: 'space', status: 'ready', started: at - 1000, ready_at: at + 3000 }],
    sender: () => 'Assistant', names: () => ({}), peekOf: () => ({ paths: ['/repo/preview.png'], text: 'A preview' }),
    mentioned: () => [{ id: 1, ref: 'PROJECT-1', title: 'A task' }], pills: () => [{ emoji: 'yes', you: true }],
    pending: [{ id: 'pending', text: 'A pending message', files: ['notes.txt'], waiting: true }], replied: [{ id: 'answer', text: 'A written answer' }],
    note: { id: 'notice', text: 'A notice' },
  });
  return h;
}

test('real media, artifact/news joins, cards, pending and action bands match the baseline golden snapshot', () => {
  const h = complexHistory(); h.request(); h.drain(); expect(h.v.error).toBeUndefined(); const plan = h.v.history.snapshot;
  const actual = JSON.parse(JSON.stringify({ rows: plan.rows, keys: plan.keys, sizes: plan.sizes }));
  expect(actual).toEqual(JSON.parse(readFileSync(new URL('./fixtures/chat-preparation.json', import.meta.url), 'utf8')));
});

test('cold native render queues the full preparation path without walking history', () => {
  const h = historyHost(large());
  h.request();
  expect(h.stats.keys).toBe(0); expect(h.stats.guesses).toBe(0); expect(h.stats.lookups).toBe(0);
  h.drain(); expect(h.v.rows().length).toBeGreaterThan(1200);
});

test('unchanged and hover render reuse all prepared rows, keys, estimates and indexes', () => {
  const h = historyHost(large()); h.request(); h.drain();
  const before = { ...h.stats }, rows = h.v.rows();
  for (let n = 0; n < 50; n++) { h.v.hoverBand = `m${n}`; h.request(); }
  expect(h.stats).toEqual(before); expect(h.v.rows()).toBe(rows); expect(h.jobs).toHaveLength(0);
});

test('every callback bounds all stages, and continuous fresh sources cannot starve a commit', () => {
  const h = historyHost(large()); h.request();
  let callbacks = 0, maxKeys = 0, maxGuesses = 0;
  while (!h.v.history.snapshot && callbacks++ < 5000) {
    const keys = h.stats.keys, guesses = h.stats.guesses;
    // Rebuild the Conversation and every item, as an actual reload does.
    h.v.conv = { items: large() }; h.v.end++; h.request(); h.one();
    maxKeys = Math.max(maxKeys, h.stats.keys - keys); maxGuesses = Math.max(maxGuesses, h.stats.guesses - guesses);
    expect(h.jobs.length).toBeLessThanOrEqual(1);
  }
  expect(h.v.history.snapshot).not.toBeNull(); expect(maxKeys).toBeLessThanOrEqual(32); expect(maxGuesses).toBeLessThanOrEqual(32);
  h.drain(); expect(h.v.rows().find((r: any) => r.id === 'm0')).toBeDefined();
});

test('presentation changes hide actionable rows and invalidate work before the next draw', () => {
  for (const mutate of [(v: any) => v.width--, (v: any) => v.findQuery = () => 'Reply',
    (v: any) => v.tasks = [], (v: any) => v.reach = {}, (v: any) => v.path = 'other',
    (v: any) => { v.unfolded.add('m0'); v.historyRevision++; }]) {
    const h = historyHost(large()); h.v.historyRevision = 0; h.request(); h.drain();
    h.v.conv = { items: large() }; h.request(); mutate(h.v); h.one();
    expect(h.v.rows()).toEqual([]); h.drain(); expect(h.v.rows().length).toBeGreaterThan(1200);
  }
});

test('streamed text, pending flags, status and removals update a coherent snapshot', () => {
  const h = historyHost(large()); h.request(); h.drain();
  const before = h.v.rows(), oldKey = h.v.history.snapshot.keys[h.v.history.snapshot.positions.get('m1')];
  const items = large(); items[1].text = 'Changed text with [picture](/repo/a.png)';
  h.v.conv = { items }; h.v.end++; h.request();
  expect(h.v.rows()).toBe(before); h.drain();
  const plan = h.v.history.snapshot; expect(plan.rows[plan.positions.get('m1')].text).toBe(items[1].text);
  expect(plan.keys[plan.positions.get('m1')]).not.toBe(oldKey);
  h.v.pending = [{ id: 'pending', text: 'Queued words', waiting: true }]; h.request(); h.drain();
  h.v.pending[0].failed = 'Delivery failed'; h.v.historySourceRevision = 1; h.request(); h.drain();
  expect(h.v.history.snapshot.index.get('pending').failed).toBe('Delivery failed');
  h.v.conv = { items: items.slice(0, 10) }; h.v.end++; h.request(); h.drain();
  expect(h.v.history.snapshot.index.has('m100')).toBe(false);
  h.v.conv = { items }; h.v.end++; h.request(); h.drain();
  expect(h.v.history.snapshot.index.has('m100')).toBe(true);
  expect(h.v.history.snapshot.keys[h.v.history.snapshot.positions.get('m1')]).toBe(plan.keys[plan.positions.get('m1')]);
});

test('preparation errors retry the same source and reset/close cancel every stale callback', () => {
  const h = historyHost(large()); const original = h.v.rowPlan;
  h.v.rowPlan = function* () { yield; throw Error('deterministic row failure'); };
  h.request(); h.drain(); expect(h.v.error).toBe('deterministic row failure'); expect(h.v.rows()).toEqual([]);
  h.v.rowPlan = original; h.request(); h.drain(); expect(h.v.rows().length).toBeGreaterThan(1200);
  h.v.conv = { items: large() }; h.request(); const old = h.jobs[0].fn;
  h.v.clearHistory(); old(h.cx); expect(h.v.rows()).toEqual([]);
  h.request(); h.v.clearHistory(true); h.drain(); expect(h.v.rows()).toEqual([]); expect(h.v.history).toBeNull();
});

test('complete row, key, height and index parity survives fresh item rebuilds and measurement updates', () => {
  const h = historyHost(large()); h.request(); h.drain(); const first = h.v.history.snapshot;
  const initial = { rows: structuredClone(first.rows), keys: [...first.keys], sizes: [...first.sizes] };
  h.v.conv = { items: large() }; h.v.end++; h.request(); h.drain(); const rebuilt = h.v.history.snapshot;
  expect(rebuilt.rows).toEqual(initial.rows); expect(rebuilt.keys).toEqual(initial.keys); expect(rebuilt.sizes).toEqual(initial.sizes);
  for (let i = 0; i < rebuilt.rows.length; i++) {
    expect(rebuilt.index.get(rebuilt.rows[i].id)).toBe(rebuilt.rows[i]);
    expect(rebuilt.positions.get(rebuilt.rows[i].id)).toBe(i);
    expect(rebuilt.geometry.sum(i)).toBe(initial.sizes.slice(0, i).reduce((a: number, b: number) => a + b, 0));
  }
  const row = rebuilt.rows[10], key = rebuilt.keys[10], total = rebuilt.total, old = rebuilt.sizes[10];
  rebuilt.measure(row.id, 'obsolete-key', 900, Date.now()); expect(rebuilt.total).toBe(total);
  rebuilt.measure(row.id, key, 900, Date.now()); expect(rebuilt.total).toBe(total - old + 900); expect(rebuilt.sizes[10]).toBe(900);
  expect(rebuilt.geometry.at(rebuilt.geometry.sum(10))).toBe(10);
});

test('host-shaped fresh shared values keep identical work and invalidate real screen/name changes', () => {
  const values: any = { 'chat.screens': { fixture: [{ id: 'screen', state: 'closed', how: 'Answered' }] }, 'spaces-chat': { machines: { local: { name: 'This machine' } } } };
  const h = historyHost(large(), key => structuredClone(values[key]));
  h.request();
  while (h.jobs.length) { h.request(); h.one(); }
  const plan = h.v.history.snapshot; expect(plan).not.toBeNull();
  for (let n = 0; n < 20; n++) h.request();
  expect(h.v.history.snapshot).toBe(plan); expect(h.jobs).toHaveLength(0);
  values['chat.screens'].unrelated = [{ id: 'another screen' }]; h.request(); expect(h.v.history.snapshot).toBe(plan);
  values['chat.screens'].fixture[0].how = 'Declined'; h.request(); expect(h.v.rows()).toEqual([]); h.drain();
  values['spaces-chat'].machines.local.name = 'Renamed'; h.request(); expect(h.v.rows()).toEqual([]); h.drain();
});

test('same worker request and payload with changed review policy invalidates cached strips', () => {
  const h = historyHost(large());
  const ask = { id: 'request', requestHash: 'payload', approval: { attention: true, reason: 'Waiting for review', review: 'pending' } };
  h.v.wasks = [ask]; h.request(); h.drain();
  const plan = h.v.history.snapshot;
  ask.approval = { attention: false, reason: 'Review in progress', review: 'running' }; h.request();
  expect(h.v.history.snapshot).toBeNull(); h.drain(); expect(h.v.history.snapshot).not.toBe(plan);
  ask.approval.reason = 'A new review result'; h.request(); expect(h.v.rows()).toEqual([]); h.drain();
  const stable = h.v.history.snapshot; h.v.wasks = [{ ...ask, approval: { ...ask.approval } }]; h.request();
  expect(h.v.history.snapshot).toBe(stable); expect(h.jobs).toHaveLength(0);
});

test('old native event callbacks cannot act before redraw, after supersession, reset or close', () => {
  const h = historyHost(large()); h.request(); h.drain();
  const plan = h.v.history.snapshot; let calls = 0;
  const click = h.v.historyEvent(plan, () => calls++); click(); expect(calls).toBe(1);
  h.v.path = 'another context'; click(); expect(calls).toBe(1);
  h.request(); h.drain(); click(); expect(calls).toBe(1);
  h.v.clearHistory(); click(); expect(calls).toBe(1);
  h.request(); h.drain(); const final = h.v.historyEvent(h.v.history.snapshot, () => calls++);
  h.v.clearHistory(true); final(); expect(calls).toBe(1);
  // Test the actual integration uses the guard, rather than only its helper.
  expect(source).toContain('.on_item_click(event('); expect(source).toContain('.on_item_secondary_click(event(');
  expect(source).toContain('if(prepared&&!this.historyCurrent(prepared))return;');
});
