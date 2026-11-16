// Extra views of existing agents. Ownership remains in the original terminal/chat tab:
// no relabel, park, restart or kill is part of opening/closing a companion.
import { shared, setShared, exec, run, focused } from "herdr";
import { panes, terminals, spaces } from "./live.js";
import { chatPane } from "./core/spaces.js";
const KEY = "workspace.companions";
export const companionRecords = () => shared(KEY) ?? {};
export function companionPane(id) { return companionRecords()[id]?.pane ?? null; }
export function companionFor(pane) {
  const entry = Object.entries(companionRecords()).find(([, r]) => r.pane === pane);
  return entry ? { id: entry[0], ...entry[1] } : null;
}
export function boundAgent(record, all = terminals()) {
  if (!record) return null;
  return all.find(k => k.state === "live" && (k.address === record.terminal ||
    (record.slot && k.labels?.["herdr.chat.slot"] === record.slot) ||
    (record.origin && k.labels?.["herdr.chat.origin"] === record.origin))) ?? null;
}
export function companionAgent(id, terminal) {
  const records = companionRecords(), record = records[id];
  if (!record || record.terminal === terminal) return;
  setShared(KEY, { ...records, [id]: { ...record, terminal } });
  if (record.mode === "terminal") run("terminal.show", { pane: record.pane, terminal });
}
export function closeCompanion(pane) {
  const records = { ...companionRecords() };
  for (const [id, r] of Object.entries(records)) if (r.pane === pane) delete records[id];
  setShared(KEY, records);
  run("pane.close", { pane });
}
// Nest perpendicular to the current parent, then collapse the old leaf. Splitting along the
// parent's axis would flatten the tree and shrink this pane on every Chat/Terminal switch.
export function replacementDirection(node, pane) {
  for (const child of node?.children ?? []) {
    if (child.id === pane) return node.type === "column" ? "right" : "down";
    const found = replacementDirection(child, pane);
    if (found) return found;
  }
  return null;
}
async function directionFor(pane) {
  try {
    const machine = pane.pane.includes("/") ? pane.pane.split("/")[0] : null;
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "doc.get", params: { name: "herdr-app" } }) + "\n";
    const r = await exec("sh", ["-c", 'printf "%s" "$1" | hc connect', "workspace-layout", request], { on: machine, timeout: 3000 });
    const doc = JSON.parse(r.stdout).result?.value;
    const tab = doc?.spaces?.flatMap(s => s.tabs ?? []).find(t => t.id === String(pane.tab).split("/").pop());
    return replacementDirection(tab?.root, String(pane.pane).split("/").pop()) ?? "down";
  } catch { return "down"; }
}
export async function companionMode(record, mode) {
  if (!record || (record.changing && Date.now() - record.changing < 5000)) return;
  const agent = boundAgent(record), old = panes().find(p => p.pane === record.pane);
  if (!old || (mode === "terminal" && !agent)) return;
  // A raw terminal must live in a terminal pane: terminal.show on a mod pane is accepted by Herdr,
  // but the mod keeps drawing. The temporary shell is only a display host, never another agent.
  if (mode === "terminal" && old.terminal) {
    if (focused()?.pane !== old.pane || focused()?.shown !== agent.address) run("terminal.show", { pane: old.pane, terminal: agent.address });
    return;
  }
  if (mode === "chat" && old.mod === "chat") {
    setShared(KEY, { ...companionRecords(), [record.id]: { ...record, mode, changing: null } }); return;
  }
  setShared(KEY, { ...companionRecords(), [record.id]: { ...record, changing: Date.now() } });
  let made = null;
  try {
    const direction = await directionFor(old);
    const out = await app("pane.split", { direction, pane: old.pane,
      ...(mode === "chat" ? { mod: "chat", props: { companion: record.id, terminal: agent?.address ?? record.terminal } } : {}) });
    made = out.pane;
    if (!made) throw new Error("Herdr didn't return the new pane.");
    setShared(KEY, { ...companionRecords(), [record.id]: { ...record, pane: made, mode, changing: null,
      pendingPane: old.pane, terminal: agent?.address ?? record.terminal } });
    await app("pane.focus", { pane: made });
    // LAST: this disposes the calling header and may abort this async continuation. The new
    // header attaches the terminal after pendingPane has disappeared; it owns that context.
    await app("pane.close", { pane: old.pane });
  } catch (error) {
    setShared(KEY, { ...companionRecords(), [record.id]: { ...record, changing: null } });
    if (made) await app("pane.close", { pane: made }).catch(() => {});
    throw error;
  }
}

// Only agents belonging to this space, including task workers labelled for the space.
// Program labels come from Herdr, so two accounts running the same CLI stay distinguishable.
export function besideChoices(pane, { includeSelf = false, spaceId = null } = {}) {
  const ps = panes(), at = ps.find(p => p.pane === pane);
  const space = spaces().find(s => spaceId ? s.id === spaceId : s.tabs.some(t => t.id === at?.tab));
  if (!space) return [];
  const tabs = new Set(space.tabs.map(t => t.id)), own = ps.filter(p => tabs.has(p.tab));
  const here = new Set(own.filter(p => p.terminal).map(p => p.terminal));
  const primary = new Map(own.filter(p => p.mod === "chat").map(p => [p.pane, p]));
  const record = companionFor(pane), self = boundAgent(record)?.address ??
    at?.terminal ?? terminals().find(k => chatPane(k) === pane)?.address;
  const all = terminals();
  const rows = all.filter(k => k.state === "live" && (k.program?.agent || ["codex", "claude", "claude-code"].includes(k.agent ?? k.report?.app)) && (includeSelf || k.address !== self))
    .filter(k => here.has(k.address) || primary.has(chatPane(k)) ||
      [k.labels?.["herdr.space"], k.labels?.["herdr.coordinator.space"], k.labels?.["herdr.task.space"]].includes(String(space.id).split("/").pop()) &&
      (k.address.includes("/") ? k.address.split("/")[0] : null) === (space.machine ?? null))
    .map(k => {
      const p = ps.find(p => p.terminal === k.address) ?? ps.find(p => p.pane === chatPane(k));
      const tab = space.tabs.find(t => t.id === p?.tab);
      const assistant = k.labels?.["herdr.role"] === "coordinator";
      return { id: k.address, terminal: k.address, pane: p?.pane, tab: p?.tab, label: assistant ? "Assistant" : tab?.name || k.program?.name || k.agent || k.address,
        detail: [shared("workspace.chat-targets")?.[p?.pane]?.account ?? k.program?.name ?? k.agent, k.address, k.cwd].filter(Boolean).join(" · "),
        origin: k.labels?.["herdr.chat.origin"] || k.address };
    });
  // An Assistant that hasn't received its first message can also be placed beside a regular agent.
  for (const [slot, s] of Object.entries(shared("coordinator.slots") ?? {})) {
    if (s.space !== space.id || (!includeSelf && (s.pane === pane || slot === record?.slot)) || !ps.some(p => p.pane === s.pane) || all.some(k => k.state === "live" && k.labels?.["herdr.chat.slot"] === slot)) continue;
    rows.unshift({ id: `slot:${slot}`, pane: s.pane, tab: s.tab, label: "Assistant", detail: "Starts on your first message", slot, space: s.space, folder: s.folder });
  }
  return rows;
}
async function app(command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)]);
  const out = JSON.parse(r.stdout || "{}");
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr || "The pane didn't open.");
  return out;
}
export async function openBeside(pane, choice) {
  const at = panes().find(p => p.pane === pane);
  if (!at) throw new Error("The destination pane has closed.");
  const terminal = choice.terminal;
  // Selecting an agent already beside this pane focuses it instead of adding a duplicate.
  const visible = panes().find(p => p.tab === at.tab && ((terminal && p.terminal === terminal) ||
    (terminal && chatPane(terminals().find(k => k.address === terminal)) === p.pane) ||
    (terminal && boundAgent(companionFor(p.pane))?.address === terminal)));
  if (visible) { run("pane.focus", { pane: visible.pane }); return visible.pane; }
  const id = `view-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const out = await app("pane.split", { pane, direction: "right", mod: "chat", props: {
    companion: id, ...(terminal ? { terminal } : { role: "coordinator", template: "assistant", slot: choice.slot, space: choice.space, folder: choice.folder }) } });
  if (!out.pane) throw new Error("Herdr didn't return the new pane.");
  const records = Object.fromEntries(Object.entries(companionRecords()).filter(([, r]) => panes().some(p => p.pane === r.pane)));
  setShared(KEY, { ...records, [id]: { pane: out.pane, tab: at.tab, terminal: terminal ?? null, origin: choice.origin ?? null, label: choice.label, slot: choice.slot ?? null, mode: "chat" } });
  run("pane.focus", { pane: out.pane });
  return out.pane;
}

// Pane headers can be recreated when their split is nested. The persistent tab bar owns
// structural swaps; a header only posts a request and never waits on its own replacement.
export function requestCompanionMode(record, mode) {
  setShared("workspace.viewreq", { id: record.id, mode, at: Date.now(), nonce: Math.random() });
}
export function watchCompanions(cx, onError) {
  let seen = shared("workspace.viewreq")?.nonce;
  cx.timer.every(150, (cx) => {
    const req = shared("workspace.viewreq");
    if (!req || req.nonce === seen) return;
    seen = req.nonce;
    if (Date.now() - req.at > 10000 || !["chat", "terminal"].includes(req.mode)) return;
    const record = companionRecords()[req.id];
    if (!record) return;
    cx.spawn(async (cx) => {
      try { await companionMode({ id: req.id, ...record }, req.mode); }
      catch (e) { onError(e); }
      cx.notify();
    });
  });
}
