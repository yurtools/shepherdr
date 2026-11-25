import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "./actions.ts";
import { forgetAll } from "./send-once.ts";

test("only the exact still-held chat message can be withdrawn; history receives nothing", async () => {
  const sent: string[] = [];
  const terminals = new Map([
    ["t55", { state: "live", status: { state: "working", app: "codex" } }],
    ["t56", { state: "live", status: { state: "working", app: "codex" } }],
  ]);
  const hub = { terminals, async send(_address: string, text: string) {
    sent.push(text); return { code: 0 };
  } } as any;
  const compat = { addrOf: (s: string) => ({ a: "t55", b: "t56" })[s], tasksFor: () => [] } as any;
  const request = { type: "send", chat: "a", text: "Misaddressed prompt", hold: true, cid: "shep55-held" };
  expect(await act(hub, request, compat)).toEqual({ ok: true, waiting: true, waitsFor: "turn" });
  await expect(act(hub, { type: "held-drop", chat: "b", cid: request.cid }, compat)).rejects.toThrow("no longer held");
  expect(await act(hub, { type: "held-drop", chat: "a", cid: request.cid }, compat)).toEqual({ ok: true, withdrawn: true });
  expect(await act(hub, { type: "held-drop", chat: "a", cid: request.cid }, compat)).toEqual({ ok: true, withdrawn: true });
  expect(await act(hub, request, compat)).toMatchObject({ withdrawn: true });
  forgetAll();
  expect(await act(hub, request, compat)).toMatchObject({ withdrawn: true });
  terminals.get("t55")!.status.state = "idle";
  await Bun.sleep(1200);
  expect(sent).toEqual([]);
});

test("native stale held row cannot resend or pretend an already claimed entry was withdrawn", () => {
  const source = readFileSync(new URL("../mods/chat/main.js", import.meta.url), "utf8");
  const start = source.indexOf("  takeQueued(msg) {");
  const method = source.slice(start, source.indexOf("\n  }", start) + 4);
  const notices: unknown[] = [];
  const C = new Function("toast", `return class {${method}}`)((n: unknown) => notices.push(n));
  const chat = new C(), mistaken = { id: "wrong" }, other = { id: "other" };
  chat.queue = [mistaken, other];
  expect(chat.takeQueued(mistaken)).toBe(true);
  expect(chat.queue).toEqual([other]);
  expect(chat.takeQueued(mistaken)).toBe(false);
  expect(chat.queue).toEqual([other]);
  expect(notices).toHaveLength(1);
});
