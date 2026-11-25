import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "./actions.ts";
import { LOG, records, discardableTurn } from "../core/chat-log.js";

const id = "00000000-0000-0000-0000-000000000055";

test("discard preparation verifies the exact latest turn and idle same PID, without sending any keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-discard-"));
  const path = join(dir, "rollout-" + id + ".jsonl"), fake = join(dir, "hc"), state = join(dir, "terminal.json");
  const was = process.env.SHEPHERDR_HC;
  const line = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + "\n";
  const prompt = (turn: string, id: string, text: string) => line("event_msg", { type: "task_started", turn_id: turn }) +
    line("response_item", { type: "message", role: "user", id, content: [{ type: "input_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: ["user.text"] } }) +
    line("event_msg", { type: "task_complete", turn_id: turn });
  const raw = line("session_meta", { id, history_mode: "paginated", source: "cli" }) +
    prompt("turn1", "first", "same text") + prompt("turn2", "mistake", "same text");
  const terminal = { state: "live", status: { state: "idle", app: "codex" }, foreground: { pid: 4242, name: "codex" } };
  const writeState = () => writeFileSync(state, JSON.stringify(terminal));
  writeState();
  writeFileSync(path, raw);
  writeFileSync(fake, `#!/bin/sh\n[ "$1" = get ] || exit 77\ncat "${state}"\n`, { mode: 0o755 });
  process.env.SHEPHERDR_HC = fake;
  try {
    const read = () => Bun.spawnSync(["sh", "-c", LOG, "log", "page", path, "999999999999999", "200"]).stdout.toString();
    const selected = discardableTurn(records(read()).records, id)!;
    let activePath = path, address = "t55", historyMode = "paginated";
    const calls: string[] = [];
    const hub = { call: async (_method: string, params: any) => {
      const argv = params.argv as string[];
      calls.push(argv[3]);
      const out = argv[3] === "chat" ? activePath + "\n" : read();
      return { code: 0, stdout: Buffer.from(out).toString("base64"), stderr: "" };
    }, terminals: new Map() } as any;
    const compat = { addrOf: () => address, reader: () => ({ kind: "codex", pid: 4242, path, historyMode, records: records(read()).records }) } as any;
    const request = { type: "discard-latest", chat: "a", message: selected.id, token: selected.token };
    expect(await act(hub, request, compat)).toEqual({ ok: true, terminal: true });
    expect(calls).toEqual(["chat", "log"]);
    historyMode = "legacy";
    await expect(act(hub, request, compat)).rejects.toThrow("history format");
    historyMode = "paginated";
    await expect(act(hub, { ...request, token: "wrong" }, compat)).rejects.toThrow("no longer the latest");
    terminal.status.state = "working"; writeState();
    await expect(act(hub, request, compat)).rejects.toThrow("idle");
    terminal.status.state = "idle"; writeState();
    activePath = path + ".other";
    await expect(act(hub, request, compat)).rejects.toThrow("active session changed");
    activePath = path;
    writeFileSync(path, raw + prompt("turn3", "new", "same text"));
    await expect(act(hub, request, compat)).rejects.toThrow("no longer the latest");
  } finally {
    if (was === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = was;
    rmSync(dir, { recursive: true, force: true });
  }
});
