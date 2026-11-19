import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execTemplate } from "./spaces.ts";

// #1051: a space's Assistant started from the web ran the stock template's `claude`, whatever Settings › Agents chose.
// A hub whose machine.exec runs here, with HOME a throwaway (its templates folder) and PATH only the CLIs given.
function machine(clis: string[]) {
  const home = mkdtempSync(join(tmpdir(), "shep-assistant-start-")), bin = join(home, "bin"), dir = join(home, ".config", "herdr-core", "templates");
  mkdirSync(bin); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "assistant.md"), "---\nname: assistant\ndescription: The Assistant\ncommand: claude\n---\nYou are the Assistant.\n");
  for (const c of clis) { writeFileSync(join(bin, c), "#!/bin/sh\n"); chmodSync(join(bin, c), 0o755); }
  const calls: any[] = [];
  const hub: any = {
    call: async (_: string, a: { argv: string[] }) => {
      calls.push(a);
      // hermetic: where agents install system-wide (core/clean-env.js AGENT_PATH) left out, this VM has them there
      if (a.argv[0] === "sh" && a.argv[2]?.includes("command -v")) {
        return { code: clis.includes(a.argv.at(-1)!) ? 0 : 1, stdout: "", stderr: "" };
      }
      const argv = a.argv.map((x) => x.replace(":/opt/homebrew/bin:/usr/local/bin", ""));
      const p = Bun.spawnSync(argv, { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } });
      const b64 = (x: Uint8Array) => Buffer.from(x).toString("base64");
      return { code: p.exitCode, stdout: b64(p.stdout), stderr: b64(p.stderr) };
    },
  };
  const made = () => readdirSync(dir).filter((f) => f !== "assistant.md").map((f) => readFileSync(join(dir, f), "utf8"));
  return { hub, made, home, calls };
}
const commandOf = (file: string) => /^command:(.*)$/m.exec(file)?.[1] ?? "";

test("the Assistant runs the agent its settings choose, with its model, effort and permissions", async () => {
  const { hub, made } = machine(["codex"]);
  const t = await execTemplate(hub, "assistant", null, { agent: "codex", model: "gpt-5.5", effort: "high", fast: false, perm: "full" });
  const [file] = made();
  expect(commandOf(file)).toContain("exec env -u CODEX_HOME");
  expect(commandOf(file)).toContain("codex --no-daemon -m gpt-5.5");
  expect(commandOf(file)).toContain("--dangerously-bypass-approvals-and-sandbox");
  expect(commandOf(file)).not.toMatch(/exec claude/);
  expect(t.words).toBe("You are the Assistant.");
});

test("no choice: the template's own command, as before", async () => {
  const { hub, made } = machine(["claude"]);
  await execTemplate(hub, "assistant", null, null);
  expect(commandOf(made()[0])).toMatch(/exec claude\s*$/);
});

test("the chosen agent missing there: the template's own; neither there: a plain refusal, never a dead start", async () => {
  const a = machine(["claude"]);
  await execTemplate(a.hub, "assistant", null, { agent: "codex", model: null, effort: null, fast: false, perm: "auto" });
  expect(commandOf(a.made()[0])).toMatch(/exec claude\s*$/);
  const b = machine([]);
  await expect(execTemplate(b.hub, "assistant", null, { agent: "codex", perm: "full" })).rejects.toThrow("Codex isn't installed on this computer");
  expect(b.made()).toEqual([]);
});

test('a web-started Assistant receives global instructions followed by the space addition without changing the global template',async()=>{
 const {hub,made}=machine(['claude']);const t=await execTemplate(hub,'assistant',null,null,'Space-only instruction with literal $(printf ignored)');
 const file=made()[0];expect(t.words).toContain('You are the Assistant.\n\n## Space-specific instructions\n\nSpace-only instruction');expect(file).toContain('literal $(printf ignored)');expect(file.indexOf('You are the Assistant.')).toBeLessThan(file.indexOf('Space-only instruction'));
});

test('remote account selection uses destination profile metadata and refuses missing CLI or deleted profiles', async () => {
  const m = machine(['codex']);
  const data = join(m.home, '.config/herdr-app/data'), account = join(m.home, 'destination account');
  mkdirSync(data, { recursive: true }); mkdirSync(account);
  writeFileSync(join(data, 'agent-profiles.json'), JSON.stringify({ profiles: [{ id: 'two', agent: 'codex', home: account }] }));
  await execTemplate(m.hub, 'assistant', 'destination', { agent: 'codex', profile: 'two', model: 'account-model' });
  expect(commandOf(m.made()[0])).toContain(`CODEX_HOME=${account}`);
  expect(m.calls.every(c => c.on === 'destination')).toBe(true);
  await expect(execTemplate(m.hub, 'assistant', 'destination', { agent: 'codex', profile: 'missing' })).rejects.toThrow('unavailable');
  writeFileSync(join(data, 'agent-profiles.json'), JSON.stringify({ profiles: [{ id: 'two', agent: 'codex', home: '/synthetic/deleted' }] }));
  await expect(execTemplate(m.hub, 'assistant', 'destination', { agent: 'codex', profile: 'two' })).rejects.toThrow('unavailable');
  const noCodex = machine(['claude']);
  await expect(execTemplate(noCodex.hub, 'assistant', 'destination', { agent: 'codex', profile: 'two' })).rejects.toThrow("isn't installed");
  expect(noCodex.made()).toEqual([]);
});
