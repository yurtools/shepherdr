import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from '../../service/fake-herdr';
import { fakeGpuiBase, fakeGpuiKit, built, byId, element, handler } from '../../service/fake-gpui';

let shared: Map<string, any>, saved: Map<string, string>, props: any, overlays: any[], closed: any[];
let spaces: any[];
const t = new Proxy({}, { get: (_, k) => String(k) });
mock.module('gpui-kit', () => fakeGpuiKit());
mock.module('gpui-base', () => fakeGpuiBase());
mock.module('herdr', () => fakeHerdr({
  exec: async () => ({ code: 1, stdout: '', stderr: '' }), home: () => '/fixture', appHome: () => '/fixture/app',
  theme: () => t, props: () => props, shared: (key: string) => shared.get(key), setShared: (key: string, value: any) => shared.set(key, value),
  spaces: () => spaces, machines: () => [], agents: () => [], panes: () => [], terminals: () => [],
  openOverlay: (p: any) => overlays.push(p), closeOverlay: (id: any) => closed.push(id),
}));
const { default: Tasks } = await import('../../mods/tasks/main.js');
const { default: TasksMenu } = await import('../../mods/tasks-menu/main.js');
const cx: any = { notify() {}, stop_propagation() {}, spawn() {}, focus_handle: () => ({ focus() {} }), timer: { every() {}, after(_ms: number, fn: () => void) { fn(); } } };
const words = (e: any): string => typeof e === 'string' ? e : (e?.kids ?? []).map(words).join(' ');
const click = (id: string) => handler(byId(id), 'on_click')!({}, cx);
const draw = (p: any) => { built.length = 0; p.render(cx); return words(byId('task-list')); };
const checked = (id: string) => byId(id).calls.some(([name, args]: any) => name === 'bg' && args[0] === 'selected');
const menuChecked = (id: string) => byId(id).kids.at(-1).kids.length > 0;
const query = () => { let value = ''; return { value: () => value, set_value: (v: string) => { value = v; } }; };

beforeEach(() => {
  shared = new Map(); saved = new Map(); props = null; overlays = []; closed = []; built.length = 0;
  spaces = [{ id: 's1', name: 'Shop', folder: '/shop', active: true }, { id: 's2', name: 'Other', folder: '/other' }];
  globalThis.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) } as Storage;
});

function panel() {
  const p: any = Object.create(Tasks.prototype);
  p.watch = () => {}; p.loadRemote = () => {};
  p.init({}, cx);
  p.query = query(); p.ready = true; p.width = 900;
  p.lists = [
    { folder: '/shop', slug: 'shop', prefix: 'SHOP', name: 'Shop', tasks: [
      { id: 1, title: 'Needs attention', state: 'running' },
      { id: 2, title: 'Working in shop', state: 'running' },
      { id: 3, title: 'Finished pinned', state: 'done' },
      { id: 4, title: 'Archived past', state: 'done', archived: 1 },
      { id: 5, title: 'Deferred review', state: 'ready', deferred_ready_at: 1, ready_at: 1 },
      { id: 6, title: 'Ready review', state: 'ready' },
    ], automations: [{ title: 'Daily report' }] },
    { folder: '/other', slug: 'other', prefix: 'OTHER', name: 'Other', tasks: [{ id: 7, title: 'Working elsewhere', state: 'running' }] },
  ];
  p.live = (_list: any, task: any) => [1, 2, 7].includes(task.id) ? [{ address: `t${task.id}`, status: task.id === 1 ? 'blocked' : 'working' }] : [];
  p.statusLine = (p: any) => p.section;
  p.row = (p: any) => element().child(p.task.title);
  p.needRow = (x: any) => element().child(x.title);
  p.autoRow = (_l: any, a: any) => element().child(a.title);
  shared.set('tasks.pinned', [':/shop#3', ':/other#7']);
  shared.set('inbox.tasks', [{ kind: 'waiting', folder: '/shop', ref: 'SHOP-3', title: 'Stale inbox' }]);
  return p;
}

test('real native draw and chip handlers select the union, excluding pinned Done, and reset grouping', () => {
  const p = panel(); shared.set('tasks.group', 'status');
  expect(draw(p)).toContain('Finished pinned');
  click('chip-needs'); expect(draw(p)).toContain('Needs attention');
  click('chip-working');
  const result = draw(p);
  for (const title of ['Needs attention', 'Working in shop', 'Working elsewhere']) expect(result).toContain(title);
  for (const title of ['Finished pinned', 'Archived past', 'Deferred review', 'Ready review', 'Daily report', 'Stale inbox']) expect(result).not.toContain(title);
  expect(checked('chip-needs')).toBe(true); expect(checked('chip-working')).toBe(true); expect(checked('chip-all')).toBe(false);
  click('chip-needs'); expect(draw(p)).not.toContain('Needs attention');
  click('chip-working'); expect(draw(p)).toContain('Finished pinned'); expect(checked('chip-all')).toBe(true);
  click('chip-needs'); draw(p); click('chip-working'); draw(p); click('chip-all');
  expect(draw(p)).toContain('Finished pinned'); expect(byId('head-pinned')).toBeDefined(); expect(byId('task-archived')).toBeDefined();
  expect(saved.get('filter')).toBe('[]');
});

test('More keeps multiple checks, includes hidden selected statuses, and handles rapid keyboard picks', () => {
  const p = panel(); p.width = 220; p.setFilters(['needs', 'working']); draw(p);
  expect(words(byId('chip-more'))).toBe('More · 2 ');
  click('chip-more'); props = { ...overlays[0].props, overlay: 'more' };
  expect(props.items.map((item: any) => item.key)).toContain('deferred');
  const menu: any = Object.create(TasksMenu.prototype); menu.init(props, cx);
  const renderMenu = () => { built.length = 0; menu.render(cx); };
  renderMenu(); expect(menuChecked('tm-needs')).toBe(true); expect(menuChecked('tm-working')).toBe(true); expect(menuChecked('tm-deferred')).toBe(false);
  click('tm-deferred'); renderMenu(); expect(menuChecked('tm-deferred')).toBe(true);
  // A second pick before Tasks renders must not drop the first pick.
  menu.at = props.items.findIndex((item: any) => item.key === 'done');
  handler(byId('tasks-menu'), 'on_key_down')!({ key: 'enter' }, cx);
  renderMenu(); expect(menuChecked('tm-done')).toBe(true); expect(closed).toEqual([]);
  expect(draw(p)).toContain('Deferred review'); expect(p.filters).toEqual(['needs', 'deferred', 'working', 'done']);
  expect(words(byId('chip-more'))).toBe('More · 4 ');
  renderMenu(); handler(byId('tasks-menu'), 'on_key_down')!({ key: 'escape' }, cx); expect(closed).toEqual(['more']);
  p.width = 900; draw(p); expect(checked('chip-needs')).toBe(true); expect(checked('chip-working')).toBe(true); expect(words(byId('chip-more'))).toBe('More · 2 ');
});

test('scope, search, zero-count transitions, archived view, setting and navigation do not silently clear choices', () => {
  saved.set('filter', 'working'); const p = panel(); expect(p.filters).toEqual(['working']);
  p.pickFilter('needs'); p.here = true;
  expect(draw(p)).not.toContain('Working elsewhere'); expect(shared.get('tasks.pinned')).toContain(':/other#7');
  p.query.set_value('attention'); expect(draw(p)).toContain('Needs attention'); expect(checked('chip-working')).toBe(true);
  p.query.set_value('missing'); expect(draw(p)).toContain('No tasks in the selected statuses'); expect(p.filters).toEqual(['needs', 'working']);
  p.query.set_value(''); p.lists[0].tasks[0].state = 'done'; p.lists[0].tasks[1].state = 'done';
  expect(draw(p)).toContain('No tasks in the selected statuses'); expect(p.filters).toEqual(['needs', 'working']);
  const reload = panel(); expect(reload.filters).toEqual(['needs', 'working']);
  shared.set('tasks.filters', false); expect(draw(p)).toContain('Finished pinned'); expect(byId('task-filter')).toBeUndefined();
  shared.set('tasks.filters', true); expect(draw(p)).toContain('No tasks in the selected statuses');
  p.archivedOpen = true; expect(draw(p)).toContain('Archived past'); expect(byId('task-filter')).toBeUndefined(); p.archivedOpen = false;
  shared.set('tasks.filterreq', { key: 'working', at: 5 }); draw(p); expect(p.filters).toEqual(['working']);
  shared.set('tasks.filterreq', { key: 'working', at: 6 }); draw(p); expect(p.filters).toEqual(['working']);
  shared.set('tasks.searchreq', { q: 'archived', at: 7 }); expect(draw(p)).toContain('Archived past'); expect(p.filters).toEqual([]);
  shared.set('tasks.searchreq', { q: 'review', filter: 'deferred', at: 8 }); expect(draw(p)).toContain('Deferred review'); expect(p.filters).toEqual(['deferred']);
});

test('automations are separate from task statuses and only included explicitly', () => {
  const p = panel(); p.setFilters(['working']); expect(draw(p)).not.toContain('Daily report');
  p.pickFilter('automations'); expect(draw(p)).toContain('Daily report'); expect(byId('head-automations')).toBeDefined();
  p.pickFilter('working'); const only = draw(p); expect(only).toContain('Daily report'); expect(only).not.toContain('Working in shop');
  p.pickFilter('automations'); expect(draw(p)).toContain('Finished pinned');
});
