import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG, Conversation, records, resultText, discardableTurn } from "./chat-log.js";
import { ChatReader } from "./chat-reader.js";
import { sessionOf } from "./agents.js";

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const at = "2026-11-25T00:00:00Z";
const line = (ordinal, type, payload) => JSON.stringify({ timestamp: at, ordinal, type, payload }) + "\n";
const meta = (ordinal, thread, base) => line(ordinal, "session_meta", { id: thread, source: "cli", history_mode: "paginated", ...(base ? { history_base: base } : {}) });
const msg = (ordinal, role, text) => line(ordinal, "response_item", { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
const cut = (thread_id, data, end_ordinal_exclusive) => ({ thread_id, end_byte_offset: Buffer.byteLength(data), end_ordinal_exclusive });
const rows = c => c.items.filter(i => i.kind === "user" || i.kind === "agent").map(i => [i.kind, i.text]);
const run = (mode, file, ...args) => {
  const p = Bun.spawnSync(["sh", "-c", LOG, "log", mode, file, ...args.map(String)]);
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
};

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "shep-history-"));
  const dir = join(root, "sessions", "2026", "11", "25");
  mkdirSync(dir, { recursive: true });
  const file = generation => join(dir, `rollout-2026-11-25T00-00-00-${id(1)}${generation ? "_" + id(generation) : ""}.jsonl`);
  const earlier = meta(0, id(1)) + msg(1, "user", "Earlier café") +
    line(2, "response_item", { type: "function_call", name: "shell_command", call_id: "keep-call", arguments: '{"command":"printf fixture"}' }) +
    line(3, "response_item", { type: "function_call_output", call_id: "keep-call", output: "retained result" }) +
    msg(4, "assistant", "Earlier answer");
  const first = earlier + msg(5, "user", "Mistaken prompt") + msg(6, "assistant", "Mistaken reply");
  const replacement = meta(5, id(1), cut(id(1), earlier, 5)) + msg(6, "user", "Retained continuation") + msg(7, "assistant", "Retained answer");
  const second = replacement + msg(8, "user", "Second mistake");
  const third = meta(8, id(1), cut(id(2), replacement, 8)) + msg(9, "user", "New continuation");
  writeFileSync(file(0), first); writeFileSync(file(2), second); writeFileSync(file(3), third);
  try { return fn({ root, file, first, second, third, earlier, replacement }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("the current generation reads exactly its inherited prefixes, not either discarded suffix", () => fixture(({ file, first, second, third }) => {
  const r = run("page", file(3), 999999999999999, 200);
  expect(r.code).toBe(0);
  const page = records(r.stdout), conv = new Conversation("codex");
  conv.feed(page.records);
  expect(rows(conv)).toEqual([
    ["user", "Earlier café"], ["agent", "Earlier answer"],
    ["user", "Retained continuation"], ["agent", "Retained answer"],
    ["user", "New continuation"],
  ]);
  const step = conv.items.find(i => i.kind === "tools").steps[0];
  const result = run("results", file(3), step.out);
  expect(result.code).toBe(0);
  const raw = result.stdout.split("\x1e")[1].split("\n")[1];
  expect(resultText(raw, step.id)).toBe("retained result");

  const end = Number(page.head[2]);
  appendFileSync(file(3), msg(10, "assistant", "New reply"));
  const tail = run("tail", file(3), end);
  expect(tail.code).toBe(0);
  conv.feed(records(tail.stdout).records);
  expect(rows(conv).at(-1)).toEqual(["agent", "New reply"]);
  expect(readFileSync(file(0), "utf8")).toBe(first);
  expect(readFileSync(file(2), "utf8")).toBe(second);
  expect(readFileSync(file(3), "utf8")).toBe(third + msg(10, "assistant", "New reply"));
  expect(sessionOf("codex", file(3))).toBe(id(1));
}));

test("a missing or invalid parent cannot silently display a partial replacement history", () => fixture(({ file, replacement }) => {
  rmSync(file(2));
  const missing = run("page", file(3), 999999999999999, 200);
  expect(missing.code).not.toBe(0);
  expect(missing.stdout.trim()).toBe("lineage");
  writeFileSync(file(2), replacement);
  writeFileSync(file(3), meta(8, id(1), { ...cut(id(2), replacement, 8), end_byte_offset: 7 }) + msg(9, "user", "New continuation"));
  const invalid = run("page", file(3), 999999999999999, 200);
  expect(invalid.code).not.toBe(0);
  expect(invalid.stdout.trim()).toBe("lineage");
}));

test("same-PID provider revert makes the web reader re-resolve the active rollout", async () => {
  const paths = ["/rollout-old.jsonl", "/rollout-new.jsonl"];
  let generation = 0, lookups = 0;
  const io = { sh: async (_script, args) => {
    if (args[0] === "chat") { lookups++; return { code: 0, stdout: paths[generation] }; }
    throw Error("unexpected log read");
  }};
  const reader = new ChatReader(io, "t1");
  const terminal = { status: { app: "codex" }, foreground: { pid: 123 } };
  expect(await reader.locate(terminal)).toBe(true);
  expect(reader.path).toBe(paths[0]);
  generation = 1;
  expect(await reader.locate(terminal)).toBe(false);
  reader.locatedAt = 0;
  expect(await reader.locate(terminal)).toBe(true);
  expect(reader.path).toBe(paths[1]);
  expect(lookups).toBe(2);
});

const event = (off, payload) => ({ off, kind: "J", data: JSON.stringify({ type: "event_msg", payload }) });
const user = (off, turn, id, text, kind = "user.text") => ({ off, kind: "J", data: JSON.stringify({
  type: "response_item", payload: { type: "message", role: "user", id, content: [{ type: "input_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: [kind] } }
}) });
const started = (off, turn) => event(off, { type: "task_started", turn_id: turn });
const ended = (off, turn, type = "task_complete") => event(off, { type, turn_id: turn });

test("discard identity is the exact sole latest turn prompt, not equal text or a reused offset", () => {
  const first = [started(10, "turn1"), user(20, "turn1", "message1", "same words"), ended(30, "turn1")];
  const latest = [started(40, "turn2"), user(50, "turn2", "env", "<environment_context>…", "environments.environment_context"),
    user(60, "turn2", "message2", "same words"), ended(80, "turn2", "turn_aborted")];
  expect(discardableTurn([...first, ...latest], id(1))).toEqual({ id: "u60", token: id(1) + ":turn2:message2", closed: true });
  expect(discardableTurn([...first, ...latest.slice(0, -1)], id(1)).closed).toBe(false);
  expect(discardableTurn([...first, ...latest.slice(0, -1), user(75, "turn2", "steer", "another prompt"), latest.at(-1)], id(1))).toBeNull();
  expect(discardableTurn([...first, ...latest.slice(1)], id(1))).toBeNull();
  expect(discardableTurn([...first, ...latest, started(90, "turn3"), ended(100, "turn3")], id(1))).toBeNull();
  expect(discardableTurn([started(40, "turn2"), user(60, "turn2", "message2", "/model")], id(1))).toBeNull();
});
