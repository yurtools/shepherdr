// The same recorded log items / task transitions through native newsPlan and
// the actual web service adapter, including updates with no new agent turn.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Conversation } from "../core/chat-log.js";
import * as CV from "../core/chat-view.js";
import { Compat } from "./compat.ts";

const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
const method = (name: string) => {
  const at = source.indexOf(`  ${name}(`);
  return source.slice(at, source.indexOf("\n  }", at) + 4);
};
const Native = new Function(...Object.keys(CV), `return class { ${method("*newsPlan")} ${method("taskSig")} }`)(...Object.values(CV));
const ms = (s: string) => Date.parse(s);
const started = ms("2024-12-31T23:55:00Z"), needs = ms("2025-01-01T05:15:00Z"),
  ready = ms("2025-01-01T14:35:00Z"), readyAgain = ms("2025-01-02T15:40:00Z"),
  done = ms("2025-01-03T17:50:00Z");
const base = { id: 7, ref: "DEMO-7", title: "Fix login", space: "fixture", machine: null, folder: "/fixture", started, section: "needs", feature: "feature-one" };
const other = { ...base, id: 8, ref: "DEMO-8", title: "Other feature", feature: "feature-two", section: "working" };
const log = (kind: "codex" | "claude", lines: [string, number?][]) => {
  const c = new Conversation(kind);
  lines.forEach(([text, at], i) => {
    const timestamp = at === undefined ? undefined : new Date(at).toISOString();
    if (kind === "codex") c.codex({ type: "response_item", timestamp, payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } }, i * 100);
    else c.claude({ type: "user", timestamp, uuid: String(i), message: { role: "user", content: text } }, i * 100);
  });
  return c;
};
const tag = (event: string, text: string, folder?: string) => `<herdr-news task="DEMO-7" event="${event}"${folder ? ` folder="${folder}"` : ""}>DEMO-7 ${text}</herdr-news>`;
const native = (feature: string | null = "feature-one") => Object.assign(new Native(), {
  assistant: () => "fixture", start: 0, feature, spaceTasks: [], wasks: [], accepting: new Set(),
});
const nativeRows = (host: any, rows: any[], items: any[]) => {
  host.spaceTasks = rows.map(r => ({ ...r, status: r.section }));
  const plan = host.newsPlan(items);
  let step;
  do { step = plan.next(); } while (!step.done);
  return [...step.value.extra.map((e: any) => e.row), ...step.value.inline.values()];
};
const featureLabels = { "herdr.role": "feature", "herdr.feature": "feature-one", "herdr.coordinator.space": "fixture" };
const web = (rows: any[], conv: any, key = "t:fixture-terminal", labels: Record<string, string> = featureLabels, machine: string | null = null, start = 0) => {
  const compat: any = new Compat();
  compat.rows = rows;
  compat.spaceList = [
    { id: "fixture", machine: null }, { id: "another-space", machine: null },
    { id: "remote-fixture/fixture", machine: "remote-fixture" }, { id: "remote-fixture/another-space", machine: "remote-fixture" },
  ];
  compat.firstTask = () => null;
  return compat.chat(key, { conv, start, machine, addr: "fixture-terminal", kind: conv.kind }, { state: "live", labels }).messages.filter((m: any) => m.news);
};
const simplify = (rows: any[], isWeb = false) => rows.map(r => ({
  id: r.id, at: CV.recordedNewsAt(r.at), mark: r.news?.mark ?? r.mark,
  live: !!(isWeb ? r.news.live : r.live), accept: !!(isWeb ? r.news.accept : r.accept),
})).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

for (const kind of ["codex", "claude"] as const) test(`${kind}: native and web keep event dates, order, dedup and Review across task updates`, () => {
  const conv = log(kind, [[tag("needs-you", "needs you: A question (Fix login)"), needs]]);
  const host = native();
  const both = (row: any) => {
    const rows = [row, other];
    const n = nativeRows(host, rows, conv.items);
    const w = web(rows, conv);
    expect(simplify(n)).toEqual(simplify(w, true));
    return w;
  };
  const waiting = both(base);
  expect(waiting.map((r: any) => [r.news.mark, r.at, !!r.news.live])).toEqual([["started", started, false], ["needs", needs, true]]);
  // Two logged Ready events: a later transition record must not rewrite
  // either, including after Done. Only the newest can carry Review.
  const history = log(kind, [[tag("ready", "is ready: Fix login · First result"), ready], [tag("ready", "is ready: Fix login · Second result"), readyAgain]]);
  conv.items.push(...history.items.map((r: any, i: number) => ({ ...r, id: `ready-${i}` })));
  const reviewing = both({ ...base, ready_at: readyAgain + 60_000, section: "ready" });
  expect(reviewing.map((r: any) => [r.news.mark, r.at, !!r.news.accept])).toEqual([
    ["started", started, false], ["needs", needs, false], ["ready", ready, false], ["ready", readyAgain, true],
  ]);
  const finished = both({ ...base, started, ready_at: done - 1000, done_at: done, section: "done" });
  expect(finished.map((r: any) => [r.news.mark, r.at, !!r.news.accept])).toEqual([
    ["started", started, false], ["needs", needs, false], ["ready", ready, false], ["ready", readyAgain, false], ["done", done, false],
  ]);
  expect(finished.slice(0, -1).map((r: any) => r.id)).toEqual(reviewing.map((r: any) => r.id));
});

test("restored unknown dates stay unknown; no fake transition or duplicate for a missing logged date", () => {
  const conv = log("codex", [[tag("ready", "is ready: Fix login · Old result")], [tag("done", "is done (Fix login)"), done]]);
  const rows = [{ ...base, started: 0, ready_at: readyAgain, done_at: done, section: "done" }];
  const n = nativeRows(native(), rows, conv.items), w = web(rows, conv);
  expect(simplify(n)).toEqual(simplify(w, true));
  expect(w.map((r: any) => [r.news.mark, r.at])).toEqual([["ready", undefined], ["done", done]]);
  expect(CV.newsDateTime(w[0].at).label).toBe("Date/time not recorded");
});

test("task record events missing from the log appear only at their recorded times, not on a later page", () => {
  const conv = log("codex", [["A newer conversation", ready + 1000]]);
  const rows = [{ ...base, ready_at: ready, done_at: done, section: "done" }];
  const h = native(); h.start = 500;
  expect(simplify(nativeRows(h, rows, conv.items))).toEqual(simplify(web(rows, conv, "t:fixture-terminal", featureLabels, null, 500), true));
  expect(web(rows, conv, "t:fixture-terminal", featureLabels, null, 500).map((r: any) => r.at)).toEqual([done]);
  h.start = 0;
  expect(nativeRows(h, rows, conv.items).map((r: any) => r.at)).toEqual([started, ready, done]);
  expect(web(rows, conv).map((r: any) => r.at)).toEqual([started, ready, done]);
  const before = h.taskSig();
  nativeRows(h, [{ ...rows[0], started: started + 1000 }], conv.items);
  expect(h.taskSig()).not.toBe(before);
});

test("Feature chats use the recorded feature, machine and space; ordinary workers have no news or Review", () => {
  const conv = log("codex", [[tag("ready", "is ready: Fix login"), ready]]);
  const owned = { ...base, section: "ready", ready_at: ready, duplicate: true };
  const unrelated = { ...owned, folder: "/other", feature: "feature-two" };
  const rows = [unrelated, owned, other, { ...owned, space: "another-space", ref: "DEMO-9" }];
  const news = web(rows, conv);
  expect(news.map((r: any) => r.news.task)).toEqual(["%2Ffixture:DEMO-7", "%2Ffixture:DEMO-7"]);
  expect(news[1].news.accept).toBe(true);
  expect(nativeRows(native(), rows, conv.items).every((r: any) => r.folder === "/fixture")).toBe(true);
  expect(web(rows, conv, "DEMO-7/worker", { ...featureLabels, "herdr.task": "task#7" })).toEqual([]);
  expect(web(rows, conv, "t:ordinary", {})).toEqual([]);
  // A remote Feature's labels are bare space IDs; never claim local rows.
  const remote = rows.map(r => ({ ...r, machine: "remote-fixture", space: `remote-fixture/${r.space}` }));
  expect(web([...rows, ...remote], conv, "t:remote-fixture/terminal", featureLabels, "remote-fixture").map((r: any) => r.news.task))
    .toEqual(["remote-fixture:%2Ffixture:DEMO-7", "remote-fixture:%2Ffixture:DEMO-7"]);
  // The space Assistant retains its aggregate news, as before.
  expect(web([owned, other], conv, "p:fixture", {}).some((r: any) => r.news.ref === "DEMO-8")).toBe(true);
});

test("folder-qualified twins retain their own event dates; ambiguous old news cannot review either", () => {
  const conv = log("codex", [
    [tag("ready", "is ready: Old result"), ready - 1000],
    [tag("ready", "is ready: Fix login", "/fixture"), ready],
  ]);
  const a = { ...base, duplicate: true, section: "ready", ready_at: ready + 60_000 };
  const b = { ...a, title: "Other result", folder: "/twin", ready_at: readyAgain };
  const rows = [a, b];
  const h = native();
  const n = nativeRows(h, rows, conv.items), w = web(rows, conv);
  expect(simplify(n)).toEqual(simplify(w, true));
  const readyRows = w.filter((r: any) => r.news.mark === "ready");
  expect(readyRows.map((r: any) => [r.news.task, r.at, !!r.news.accept])).toEqual([
    ["", ready - 1000, false], ["%2Ffixture:DEMO-7", ready, true], ["%2Ftwin:DEMO-7", readyAgain, true],
  ]);
  expect(n.find((r: any) => r.id === conv.items[0].id).task).toBeNull();
  expect(n.find((r: any) => r.id === conv.items[1].id).folder).toBe("/fixture");
  const finished = web([{ ...a, section: "done", done_at: done, ready_at: done - 1000 }, b], conv);
  expect(finished.filter((r: any) => r.news.mark === "ready").map((r: any) => [r.id, r.at, !!r.news.accept])).toEqual(
    readyRows.map((r: any) => [r.id, r.at, r.news.task === "%2Ftwin:DEMO-7"]),
  );
});
