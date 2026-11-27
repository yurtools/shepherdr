import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from '../../service/fake-herdr';
import { fakeGpuiKit, fakeGpuiBase } from '../../service/fake-gpui';

let selectGate: (() => Promise<void>) | null, coreTerms: any[] | null, ss: any[], terms: any[], calls: any[], state: Map<string, any>, lists: any[], tree: any;
const owner = 'owner', other = 'other', machine = 'remote';
const list = (slug: string, space: string, folder: string, address: string, feature = 'feature-a') => ({
  slug, folder, prefix: 'APP', tasks: [{ id: 5, title: 'Update integration', state: 'running', space, feature,
    worktree: '/scratch/worktrees/feature', agents: [{ address, log: '/scratch/session.jsonl', agent: 'codex', session: 'session-a' }] }]
});
const ok = (value: any) => ({ code: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
const active = () => ss.find(s => s.active)?.id;
const select = (id: string) => { for (const s of ss) s.active = s.id === id; };
const key = (l: any, m: string | null = null) => ({ machine: m, folder: l.folder, slug: l.slug, id: 5 });
const terminal = (l: any, m: string | null = null) => ({ address: (m ? m + '/' : '') + l.tasks[0].agents[0].address,
  state: 'live', program: { key: 'codex' }, labels: { 'herdr.task': l.slug + '#5', 'herdr.task.space': l.tasks[0].space, 'herdr.feature': l.tasks[0].feature } });
mock.module('gpui-kit', () => fakeGpuiKit());
mock.module('gpui-base', () => fakeGpuiBase());
mock.module('herdr', () => fakeHerdr({
  spaces: () => ss, terminals: () => terms, agents: () => [], panes: () => [], machines: () => [], home: () => '/scratch', appHome: () => '/scratch/app',
  shared: (k: string) => state?.get(k), setShared: (k: string, v: any) => state?.set(k, v), layout: () => tree,
  hc: async (args: string[]) => ok((coreTerms ?? terms).find(t => t.address === args[1]) ?? {}),
  readTextFile: async (path: string) => JSON.stringify(lists.find(l => path.endsWith('/' + l.slug + '.json'))),
  exec: async (bin: string, args: string[], options: any) => {
    if (bin === 'herdr-app') { calls.push(['select', args[3]]); await selectGate?.(); select(args[3]); return ok({}); }
    if (bin === 'sleep') { await Bun.sleep(1); return ok({}); }
    if (bin === 'sh' && args[1].includes('@@herdr-task-list@@')) return ok(lists.map(l => l.slug + '.json\n' + JSON.stringify(l) + '\n@@herdr-task-list@@\n').join(''));
    if (bin === 'sh' && args[1].includes('cat "$SHEP_TASKS/')) return ok(lists.find(l => l.slug === args[3]));
    return ok({});
  },
  run: (name: string, args: any) => {
    calls.push([name, args]);
    if (name === 'space.select') select(args.id);
    if (name === 'layout.select' && args.stack === 'tasks-thread-body') tree.children[0].active = args.child;
  },
  notify: (v: any) => calls.push(['error', v]),
}));
const { default: Tasks } = await import('../../mods/tasks/main.js');
const { openTaskThread } = await import('../../mods/chat/panel.js');
const { openWorkerView } = await import('../../mods/chat/task-view.js');

beforeEach(() => {
  ss = [{ id: owner, folder: '/scratch/project', machine: null, active: false, tabs: [{ id: 'feature-tab' }, { id: 'unrelated-tab' }] },
    { id: other, folder: '/scratch/project/ui', machine: null, active: true, tabs: [{ id: 'other-tab' }] },
    { id: 'remote/owner', machine, folder: '/scratch/project', active: false, tabs: [] }];
  lists = [list('nested', owner, '/scratch/project/ui', 't1'), list('other', other, '/scratch/sibling/ui', 't2', 'feature-b')];
  terms = lists.map(l => terminal(l)); coreTerms = null; selectGate = null; calls = []; state = new Map();
  tree = { id: 'tasks-thread', children: [{ id: 'tasks-thread-body', active: 'tasks-thread-term', children: [] }] };
});
const openRow = (l: any, live: any[] = []) => {
  const panel: any = Object.create(Tasks.prototype);
  return panel.target({ list: l, task: l.tasks[0], live, section: 'working' })();
};

test('global row opens the inactive recorded space, not the exact-folder space or worktree', async () => {
  await openRow(lists[0], [{ address: 't1', role: 'worker' }]);
  expect(active()).toBe(owner);
  expect(state.get('tasks.thread')).toMatchObject({ terminal: 't1', key: key(lists[0]), space: owner, feature: 'feature-a' });
  expect(calls.filter(c => ['tab.select', 'tab.new', 'pane.focus'].includes(c[0]))).toEqual([]);
});

test('native Open chat uses the record behind the worker, despite the colliding display ref', async () => {
  await openTaskThread('t1', 'APP-5', null, 'chat');
  expect(active()).toBe(owner);
  expect(state.get('tasks.thread')).toMatchObject({ key: key(lists[0]), space: owner, terminal: 't1' });
});

const { activeTaskThread, threadIdentity } = await import('../../mods/chat/task-thread-state.js');
const { reconcileTaskPanel } = await import('../../mods/chat/task-view.js');
const { default: Jump } = await import('../../mods/jump/main.js');
const { default: Chat } = await import('../../mods/chat/main.js');
const { toAgent } = await import('../../mods/tasks/inbox.js');

test('each space remembers its own task; duplicate open does not touch unrelated tabs', async () => {
  await openTaskThread('t1', 'APP-5', null, 'chat');
  await openTaskThread('t2', 'APP-5', null, 'chat');
  expect(activeTaskThread()?.key.folder).toBe(lists[1].folder);
  select(owner);
  reconcileTaskPanel();
  expect(activeTaskThread()?.key.folder).toBe(lists[0].folder);
  const before = threadIdentity(activeTaskThread()); calls = [];
  await openRow(lists[0], [{ address: 't1', role: 'worker' }]);
  expect(threadIdentity(activeTaskThread())).toBe(before);
  expect(calls.filter(c => c[0] === 'select' || c[0] === 'tab.select' || c[1]?.stack === 'tasks-thread-body')).toEqual([]);
});
test('closed or restored shell uses the recorded history; a reused terminal cannot take over', async () => {
  terms = [{ ...terminal(lists[0]), program: { key: 'shell' } }, { ...terminal(lists[1]), address: 't1' }];
  await openRow(lists[0]);
  expect(activeTaskThread()).toMatchObject({ historical: true, terminal: 't1', session: 'session-a', log: { path: '/scratch/session.jsonl', kind: 'codex' } });
  expect(state.get('tasks.thread.termreq')).toBeNull();
  const view: any = Object.create(Chat.prototype);
  Object.assign(view, { historical: true, endedLog: activeTaskThread()?.log, reset() {}, set() {} });
  await view.locate({ notify() {} });
  expect(view.path).toBe('/scratch/session.jsonl');
});

test('remote machine plus id, not local same id, determines the owner and terminal', async () => {
  const remote = { ...list('remote-list', owner, '/scratch/project/ui', 't1'), machine };
  lists.push(remote); terms.push(terminal(remote, machine));
  await openRow(remote, [{ address: 'remote/t1', role: 'worker' }]);
  expect(active()).toBe('remote/owner');
  expect(activeTaskThread()).toMatchObject({ space: 'remote/owner', terminal: 'remote/t1', key: key(remote, machine) });
});

test('unavailable owner and stale explicit folder fail without changing the displayed view', async () => {
  await openTaskThread('t2', 'APP-5', null, 'chat');
  const before = threadIdentity(activeTaskThread()); calls = [];
  ss = ss.filter(s => s.id !== owner);
  const missing = await openWorkerView({ key: key(lists[0]), task: 'APP-5' });
  expect(missing).toMatchObject({ ok: false, why: expect.stringContaining('owning space') });
  const wrong = await openWorkerView({ key: { ...key(lists[0]), folder: '/scratch/elsewhere' }, task: 'APP-5' });
  expect(wrong).toMatchObject({ ok: false, why: expect.stringContaining('requested folder') });
  expect(active()).toBe(other);
  expect(threadIdentity(activeTaskThread())).toBe(before);
  expect(calls.filter(c => c[0] === 'layout.select' || c[0] === 'select')).toEqual([]);
});
test('Jump, chat news, worker inbox, voice and Review preserve the source target', async () => {
  const jump: any = Object.create(Jump.prototype);
  await jump.openTask({ live: [], taskKey: key(lists[0]), ref: 'APP-5', space: owner, feature: 'feature-a' });
  expect(activeTaskThread()?.space).toBe(owner);
  select(other);
  const chat: any = Object.create(Chat.prototype); chat.machine = null;
  const task = { ...lists[0].tasks[0], ref: 'APP-5', key: 'nested#5', folder: lists[0].folder };
  await chat.openTask(5, task);
  expect(activeTaskThread()?.key.slug).toBe('nested');
  select(other);
  await toAgent('t1');
  expect(activeTaskThread()?.space).toBe(owner);
  select(other);
  expect(await chat.voiceNav({ kind: 'task', task: 'APP-5', ref: 'APP-5', folder: lists[0].folder, tab: 'chat' })).toMatchObject({ ok: true });
  expect(activeTaskThread()?.key.slug).toBe('nested');
  select(other);
  let reviewed: any;
  await openWorkerView({ key: key(lists[0]), task: 'APP-5' }, { review: v => reviewed = v });
  expect(reviewed.key.folder).toBe(lists[0].folder);
  expect(active()).toBe(owner);
});

test('a retained native Codex label cannot turn a restored shell into a live conversation', async () => {
  coreTerms = [{ ...terms[0], foreground: { name: 'bash', argv: ['bash', '-i'] } }, terms[1]];
  await openRow(lists[0], [{ address: 't1', role: 'worker' }]);
  expect(activeTaskThread()?.historical).toBe(true);
  expect(activeTaskThread()?.log?.path).toBe('/scratch/session.jsonl');
});
test('rapid opens of distinct refs do not let a stale read supersede the latest click', async () => {
  const first = openRow(lists[0], [{ address: 't1', role: 'worker' }]);
  const second = openRow(lists[1], [{ address: 't2', role: 'worker' }]);
  await Promise.all([first, second]);
  expect(active()).toBe(other);
  expect(activeTaskThread()?.key.slug).toBe('other');
  expect(calls.filter(c => c[0] === 'select')).toEqual([]);
});

test('a late native space selection cannot win over a newer open', async () => {
  let release!: () => void, started!: () => void;
  const begun = new Promise<void>(r => started = r);
  selectGate = () => new Promise<void>(r => { release = r; selectGate = null; started(); });
  const first = openRow(lists[0], [{ address: 't1', role: 'worker' }]);
  await begun;
  const second = openRow(lists[1], [{ address: 't2', role: 'worker' }]);
  release();
  await Promise.all([first, second]);
  expect(active()).toBe(other);
  expect(activeTaskThread()?.key.slug).toBe('other');
  expect(calls.filter(c => c[0] === 'select').map(c => c[1])).toEqual([owner, other]);
});
test('a keyed legacy saved view is restored to its owner without switching the current space', async () => {
  state.set('tasks.thread', { terminal: 't1', key: key(lists[0]), task: 'APP-5' });
  reconcileTaskPanel();
  for (let i = 0; i < 100 && !state.get('tasks.thread.bySpace'); i++) await Bun.sleep(1);
  expect(active()).toBe(other);
  expect(activeTaskThread()).toBeNull();
  expect(calls.filter(c => c[0] === 'select')).toEqual([]);
  select(owner); reconcileTaskPanel();
  expect(activeTaskThread()?.key.slug).toBe('nested');
});
