import { describe, expect, test } from "bun:test";
import { runsCommand } from "./model";

// #1022: a worker that died mid-turn leaves its plain shell, and hc keeps "working" on it: the web app's Tasks
// list counted it as the task's agent, the task Working for good. A shell that runs its agent (fish -ic, #780) stays.
describe("a task's agents leave out a dead agent's shell (as herdr-task's runs_command)", () => {
  test("a plain shell runs no command", () => {
    expect(runsCommand(["/bin/bash", "-i"])).toBe(false);
    expect(runsCommand(["zsh"])).toBe(false);
    expect(runsCommand(["-bash", "-l"])).toBe(false);
  });
  test("a shell running the agent's launch command does", () => {
    expect(runsCommand(["/bin/bash", "-ic", "\"$@\"; exec \"$0\" -i", "/bin/bash", "codex"])).toBe(true);
    expect(runsCommand(["fish", "-ic", "claude go; exec fish -i"])).toBe(true);
    expect(runsCommand(["fish", "--command=claude"])).toBe(true);
  });
  test("its argv unknown: its status decides, as before", () => {
    expect(runsCommand(undefined)).toBe(true);
  });
});

test("usage rides the existing host task-list read, with same slug/PID-like terminal IDs on separate hosts", async () => {
  const { Model } = await import("./model.ts");
  const now = Date.now();
  const row = (id: string, on: string | null) => ({ address: on ? `${on}/${id}` : id, state: "live", labels: { "herdr.task": "repo#1", "herdr.role": "worker" }, status: { state: "working" }, created_ms: now - 1000 });
  const data = (cpu: number, rss: number) => [
    ["repo.json", { folder: "/same/repo", name: "repo", prefix: "T", tasks: [{ id: 1, state: "running", title: "Build" }, { id: 2, state: "queued", title: "Queued" }] }],
    [".task-usage.json", { "repo#1": { at: now, cpu_pct: cpu, rss_bytes: rss, workers: { t1: now - 1000 } }, "repo#2": { at: now, cpu_pct: 99, rss_bytes: 99, workers: { t1: now - 1000 } } }],
  ].map(([name, value]) => `${name}\n${JSON.stringify(value)}\n@@herdr-task-list@@\n`).join("");
  const hub = { terminals: new Map([["t1", row("t1", null)], ["remote/t1", row("t1", "remote")]]), async call(method: string, p: any) {
    if (method === "machine.exec") return { code: 0, stdout: Buffer.from(p.on === "remote" ? data(280, 800) : data(15, 120)).toString("base64"), stderr: "" };
    throw Error(method);
  } };
  const puts: Record<string, any> = {};
  const model: any = new Model(hub as any, { put: (k: string, v: any) => { puts[k] = v; } } as any);
  model.machines = ["remote"];
  await Promise.all([model.readLists(null), model.readLists("remote")]);
  model.build();
  expect(puts.tasks.filter((t: any) => t.id === 1).map((t: any) => [t.machine, t.usage.cpu_pct, t.usage.rss_bytes])).toEqual([[null, 15, 120], ["remote", 280, 800]]);
  expect(puts.tasks.filter((t: any) => t.id === 2).every((t: any) => t.usage === null)).toBe(true);
  hub.terminals.get("remote/t1")!.created_ms++;
  model.build();
  expect(puts.tasks.find((t: any) => t.machine === "remote" && t.id === 1).usage.state).toBe("unavailable");
  hub.terminals.delete("t1");
  model.build();
  expect(puts.tasks.find((t: any) => t.machine === null && t.id === 1).usage).toBeNull();
});
