import { expect, test } from 'bun:test';
import { deferred, inReviewScope, reviewBatch, reviewKey, reviewLabel } from './review.js';
import { place } from './tasks.js';

test('Later survives harmless updates, surfaces new cycles and never hides questions/errors', () => {
  const t = { id: 1, state: 'ready', ready_at: 12, deferred_ready_at: 12, ready_turns: { t1: 2 } };
  expect(place({}, t).section).toBe('deferred');
  expect(place({}, { ...t, progress: { text: 'Metadata updated' } }).section).toBe('deferred');
  expect(place({}, { ...t, ready_at: 13 }).section).toBe('ready');
  expect(place({}, { ...t, attention: 'Checks failed', attention_at: 1 }, { now: 500000 }).section).toBe('needs');
  expect(place({}, t, { live: [{ address: 't1', status: 'blocked' }] }).section).toBe('needs');
  expect(place({}, t, { live: [{ address: 't1', status: 'working', turn: 2 }] }).section).toBe('working');
  expect(deferred({ state: 'ready' })).toBe(false);
  expect(t.state).toBe('ready');
});

test('scope uses durable space and feature identities on the correct machine', () => {
  const feature = { kind: 'feature', space: 'sp1', folder: '/a', feature: 'f1', machine: null };
  const own = { ref: 'APP-1', folder: '/a', space: 'sp1', feature: 'f1', machine: null };
  expect(inReviewScope(feature, own)).toBe(true);
  for (const change of [{ feature: 'f2' }, { space: 'sp2' }, { machine: 'vm' }]) expect(inReviewScope(feature, { ...own, ...change })).toBe(false);
  expect(inReviewScope({ ...feature, kind: 'space' }, { ...own, feature: 'f2' })).toBe(true);
  expect(inReviewScope({ ...feature, kind: 'agent' }, own)).toBe(false);
  expect(inReviewScope(feature, { ...own, space: null, folder: '/b' })).toBe(false);
  expect(new Set([own, { ...own, folder: '/b' }, { ...own, machine: 'vm' }].map(reviewKey)).size).toBe(3);
});

test('batch freezes selection, runs sequentially, reports partial results and passes proven predecessors', async () => {
  const items = [1, 2, 3].map(n => ({ ref: `APP-${n}`, folder: '/a', evidence: { merges: n < 3, decision_token: `token${n}` } }));
  const called = [], reports = []; let running = 0;
  const pending = reviewBatch(items, async (x, preceding) => {
    expect(++running).toBe(1); called.push([x.ref, preceding]);
    if (x.ref === 'APP-1') { items.push({ ref: 'APP-4' }); items[1].evidence.decision_token = 'changed'; }
    await Promise.resolve(); running--;
    if (x.ref === 'APP-3') throw new Error('Worker resumed');
    expect(x.evidence.decision_token).toBe(x.ref === 'APP-1' ? 'token1' : 'token2');
    return { state: x.ref === 'APP-1' ? 'done' : 'ready', accept_receipt: { token: x.evidence.decision_token } };
  }, rows => reports.push(rows));
  expect((await pending).map(r => r.state)).toEqual(['success', 'waiting', 'refused']);
  expect(called).toEqual([['APP-1', []], ['APP-2', ['token1']], ['APP-3', ['token1']]]);
  expect(reports.map(r => r.length)).toEqual([1, 2, 3]);
  expect(reviewLabel(items.slice(0, 3))).toBe('Merge 2 and complete 1');
  expect(reviewLabel(items.slice(0, 1))).toBe('Merge 1 task');
  expect(reviewLabel(items.slice(2, 3))).toBe('Complete 1 task');
});
