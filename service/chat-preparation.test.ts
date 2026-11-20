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
  'historyContext', 'historyStamp', 'historyPlan', 'prepareHistory', 'scheduleHistory', 'clearHistory'];
export function historyHost(items: any[]) {
  const jobs: any[] = [], stats = { items: 0, keys: 0, guesses: 0, lookups: 0, notifies: 0 };
  const dependencies: any = { ...view, ...geometry, ...preparation, dayLabel, dayOf, pilotLine,
    home: () => '/home/test', cardsOf: () => [], shared: () => null, zoomOf: () => 1, strips: { sig: () => '' } };
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
    loadAskEnds() {}, workerTasks: () => new Map(), timelineCards: () => [], brief: () => null, pills: () => [], mentioned: () => [],
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
