import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";
let verified = true;
let calls: any[] = [], row: any, ps: any[], ts: any[], ss: any[], viewProps: any;
let listRead: ((args: string[]) => Promise<any>) | null;
const state = new Map<string, any>();
mock.module("herdr", () => fakeHerdr({
  props: () => viewProps,
  focused: () => ({ pane: "target" }),
  openOverlay: (args: any) => calls.push(["overlay", args]),
  appHome: () => "/fake-app", shared: (k: string) => state.get(k), setShared: (k: string, v: any) => state.set(k, v),
  panes: () => ps, terminals: () => ts,
  spaces: () => ss,
  run: (name: string, args: any) => calls.push([name, args]),
  hc: async (args: string[]) => { calls.push(["hc", args]); return { code: 0, stdout: "{}", stderr: "" }; },
  exec: async (bin: string, args: string[]) => {
    if (bin === "python3" && args[1] === "list" && listRead) return listRead(args);
    if (bin === "python3") return { code: 0, stdout: JSON.stringify({ session: row, liveVerified: verified }), stderr: "" };
    const name = args[1], data = JSON.parse(args[2]); calls.push([name, data]);
    if (name === "tab.new" || name === "terminal.open") { ps.push({ pane: "old", terminal: "t5", tab: "tab" }); return { code: 0, stdout: JSON.stringify({ tab: "tab", terminal: "t5" }), stderr: "" }; }
    if (name === "pane.split") { ps.push({ pane: "new", tab: "tab", mod: "chat" }); return { code: 0, stdout: '{"pane":"new"}', stderr: "" }; }
    return { code: 0, stdout: "{}", stderr: "" };
  },
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
const { default: Sessions } = await import("../mods/workspace-sessions/main.js");
const { default: Sidebar } = await import("../mods/workspace-sessions/sidebar.js");
const H = await import("../mods/tabs-tasks/session-history.js");
beforeEach(() => {
  ss = [{ id: "space", name: "First space", active: true, folder: "/project", tabs: [{ id: "tab" }] }];
  viewProps = { overlay: "history-dialog" }; listRead = null;
  verified = true; calls = []; ps = [{ pane: "target", tab: "tab" }]; ts = []; state.clear();
  row = { home: "/account-two", session: "00000000-0000-0000-0000-000000000001", key: "key", cwd: "/project", title: "Saved chat", model: "model-one", effort: "high", sandbox: "workspace-write", approval: "on-request" };
});
test("a resumed folder-history session explicitly uses its own account and saved model/policy", () => {
  const a = H.sessionArgv(row);
  expect(a).toContain("CODEX_HOME=/account-two");
  expect(a).toContain("resume"); expect(a).toContain(row.session);
  expect(a).toContain("model-one"); expect(a).toContain('model_reasoning_effort="high"');
  expect(a).toContain("workspace-write"); expect(a).toContain("on-request");
});
test("a captured argv retains options while replacing the session and forcing the owning account", () => {
  row.argv = ["env", "CODEX_HOME=/wrong-account", "codex", "resume", "--no-daemon", "--sandbox", "read-only", "old-session"];
  const a = H.sessionArgv(row);
  expect(a).toContain("CODEX_HOME=/account-two"); expect(a).not.toContain("CODEX_HOME=/wrong-account");
  expect(a).toContain("read-only"); expect(a).not.toContain("old-session"); expect(a.at(-1)).toBe(row.session);
});
test("missing original account/session information fails without a fallback account", () => {
  expect(() => H.sessionArgv({ session: row.session })).toThrow();
  expect(() => H.sessionArgv({ ...row, session: "--last" })).toThrow();
});
test("resume opens the exact conversation in a new Chat without ending existing agents", async () => {
  await H.openSavedSession({ space: "space", key: "key" });
  expect(calls.find(c => c[0] === "tab.new")[1]).toMatchObject({ space: "space", folder: "/project", name: "Saved chat" });
  expect(calls.find(c => c[0] === "tab.new")[1].argv).toContain("CODEX_HOME=/account-two");
  expect(calls.find(c => c[0] === "pane.split")[1].direction).toBe("down");
  expect(calls).toContainEqual(["terminal.park", { terminal: "t5" }]);
  expect(calls).toContainEqual(["pane.focus", { pane: "new" }]);
  expect(calls.some(c => /kill/.test(c[0]))).toBe(false);
});
test("an already running session focuses its existing chat instead of launching a duplicate", async () => {
  row.terminal = "t2";
  ps.push({ pane: "owner", tab: "tab", mod: "chat" });
  ts.push({ address: "t2", labels: { "herdr.chat": "owner" } });
  await H.openSavedSession({ space: "space", key: "key" });
  expect(calls).toEqual([["tab.select", { id: "tab" }], ["pane.focus", { pane: "owner" }]]);
});
test("resume beside validates the target before launching and uses the saved folder", async () => {
  await expect(H.openSavedSession({ space: "space", key: "key", beside: "missing" })).rejects.toThrow("closed");
  expect(calls.length).toBe(0);
  await H.openSavedSession({ space: "space", key: "key", beside: "target" });
  expect(calls.find(c => c[0] === "terminal.open")[1]).toMatchObject({ place: "right", folder: "/project" });
});

test("resume is blocked when active sessions cannot be checked", async () => {
  verified = false;
  await expect(H.openSavedSession({ space: "space", key: "key" })).rejects.toThrow("Cannot check running sessions");
  expect(calls.length).toBe(0);
});

test("session search holds the keyboard against the chat behind it and releases it on close", () => {
  const dialog: any = new Sessions();
  const cx: any = { focus_handle: () => ({ focus() {} }), spawn() {}, timer: { every() {}, after(_ms: number, fn: any) { fn(); } } };
  dialog.init({}, cx);
  expect(state.get("keyboard.holder").who).toBe("dialog:sessions:history-dialog");
  dialog.close();
  expect(state.get("keyboard.holder").who).toBeNull();
});

// Keep async tasks controllable so a response from the previous space can arrive last.
function sidebarContext() {
  const pending: Promise<any>[] = [];
  const cx: any = { notify() {}, timer: { every() {} }, spawn(fn: any) { pending.push(fn(cx)); } };
  return { cx, flush: () => Promise.all(pending) };
}
const listResult = (title: string) => ({ code: 0, stdout: JSON.stringify({ sessions: [{ ...row, title }] }), stderr: "" });
test("sidebar follows the selected space and explicit folder without taking the keyboard", async () => {
  const scopes: string[][] = [];
  listRead = async args => { scopes.push(args); return listResult(args[args.indexOf("--space") + 1]); };
  state.set("workspace.roots", { second: "/override" });
  const sidebar: any = new Sidebar(), { cx, flush } = sidebarContext();
  sidebar.init(cx); await flush();
  expect(state.has("keyboard.holder")).toBe(false);
  expect(sidebar.rows[0].title).toBe("space");
  ss = [{ id: "second", active: true, folder: "/other" }];
  sidebar.sync(cx);
  expect(sidebar.rows).toEqual([]);
  await flush();
  expect(sidebar.rows[0].title).toBe("second");
  expect(scopes.at(-1)).toContain("/override");
  sidebar.open(sidebar.rows[0]);
  expect(calls.at(-1)).toEqual(["overlay", expect.objectContaining({ props: { space: "second", pane: "target", selected: "key" } })]);
  sidebar.close();
});
test("a late history response cannot replace the newly selected space or a closed sidebar", async () => {
  let resolveOld: any;
  listRead = args => args.includes("space") ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(listResult("New space"));
  const sidebar: any = new Sidebar(), { cx, flush } = sidebarContext();
  sidebar.init(cx);
  ss = [{ id: "second", active: true, folder: "/other" }];
  sidebar.sync(cx);
  await Promise.resolve(); await Promise.resolve();
  resolveOld(listResult("Old space")); await flush();
  expect(sidebar.rows[0].title).toBe("New space");
  listRead = () => new Promise(resolve => { resolveOld = resolve; });
  sidebar.sync(cx, true); sidebar.close();
  resolveOld(listResult("Closed view")); await flush();
  expect(sidebar.rows[0].title).toBe("New space");
});
