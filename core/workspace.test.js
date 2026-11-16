import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { DEFAULTS, parseDefaults, launchPrefix, argvFor, resumeArgv, freshArgv, forkArgv } from "./agents.js";
import { parseCSV, delimiterFor, language, fileLocation, saveState } from "./documents.js";

test("account survives model restart, resume, fresh recovery and fork", () => {
  const old = { agent: "codex", argv: ["/opt/bin/codex", "--no-daemon"], home: "/tmp/profile with space", session: "SESSION" };
  const built = argvFor({ agent: "codex", model: "account-only-model", perm: "read-only" }, old);
  expect(built.argv.slice(0, 4)).toEqual(["env", "CODEX_HOME=/tmp/profile with space", "/opt/bin/codex", "resume"]);
  expect(built.argv).toContain("read-only");
  expect(resumeArgv("codex", built.argv, "NEXT").filter(x => x === "resume")).toHaveLength(1);
  for (const command of [built.base, freshArgv("codex", built.argv), resumeArgv("codex", built.argv, "NEXT"), forkArgv("codex", built.argv, "COPY")])
    expect(command.slice(0, 3)).toEqual(built.argv.slice(0, 3));
  expect(forkArgv("codex", built.argv, "COPY")[3]).toBe("fork");
});
test("changing backend drops Codex account flags", () => {
  const built = argvFor({ agent: "claude", model: "haiku" }, { agent: "codex", argv: ["env", "CODEX_HOME=/tmp/secondary", "codex"] });
  expect(built.argv[0]).toBe("claude"); expect(built.argv.some(x => x.startsWith("CODEX_HOME="))).toBe(false);
});
test("prefix drops launcher shell flags", () => {
  expect(launchPrefix("codex", ["sh", "-c", "exec ...", "launch", "env", "CODEX_HOME=/tmp/second", "codex", "-m", "x"]))
    .toEqual(["env", "CODEX_HOME=/tmp/second", "codex"]);
});
test("explicit profile preserves credential isolation", () => {
  const launch = ["env", "-u", "OPENAI_API_KEY", "CODEX_HOME=/tmp/secondary", "codex"];
  expect(argvFor({ agent: "codex", launch }, { agent: null, argv: [] }).argv.slice(0, launch.length)).toEqual(launch);
});
test("model and reasoning choices come from the assigned account", () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-profile-"));
  try {
    writeFileSync(join(dir, "config.toml"), 'model = "secondary-only"\nmodel_reasoning_effort = "xhigh"\n');
    writeFileSync(join(dir, "models_cache.json"), JSON.stringify({ models: [{ slug: "secondary-only", supported_reasoning_levels: [{ effort: "low" }, { effort: "xhigh" }] }] }));
    const r = spawnSync("sh", ["-c", DEFAULTS, "defaults", "codex", dir], { encoding: "utf8" });
    expect(r.status).toBe(0); expect(parseDefaults("codex", r.stdout)).toMatchObject({ home: dir, model: "secondary-only", effort: "xhigh", models: [{ id: "secondary-only", efforts: ["low", "xhigh"] }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
if (process.platform === "linux") test("running account wins over holder defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-process-"));
  const child = spawn("sleep", ["20"], { env: { ...process.env, CODEX_HOME: dir } });
  try {
    writeFileSync(join(dir, "config.toml"), 'model = "process-account"\n');
    const r = spawnSync("sh", ["-c", DEFAULTS, "defaults", "codex", "/tmp/wrong", String(child.pid)], { encoding: "utf8" });
    expect(r.status).toBe(0); expect(parseDefaults("codex", r.stdout)).toMatchObject({ home: dir, model: "process-account" });
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});
test("Files follows the space independently of focused panes", () => {
  expect(fileLocation({ id: "one", folder: "/project/one" })).toEqual({ space: "one", cwd: "/project/one", on: null });
  expect(fileLocation({ id: "two", folder: "/tmp/default", machine: "remote" }, { two: "/project/two" })).toEqual({ space: "two", cwd: "/project/two", on: "remote" });
});
test("CSV preserves quoted commas, multiline fields, escaped quotes and CRLF", () => {
  expect(parseCSV('name,note\r\nA,"one,two"\r\nB,"line 1\nline 2"\r\nC,"a ""quote"""\r\n').rows)
    .toEqual([["name", "note"], ["A", "one,two"], ["B", "line 1\nline 2"], ["C", 'a "quote"']]);
  expect(parseCSV('a,b,').rows).toEqual([["a", "b", ""]]); expect(parseCSV('\uFEFFa,b\n').rows).toEqual([["a", "b"]]);
});
test("CSV chooses delimiters, bounds output and detects malformed quotes", () => {
  expect(delimiterFor('a;"b,c"\n1;2')).toBe(';'); expect(delimiterFor('a\tb', 'data.tsv')).toBe('\t');
  expect(parseCSV('a,b,c\n1,2,3\n4,5,6', ',', 2, 2)).toMatchObject({ rows: [["a", "b"], ["1", "2"]], limited: true });
  expect(parseCSV('a,"missing')).toMatchObject({ error: 'Unclosed quoted field' });
});
test("source grammars cover target project files", () => {
  expect(['a.java', 'a.sh', 'chart/templates/deployment.yaml', '_helpers.tpl', 'README.md'].map(language)).toEqual(['java', 'bash', 'yaml', 'gotmpl', 'markdown']);
});
test("external changes reload clean views and retain dirty drafts", () => {
  expect(saveState({ saved: 'old', text: 'old' }, 'disk')).toBe('reload');
  expect(saveState({ saved: 'old', text: 'draft' }, 'disk')).toBe('conflict');
  expect(saveState({ saved: 'old', text: 'draft' }, 'old')).toBe('dirty');
});

test("single-quoted TOML model settings produce a model ID without quote characters", () => {
  expect(parseDefaults("codex", "model\t'gpt-account-model'\nmodel_reasoning_effort\t'xhigh'\n")).toMatchObject({ model: "gpt-account-model", effort: "xhigh" });
});
