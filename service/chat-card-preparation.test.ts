import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as asks from '../core/asks.js';
import { historyHost } from './chat-preparation.test';

// Use the real card implementations. Only native input/keyboard handles and
// secret storage are inert; no Chat init, permission delivery or vault is run.
function cards() {
  const inputs: any[] = [], handlers: any[] = [], sent: any[] = [];
  const InputState = { new() {
    const box: any = { text: '', reads: 0, events: {}, value() { box.reads++; return box.text; },
      on(name: string, fn: any) { box.events[name] = fn; }, focus() {}, release() {}, set_masked() {},
      set_value(text: string) { box.text = text; }, change(text: string, cx: any) { box.text = text; box.events.change?.({}, cx); } };
    inputs.push(box); return box;
  } };
  const div = () => { let el: any; el = new Proxy({}, { get: (_t, key) => key === 'on_key_down' ? (fn: any) => { handlers.push(fn); return el; } : () => el }); return el; };
  const strip = (file: string) => readFileSync(new URL(`../mods/chat/${file}`, import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '');
  const deps: any = { ...asks, InputState, div, rememberedControls: () => [], adviceControl: () => ({id:'advice',label:'Advice'}) };
  const { AskCards, headStrip } = new Function(...Object.keys(deps), strip('cards.js') + '\nreturn {AskCards,headStrip};')(...Object.values(deps));
  const secrets = { asksOf: () => [], levels: () => [{ scope: 'space', label: 'This space' }, { scope: 'machine', label: 'This machine' }],
    scopeKey: (level: any) => level.scope, keep: async () => {}, decline: async () => {} };
  const SecretCards = new Function('InputState', 'secrets', 'terminals', 'headStrip', 'green', strip('secret-card.js') + '\nreturn SecretCards;')(InputState, secrets, () => [], headStrip, () => '#000');
  const owner = () => new AskCards({ reply: (...a: any[]) => sent.push(a), toTerminal() {}, chatAbout() {} }, { focus() {} });
  return { owner, secret: new SecretCards(), inputs, handlers, sent };
}

const question = (id: string) => ({ id, at: 1772946000000, words: { kind: 'questions', questions: [
  { text: 'First choice', options: [{ name: 'First' }, { name: 'Second' }], multi: false },
  { text: 'Second choice', options: [{ name: 'Preview', preview: 'The preview' }], multi: false },
] }, req: {} });

function host() {
  const f = cards(), h = historyHost([{ kind: 'agent', id: 'text', text: 'A stable answer' }]);
  const own = question('own'), worker = { ...question('worker'), ref: 'TASK-1' }, codex = question('codex');
  Object.assign(h.v, { cards: f.owner(), workerCards: f.owner(), codexCards: f.owner(), secretCards: f.secret,
    asks: [own], wasks: [worker], codexCard: () => codex, cli: () => 'Codex', seenAt: () => 1772946000000, afterNews: (_ref: string, at: number) => at });
  delete h.v.timelinePlan;
  const pending: Promise<any>[] = []; h.cx.spawn = (fn: any) => { const p = fn(h.cx); pending.push(p); return p; };
  const rows = (id: string) => h.v.rows().filter((r: any) => r.blk === `card:${id}`).map((r: any) => r.s);
  const update = () => { h.request(); h.drain(); expect(h.v.error).toBeUndefined(); };
  update();
  return { ...h, f, rows, update, pending, own, worker, codex };
}

test('real own, worker and Codex cards refresh click, keyboard, Other and Submit state', () => {
  const h = host();
  for (const [name, ask] of [['cards', h.own], ['workerCards', h.worker], ['codexCards', h.codex]] as const) {
    const owner = h.v[name], first = h.rows(ask.id).find((s: any) => s.key === 'q0-0');
    first.fn(h.cx); h.update(); expect(h.rows(ask.id).find((s: any) => s.key === 'q1')).toBeDefined();
    owner.pressed(ask); owner.sink(name); h.f.handlers.at(-1)({ key: 'left' }, { ...h.cx, stop_propagation() {} }); h.update();
    expect(h.rows(ask.id).find((s: any) => s.key === 'q0-0').on).toBe(true);
    h.rows(ask.id).find((s: any) => s.key === 'q0-other').fn(h.cx); h.update();
    const box = h.rows(ask.id).find((s: any) => s.key === 'q0-box').state;
    box.change('An answer', h.cx); owner.go(ask, 1); h.update();
    h.rows(ask.id).find((s: any) => s.key === 'q1-0').fn(h.cx); owner.go(ask, 2); h.update();
    expect(h.rows(ask.id).find((s: any) => s.key === 'review0').answer).toBe('An answer');
    expect(h.rows(ask.id).find((s: any) => s.key === 'submit').ctls[0].disabled).toBe(false);
  }
  const before = h.f.inputs.reduce((n, b) => n + b.reads, 0), plan = h.v.history.snapshot;
  for (let n = 0; n < 20; n++) h.request();
  expect(h.v.history.snapshot).toBe(plan); expect(h.jobs).toHaveLength(0);
  expect(h.f.inputs.reduce((n, b) => n + b.reads, 0)).toBe(before);
});

test('long detail Show all and single-question Other readiness refresh without replacing the input', () => {
  const h = host(); h.v.asks = [{ id: 'permission', req: {}, words: { kind: 'permission', title: 'Read', detail: 'Line\n'.repeat(20) } }]; h.update();
  expect(h.rows('permission').find((s: any) => s.key === 'detail').clip).toBe(180);
  h.rows('permission')[0].links.find((l: any) => l.label === 'Show all').fn(); h.update();
  expect(h.rows('permission').find((s: any) => s.key === 'detail').clip).toBeNull();
  const ask = question('single'); ask.words.questions = ask.words.questions.slice(0, 1); h.v.asks = [ask]; h.update();
  h.rows('single').find((s: any) => s.key === 'q0-other').fn(h.cx); h.update();
  const box = h.rows('single').find((s: any) => s.key === 'q0-box').state;
  expect(h.rows('single').find((s: any) => s.key === 'submit').ctls[0].disabled).toBe(true);
  box.change('Typed words', h.cx); const old = h.v.history.snapshot; h.request();
  expect(h.v.history.snapshot).toBe(old); h.drain();
  expect(h.rows('single').find((s: any) => s.key === 'q0-box').state).toBe(box);
  expect(h.rows('single').find((s: any) => s.key === 'submit').ctls[0].disabled).toBe(false);
});

test('real secret cards refresh box creation, readiness, scope, busy and error presentation', async () => {
  const h = host(), ask = { address: 'fixture', name: 'SYNTHETIC', why: 'Fixture only' }, owner = h.v.secretCards;
  h.v.sasks = [ask]; owner.prepare([ask], h.cx); h.drain(); h.update();
  const rows = () => h.rows('s:SYNTHETIC');
  const box = rows().find((s: any) => s.key === 'box').state;
  expect(rows().find((s: any) => s.key === 'actions').ctls[1].disabled).toBe(true);
  box.change('synthetic fixture', h.cx); h.update(); expect(rows().find((s: any) => s.key === 'actions').ctls[1].disabled).toBe(false);
  rows().find((s: any) => s.key === 'for').ctls[1].fn(); h.update(); expect(rows().find((s: any) => s.key === 'for').ctls[1].on).toBe(true);
  owner.save(ask, h.cx); h.update(); expect(rows().find((s: any) => s.key === 'actions').ctls[1].label).toBe('Saving…');
  await Promise.all(h.pending); h.update(); expect(rows().find((s: any) => s.key === 'actions').ctls[1].label).toBe('Save');
  owner.save(ask, h.cx); h.update(); expect(rows().find((s: any) => s.key === 'note').text).toBe('Paste the value first.');
});

test('cached own, worker and Codex keyboard sinks refuse keys after context invalidation', () => {
  const h = host();
  for (const [name, ask] of [['cards', h.own], ['workerCards', h.worker], ['codexCards', h.codex]] as const) {
    const owner = h.v[name], plan = h.v.history.snapshot; owner.pressed(ask);
    owner.sink(name, () => h.v.historyCurrent(plan)); const key = h.f.handlers.at(-1);
    h.v.path = 'other'; key({ key: 'right' }, { ...h.cx, stop_propagation() {} });
    expect(owner.state(ask).step).toBe(0); h.v.path = 'fixture';
  }
  const source = readFileSync(new URL('../mods/chat/main.js', import.meta.url), 'utf8');
  for (const name of ['cards', 'workerCards', 'codexCards']) expect(source).toContain(`this.${name}.sink(`);
});
