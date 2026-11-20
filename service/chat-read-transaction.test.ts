import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Conversation, records } from '../core/chat-log.js';
import { ownWords } from '../core/chat-view.js';
const source = readFileSync(new URL('../mods/chat/main.js', import.meta.url), 'utf8');
const method = (name: string) => {
  const match = new RegExp(`^  (?:async )?${name}\\(`, 'm').exec(source)!;
  return source.slice(match.index, source.indexOf('\n  }', match.index) + 4);
};
function host() {
  const C = new Function('Conversation', 'records', 'ownWords', `
    const PAGE=200,KEEP=2000,norm=s=>String(s??'').replace(/\\s+/g,' ').trim(),same=(a,b)=>norm(a)===norm(b);
    return class {${['pull', 'rebuild', 'historyRecords', 'settlePending'].filter(n => source.includes(' ' + n + '(')).map(method).join('\n')}}`)(Conversation, records, ownWords);
  const v: any = new C(), stats = { sleeps: 0, notifies: 0 };
  const cx = { sleep: async () => { stats.sleeps++; }, notify() { stats.notifies++; } };
  Object.assign(v, { path: 'fixture', kind: 'codex', readEpoch: 0, start: null, end: 0, records: [], pending: [], replied: [], myReacts: new Map(), phase: 'finding' });
  return { v, cx, stats };
}
const record = (i: number) => `${i}\tJ\t${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: i % 2 ? 'assistant' : 'user', content: [{ type: i % 2 ? 'output_text' : 'input_text', text: `Text ${i}` }] } })}\n`;

test('failed cold reconstruction leaves its cursor retryable instead of stuck Opening', async () => {
  const h = host(), rebuild = h.v.rebuild;
  const calls: string[][] = [];
  h.v.log = async (args: string[]) => { calls.push(args); return { stdout: 'P 0 99\n' + record(1) }; };
  h.v.rebuild = () => { throw Error('cold read interrupted'); };
  await expect(h.v.pull(h.cx)).rejects.toThrow('cold read interrupted');
  expect(h.v.start).toBeNull(); expect(h.v.end).toBe(0); expect(h.v.records).toEqual([]); expect(h.v.phase).toBe('finding');
  h.v.rebuild = rebuild; await h.v.pull(h.cx);
  expect(calls.map(c => c[0])).toEqual(['page', 'page']); expect(h.v.phase).toBe('ready'); expect(h.v.conv.items).toHaveLength(1);
});

test('tail failure preserves the previous immutable Conversation and retries the same offset', async () => {
  const h = host(); h.v.log = async () => ({ stdout: 'P 0 99\n' + record(1) }); await h.v.pull(h.cx);
  const conv = h.v.conv, previous = h.v.records, rebuild = h.v.rebuild, calls: string[][] = [];
  h.v.log = async (args: string[]) => { calls.push(args); return { stdout: 'T 199 99 199\n' + record(2) }; };
  h.v.conv.feed = () => { throw Error('tail failure'); };
  h.v.rebuild = () => { throw Error('tail failure'); };
  await expect(h.v.pull(h.cx)).rejects.toThrow('tail failure');
  expect(h.v.end).toBe(99); expect(h.v.records).toBe(previous); expect(h.v.conv).toBe(conv); expect(conv.items).toHaveLength(1);
  h.v.rebuild = rebuild; await h.v.pull(h.cx);
  expect(calls.map(c => c[2])).toEqual(['99', '99']); expect(h.v.conv).not.toBe(conv); expect(h.v.conv.items).toHaveLength(2); expect(conv.items).toHaveLength(1);
});

test('real cold/fresh rebuild yields and an obsolete read cannot publish after reset or close', async () => {
  for (const action of ['reset', 'close', 'replace']) {
    const h = host(); h.v.log = async () => ({ stdout: 'P 0 999\n' + Array.from({ length: 240 }, (_, i) => record(i)).join('') });
    h.cx.sleep = async () => { h.stats.sleeps++; if (action === 'reset') h.v.readEpoch++; else if (action === 'close') h.v.historyClosed = true; else h.v.path = 'other'; };
    await h.v.pull(h.cx);
    expect(h.stats.sleeps).toBeGreaterThan(0); expect(h.v.conv).toBeUndefined(); expect(h.v.end).toBe(0); expect(h.v.start).toBeNull();
  }
  const h = host(); h.v.log = async () => ({ stdout: 'P 0 999\n' + Array.from({ length: 240 }, (_, i) => record(i)).join('') });
  await h.v.pull(h.cx); const first = structuredClone(h.v.conv.items);
  const fresh = await h.v.rebuild(h.v.records, h.cx); expect(fresh.conv.items).toEqual(first); expect(h.stats.sleeps).toBeGreaterThanOrEqual(60);
});
