// Loopback-only synthetic task news fixture; the branch's real service adapter
// converts sample CLI records into real web chat rows. No live core, store,
// logs, or actions. Use: bun test/fixtures/chat-news-web.ts web/dist
import "../preload.ts";
import { join } from "node:path";
import { Compat } from "../../service/compat.ts";
import { Conversation } from "../../core/chat-log.js";

const dist = process.argv[2], port = Number(process.argv[3] ?? 19566);
const compat: any = new Compat();
const space = "fixture", mainKey = "p:fixture", featKey = "t:fixture-feature";
const main = { state: "live", address: "fixture-assistant", status: { app: "codex", state: "idle" }, labels: { "herdr.role": "coordinator", "herdr.coordinator.space": space } };
const feature = { state: "live", address: "fixture-feature", status: { app: "codex", state: "idle" }, labels: { "herdr.role": "feature", "herdr.feature": "fixture-feature-id", "herdr.coordinator.space": space } };
compat.terminalsOf = (addr: string) => [main, feature].find(t => t.address === addr);
compat.firstTask = () => null;

const at = (s: string) => Date.parse(s);
const times = { started: at("2024-12-31T23:55:00Z"), needs: at("2025-01-01T05:15:00Z"),
  ready: at("2025-01-01T14:35:00Z"), done: at("2025-01-02T17:50:00Z"), feat: at("2026-11-01T06:30:00Z") };
const task = (id: number, title: string, section: string, extra: Record<string, any> = {}) => ({
  key: `demo#${id}`, id, slug: "demo", ref: `DEMO-${id}`, title, folder: "/fixture", worktree: "/fixture", space,
  machine: null, section, feature: null, list: "Example tasks", ...extra,
});
const rows = [
  task(60, "Prepare the sample release", "ready", { started: times.started, ready_at: times.ready, summary: "The preview is ready to check; this deliberately long message must not hide the date or Review button." }),
  task(61, "Pick an option", "needs", { started: 0 }),
  task(62, "Archive an old sample", "done", { done_at: times.done }),
  task(70, "Check the Feature preview", "ready", { started: times.feat - 3600000, ready_at: times.feat, feature: "fixture-feature-id", summary: "Feature-only result ready to review." }),
];
const snapshot = () => compat.snapshot({
  host: "fixture", user: "You", machines: [{ name: "fixture", here: true, state: "connected" }],
  spaces: [{ id: space, name: "Lifecycle fixture", folder: "/fixture", assistant: main.address, machine: null,
    tabs: [{ id: "main-tab", name: "Assistant", terminals: [main.address] }, { id: "feature-tab", name: "Delivery feature", terminals: [feature.address] }] }],
  rows, sections: [], artifacts: [],
});
const log = (lines: [string, number?][]) => {
  const c = new Conversation("codex");
  lines.forEach(([text, stamp], i) => c.codex({ type: "response_item", timestamp: stamp === undefined ? undefined : new Date(stamp).toISOString(),
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } }, i * 100));
  return c;
};
const tag = (ref: string, event: string, text: string) => `<herdr-news task="${ref}" event="${event}">${ref} ${text}</herdr-news>`;
const conv = log([
  [tag("DEMO-61", "needs-you", "needs you: An old question without a date (Pick an option)")],
  [tag("DEMO-60", "needs-you", "needs you: Which sample should we use? (Prepare the sample release)"), times.needs],
  [tag("DEMO-60", "ready", "is ready: Prepare the sample release · " + rows[0].summary), times.ready],
]);
const featConv = log([[tag("DEMO-70", "ready", "is ready: Check the Feature preview · Feature-only result ready to review."), times.feat]]);
const chat = (key: string) => {
  const isFeat = key === featKey, terminal = isFeat ? feature : main;
  return compat.chat(key, { conv: isFeat ? featConv : conv, machine: null, start: 0, addr: terminal.address, kind: "codex", historyKey: key }, terminal);
};
const sockets = new Set<any>();
const send = (ws: any, obj: unknown) => ws.send(JSON.stringify(obj));
const push = () => {
  const snap = snapshot();
  for (const ws of sockets) {
    send(ws, { type: "snapshot", snapshot: snap });
    for (const key of [mainKey, featKey]) send(ws, { type: "chat", chat: chat(key) });
  }
};
Bun.serve({ hostname: "127.0.0.1", port, async fetch(req, server) {
  const path = new URL(req.url).pathname;
  if (path === "/api/ws") return server.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
  if (path === "/fixture/done" && req.method === "POST") {
    rows[0] = { ...rows[0], section: "done", ready_at: times.ready + 60000, done_at: times.done + 3_600_000 };
    push();
    return new Response("fixture updated; unchanged conversation");
  }
  if (path === "/api/action" && req.method === "POST") {
    const reqBody = await req.json() as { type: string; task?: string };
    if (reqBody.type === "evidence") {
      const row = rows.find(r => r.ref === reqBody.task);
      if (row) return Response.json({ ref: row.ref, title: row.title, status: row.section, state: row.section, evidence: { git: false, merges: false } });
    }
    // Acknowledgements are inert; never accept, send, or run an action.
    return Response.json({ ok: true });
  }
  if (path.startsWith("/api/")) return new Response("not in fixture", { status: 404 });
  const file = Bun.file(join(dist, path === "/" ? "index.html" : path));
  return await file.exists() ? new Response(file) : new Response(Bun.file(join(dist, "index.html")));
}, websocket: {
  open(ws) { sockets.add(ws); send(ws, { type: "snapshot", snapshot: snapshot() }); },
  message(ws, raw) {
    const m = JSON.parse(String(raw));
    if (m.type === "watch") for (const key of [mainKey, featKey]) send(ws, { type: "chat", chat: chat(key) });
    if (m.type === "ping") send(ws, { type: "pong" });
  },
  close(ws) { sockets.delete(ws); },
}});
console.log(`Synthetic task news fixture listening on 127.0.0.1:${port}`);
