// Regression for the one task drill-in: it cannot show a worker in another
// space or expose the terminal left behind by a different task.
import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";
const ran: [string, any][] = [];
const shared = new Map<string, any>();
const tree = { id: "root", children: [{ id: "tasks", children: [{ id: "tasks-list" }, { id: "tasks-thread", children: [
  { id: "tasks-thread-body", active: "tasks-thread-term", children: [{ id: "tasks-thread-chat" }, { id: "tasks-thread-term" }] },
] }] }] };
let spaces: any[], terminals: any[], record: any;
const list = { machine: null, folder: "/tmp/shop", slug: "shop", prefix: "SHOP", tasks: [] };
mock.module("herdr", () => fakeHerdr({
  run: (cmd: string, args: any) => { ran.push([cmd, args]); },
  layout: () => tree,
  exec: async (bin: string, args: string[]) => {
    if (bin === 'herdr-app') for (const s of spaces) s.active = s.id === args[3];
    return { code: 0, stdout: "{}", stderr: "" };
  },
  hc: async (args: string[]) => ({ code: 0, stdout: JSON.stringify(terminals.find(t => t.address === args[1]) ?? {}), stderr: "" }), home: () => '/tmp', appHome: () => '/tmp/app',
  readTextFile: async () => JSON.stringify({ ...list, tasks: [record] }),
  shared: (k: string) => shared.get(k), setShared: (k: string, v: unknown) => { shared.set(k, v); },
  agents: () => [], panes: () => [], terminals: () => terminals, spaces: () => spaces, machines: () => [],
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Tasks } = await import("../mods/tasks/main.js");

beforeEach(() => {
  ran.length = 0; shared.clear();
  spaces = [{ id: 'other', folder: list.folder, active: true }, { id: 'owner', folder: '/tmp', active: false }];
  terminals = [];
});
const open = (live: any[], task: any = { id: 3, title: "Third", agents: [] }) => {
  record = { ...task, space: 'owner', state: 'running', feature: 'feature' };
  terminals = live.map(a => ({ ...a, state: 'live', program: { key: 'codex' }, labels: {
    'herdr.task': `shop#${record.id}`, 'herdr.task.space': 'owner', 'herdr.feature': 'feature' } }));
  const tasks: any = Object.create(Tasks.prototype);
  return tasks.target({ list, task: record, live, section: "working" })();
};

test("a task with a live worker selects its recorded space before its drill-in", async () => {
  await open([{ address: "t15", role: "worker", status: "working" }]);
  expect(spaces.find(s => s.active).id).toBe('owner');
  expect(shared.get("tasks.thread")).toMatchObject({ terminal: "t15", title: "Third", space: 'owner', feature: 'feature' });
  expect(ran).toContainEqual(["layout.select", { stack: "tasks", child: "tasks-thread" }]);
  expect(ran).toContainEqual(["layout.select", { stack: "tasks-thread-body", child: "tasks-thread-chat" }]);
});

test("an ended task opens its recorded log on its owner, not a retained shell", async () => {
  await open([], { id: 2, title: "Second", agents: [{ address: "t9", log: "/tmp/log.jsonl", agent: "claude" }] });
  expect(shared.get('tasks.thread')).toMatchObject({ terminal: 't9', historical: true, log: { path: '/tmp/log.jsonl', kind: 'claude' } });
  expect(ran).toContainEqual(["layout.select", { stack: "tasks-thread-body", child: "tasks-thread-chat" }]);
});
