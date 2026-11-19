import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from './fake-herdr';
import { fakeGpuiKit, fakeGpuiBase, built, byId, handler } from './fake-gpui';
import { Compat } from './compat';
import { attentionCounts } from '../web/src/attention';
import { inReviewScope, reviewKey } from '../core/review.js';

let properties: any = {}, data = new Map<string, any>(), calls: string[][] = [], rows: any[] = [], pending: Promise<any>[] = [];
const scope = { kind: 'feature', space: 'sp1', folder: '/repo', machine: null, feature: 'f1', name: 'Shipping' };
const evidence = { merges: true, destination: 'main', decision_token: 'a'.repeat(64), summary: 'Finished', checks: { state: 'passed', text: 'Checks passed' } };
const row = (id: number, more: any = {}) => ({ id, ref: `APP-${id}`, title: `Task ${id}`, state: 'ready', status: 'ready', folder: '/repo', space: 'sp1', feature: 'f1', machine: null, evidence, ...more });
const execute = async (_bin: string, args: string[]) => {
  calls.push(args);
  let result: any;
  if (args[0] === 'list') result = [{ folder: '/repo', tasks: rows }];
  if (args[0] === 'show') result = rows.find(x => x.ref === args[1]);
  if (args[0] === 'accept') {
    await Promise.resolve();
    if (args[1] === 'APP-2') return { code: 1, stderr: 'The worker resumed', stdout: '' };
    result = { state: 'done', accept_receipt: { token: evidence.decision_token } };
  }
  if (args[0] === 'later') result = { state: 'ready' };
  return { code: 0, stdout: JSON.stringify(result), stderr: '' };
};
mock.module('herdr', () => fakeHerdr({ props: () => properties, appHome: () => '/scratch', exec: execute,
  theme: () => ({ foreground: '#fff', muted: '#aaa', border: '#555', popover: '#222' }),
  shared: (k: string) => data.get(k), setShared: (k: string, v: unknown) => data.set(k, v),
  terminals: () => [], spaces: () => [], panes: () => [] }));
mock.module('gpui-kit', () => fakeGpuiKit());
mock.module('gpui-base', () => fakeGpuiBase());
const { default: AcceptCard } = await import('../mods/accept-card/main.js');
const inbox = await import('../mods/tasks/inbox.js');
const cx: any = { notify() {}, stop_propagation() {}, spawn(fn: any) { const p = Promise.resolve(fn(cx)); pending.push(p); return p; } };
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const native = () => Object.assign(Object.create(AcceptCard.prototype), { scope, items: [], selected: new Set(), results: [], busy: false });
beforeEach(() => { properties = { scope }; data.clear(); calls = []; rows = []; pending = []; built.length = 0; });

test('native scoped list selects active work only and preserves the exact selection through partial failure', async () => {
  rows = [row(1), row(2), row(3, { status: 'deferred' }), row(4, { feature: 'f2' }), row(5, { space: 'sp2' })];
  const card: any = native(); card.readBatch(cx); await settle();
  expect(calls[0]).toContain('--read-only');
  expect(card.items.map((x: any) => x.ref)).toEqual(['APP-1', 'APP-2', 'APP-3']);
  card.renderBatch({ foreground: '#fff', muted: '#aaa', border: '#555', popover: '#222' });
  handler(byId('review-all')!, 'on_click')!({}, cx);
  expect([...card.selected]).toEqual(card.items.slice(0, 2).map(reviewKey));
  rows.push(row(6));
  card.acceptBatch(cx); card.acceptBatch(cx); await settle();
  expect(calls.filter(x => x[0] === 'accept').map(x => x[1])).toEqual(['APP-1', 'APP-2']);
  expect(calls.filter(x => x[0] === 'accept')[1]).toContain('--after-accept');
  expect(card.results.map((r: any) => r.state)).toEqual(['success', 'refused']);
  handler(byId('review-all')!, 'on_click')!({}, cx);
  expect([...card.selected]).toEqual([reviewKey(card.items[1])]);
  card.readBatch(cx); await settle();
  expect(card.items.map((x: any) => x.ref)).toContain('APP-6');
  expect(card.selected.size).toBe(0);
});

test('Later is a separate native command and rapid clicks issue it once', async () => {
  properties = { ref: 'APP-1', folder: '/repo' };
  const card: any = native(); card.scope = null; card.close = () => {};
  card.later(cx); card.later(cx); await settle();
  expect(calls.map(x => x[0])).toEqual(['later']);
  expect(calls[0]).not.toContain('accept');
});

test('native tab, space and aggregate attention agree with web counts; Deferred is neither red nor green', () => {
  const records = [row(1), row(2, { status: 'deferred' }), row(3, { status: 'needs', attention: 'Failed' })];
  data.set('inbox.tasks', records.map(x => ({ ...x, tab: 'tab1', kind: x.status === 'ready' ? 'merge' : x.status === 'deferred' ? 'deferred' : 'check' })));
  expect(inbox.readyCount()).toBe(1); expect(inbox.readyByTab().get('tab1')).toBe(1);
  expect(inbox.count()).toBe(1); expect(inbox.countsByTab().get('tab1')).toBe(1);
  const c = new Compat();
  const spaces = [{ id: 'sp1', name: 'Shop', folder: '/repo', tabs: [] }, { id: 'sp2', name: 'Other', folder: '/other', tabs: [] }];
  const snap = c.snapshot({ host: 'host', user: 'Person', spaces, machines: [], sections: [], rows: records.map(x => ({ ...x, section: x.status, slug: 'repo' })) });
  expect(attentionCounts(snap, ['sp1'])).toEqual({ need: 1, ready: 1 });
  expect(attentionCounts(snap, ['sp1', 'sp2'])).toEqual({ need: 1, ready: 1 });
  expect(snap.tasks.find(x => x.ref === 'APP-2')?.status).toBe('deferred');
});

test('web identities and scopes isolate duplicate refs in two folders, machines, spaces and features', () => {
  const c = new Compat();
  const snap = c.snapshot({ host: 'host', user: 'Person', machines: [], sections: [], spaces: [
    { id: 'sp1', name: 'One', folder: '/repo', tabs: [] }, { id: 'sp2', name: 'Two', folder: '/other', tabs: [] }
  ], rows: [row(1), row(1, { folder: '/other', space: 'sp2', feature: 'f2' }), row(1, { machine: 'vm', space: 'vm/sp1' })].map(x => ({ ...x, section: 'ready', slug: 'x' })) });
  expect(new Set(snap.tasks.map(x => x.id)).size).toBe(3);
  expect(c.taskOf('APP-1')).toBeNull();
  expect(snap.tasks.map(x => c.taskOf(x.id)?.folder)).toEqual(['/repo', '/other', '/repo']);
  const own = snap.tasks.filter(x => inReviewScope(scope, { ...x, folder: x.taskFolder, space: x.reviewSpace, machine: x.reviewMachine }));
  expect(own).toHaveLength(1);
});
