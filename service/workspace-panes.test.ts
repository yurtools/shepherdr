import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, byId, built, handler } from "./fake-gpui";
let serial = 0;
let ps: any[] = [], ts: any[] = [], ss: any[] = [], calls: any[] = [], overlays: any[] = [];
const state = new Map<string, any>();
const t = new Proxy({}, { get: () => "#000000" });
mock.module("herdr", () => fakeHerdr({
  panes: () => ps, terminals: () => ts, spaces: () => ss,
  shared: (k: string) => state.get(k), setShared: (k: string, v: any) => state.set(k, v),
  run: (command: string, args: any) => calls.push([command, args]),
  openOverlay: (spec: any) => overlays.push(spec), theme: () => t,
  exec: async (bin: string, args: string[]) => {
    if (bin === "sh" && args[1].includes("hc connect")) return { code: 0, stdout: JSON.stringify({ result: { value: { spaces: [{ tabs: [{ id: "tab-agent", root: { type: "row", children: ps.map(p => ({ id: p.pane })) } }] }] } } }), stderr: "" };
    calls.push([args[1], JSON.parse(args[2])]);
    const command = args[1], data = JSON.parse(args[2]);
    if (command === "pane.close") ps = ps.filter(p => p.pane !== data.pane);
    if (command !== "pane.split") return { code: 0, stdout: "{}", stderr: "" };
    const pane = ++serial === 1 ? "new-pane" : `new-pane-${serial}`;
    ps.push({ pane, tab: "tab-agent", ...(data.mod ? { mod: data.mod } : { terminal: `display-shell-${serial}` }) });
    return { code: 0, stdout: JSON.stringify({ pane }), stderr: "" };
  },
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
const C = await import("../mods/pane-chat/companions.js");
const { popupAt, popupBounds } = await import("../mods/chat/popup.js");
const { modelButton, settingsRows } = await import("../mods/shepherdr-settings/settings.js");
const cx: any = { stop_propagation() {}, notify() {}, timer: { after() {} } };
const menu = { models: [{ id: "m", name: "Model", efforts: ["high"] }], perms: [{ id: "auto", label: "Auto" }] };
const coord = () => ({ key: "test", sel: { agent: "codex", model: "m", effort: "high", perm: "auto" }, data: {
  menus: { codex: menu }, profiles: [{ id: "account-2", name: "Account 2" }], icons: {}, permDefault: {} } });
beforeEach(() => {
  serial = 0; state.clear(); built.length = 0; calls = []; overlays = [];
  ps = [{ pane: "agent-pane", tab: "tab-agent", mod: "chat" }, { pane: "assistant-pane", tab: "tab-assistant", mod: "chat" }];
  ts = [
    { address: "t1", state: "live", agent: "codex", program: { agent: true, name: "Codex (Account 2)" }, labels: { "herdr.chat": "agent-pane" } },
    { address: "t2", state: "live", agent: "codex", program: { agent: true, name: "Codex" }, labels: { "herdr.chat": "assistant-pane", "herdr.role": "coordinator", "herdr.chat.origin": "slot:assistant" } },
  ];
  ss = [{ id: "space", machine: null, tabs: [{ id: "tab-agent", name: "Codex (Account 2)" }, { id: "tab-assistant", name: "Assistant" }] }];
});
test("profile and model menus use the pressed settings control, independent of the previous context menu", () => {
  const c: any = coord(); modelButton(t, c, {}, cx);
  const profile = byId("profile-test")!, model = byId("ns-model-test")!;
  handler(profile, "on_mouse_down")!({ bounds: { x: 1400, y: 500, width: 120, height: 28 } });
  handler(profile, "on_click")!({}, cx);
  expect(overlays[0].at).toEqual({ x: 1260, y: 534 });
  handler(model, "on_mouse_down")!({ bounds: { x: 1530, y: 500, width: 180, height: 28 } });
  handler(model, "on_click")!({}, cx);
  expect(overlays[1].at).toEqual({ x: 1370, y: 33 });
});
test("the new-space permissions row also anchors its own dropdown", () => {
  settingsRows(t, coord(), {}, cx);
  const control = byId("ns-perm")!;
  handler(control, "on_mouse_down")!({ bounds: { x: 900, y: 300, width: 80, height: 26 } });
  handler(control, "on_click")!({}, cx);
  expect(overlays[0].at).toEqual({ x: 720, y: 332 });
});
test("popup fallback derives a control origin from window and local coordinates; zoom is not applied twice", () => {
  expect(popupAt(popupBounds({ position: { x: 1000, y: 600 }, local_position: { x: 10, y: 8 } }), 260, 100)).toEqual({ x: 730, y: 626 });
  expect(popupAt({ x: 1500, y: 1000, width: 200, height: 40 }, 300, 200, true)).toEqual({ x: 1400, y: 794 });
});
test("the chooser keeps accounts distinguishable, includes the Assistant, excludes other spaces and itself", () => {
  ts.push({ address: "t3", state: "live", agent: "codex", labels: { "herdr.space": "other" } });
  expect(C.besideChoices("agent-pane").map((x: any) => x.label)).toEqual(["Assistant"]);
  expect(C.besideChoices("assistant-pane").map((x: any) => x.label)).toEqual(["Codex (Account 2)"]);
});
test("opening beside preserves the original account/owner and uses the existing session", async () => {
  const labels = structuredClone(ts[1].labels);
  await C.openBeside("agent-pane", C.besideChoices("agent-pane")[0]);
  expect(calls[0]).toEqual(["pane.split", { pane: "agent-pane", direction: "right" }]);
  expect(C.companionFor("new-pane")?.mode).toBe("terminal");
  expect(ts[1].labels).toEqual(labels);
  const record = C.companionFor("new-pane");
  await C.companionMode(record, "chat");
  expect(C.companionFor("new-pane-2")?.mode).toBe("chat");
  expect(calls).toContainEqual(["pane.split", { direction: "down", pane: "new-pane", mod: "chat", props: { companion: record.id, terminal: "t2" } }]);
  expect(calls.at(-1)).toEqual(["pane.close", { pane: "new-pane" }]);
  expect(C.companionFor("new-pane-2")?.pendingPane).toBe("new-pane");
  expect(calls).toContainEqual(["pane.close", { pane: "new-pane" }]);
  await C.companionMode(C.companionFor("new-pane-2"), "terminal");
  expect(C.companionFor("new-pane-3")?.mode).toBe("terminal");
  expect(calls).toContainEqual(["pane.close", { pane: "new-pane-2" }]);
  C.closeCompanion("new-pane-3");
  expect(calls.at(-1)).toEqual(["pane.close", { pane: "new-pane-3" }]);
  expect(calls.some(([name]) => /kill|park|restart|label/.test(name))).toBe(false);
  expect(ts[1].labels).toEqual(labels);
});
test("an agent already beside us is focused, and an extra view follows the same origin after restart", async () => {
  await C.openBeside("agent-pane", C.besideChoices("agent-pane")[0]);
  calls = [];
  await C.openBeside("agent-pane", C.besideChoices("agent-pane")[0]);
  expect(calls).toEqual([["pane.focus", { pane: "new-pane" }]]);
  ts[1].state = "done";
  ts.push({ address: "t4", state: "live", labels: { "herdr.chat.origin": "slot:assistant" } });
  expect(C.boundAgent(C.companionFor("new-pane"))?.address).toBe("t4");
});

test("Chat/Terminal replacement nests across the parent axis to preserve pane proportions", () => {
  const nested = { type: "row", children: [{ id: "left" }, { type: "column", children: [{ id: "upper" }, { id: "lower" }] }] };
  expect(C.replacementDirection(nested, "left")).toBe("down");
  expect(C.replacementDirection(nested, "lower")).toBe("right");
});

test("a replacement performs no work in the disposed old header after closing its pane", async () => {
  await C.openBeside("agent-pane", C.besideChoices("agent-pane")[0]);
  calls = [];
  await C.companionMode(C.companionFor("new-pane"), "chat");
  expect(calls.map(x => x[0])).toEqual(["pane.split", "pane.focus", "pane.close"]);
  expect(C.companionFor("new-pane-2")?.changing).toBeNull();
});

test("the persistent tab bar processes a header's view request across the structural swap", async () => {
  await C.openBeside("agent-pane", C.besideChoices("agent-pane")[0]);
  let tick: any, work: Promise<any> | null = null;
  const cx: any = { timer: { every: (_ms: number, f: any) => { tick = f; } }, notify() {}, spawn: (f: any) => { work = f(cx); } };
  C.watchCompanions(cx, (e: any) => { throw e; });
  C.requestCompanionMode(C.companionFor("new-pane"), "chat");
  tick(cx); await work;
  expect(C.companionFor("new-pane-2")?.mode).toBe("chat");
  expect(calls.at(-1)).toEqual(["pane.close", { pane: "new-pane" }]);
});
