// What the agent runs on (agent, model, effort, speed, context), for the line under the
// message box, and restarting it with other choices. The log says what it really runs on
// (log.js `meta`); its arguments and settings fill in what the log doesn't say.
// Restarting reuses Herdr's own ways: `herdr-task switch` for a task's agent, else the
// coordinator's restart.sh. The same agent resumes its conversation; another gets a handoff.
// Either way the new agent starts parked behind this chat (core label herdr.chat).
// Shared: the source is lib/agent.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/agent.js, never a mod's copy, then run bin/sync-shared.

import { exec, hc, appHome } from "herdr";
// The rules (names, menus, argv) are core/agents.js, shared with the web app.
import { DEFAULTS, parseDefaults, profileLaunch } from "./core/agents.js";
import { chatLabel } from "./core/spaces.js";
export * from "./core/agents.js";

export async function defaults(kind, machine, opts = {}) {
  const r = await exec("sh", ["-c", DEFAULTS, "defaults", kind, opts.home ?? "", String(opts.pid ?? "")], { on: machine }).catch(() => null);
  if (opts.pid && (!r || r.code !== 0)) throw new Error("Cannot read this agent account. Try again once it is running.");
  return parseDefaults(kind, r?.stdout ?? "");
}

// Restarts the agent `t` (hc get's record) with `argv`, parked behind chat pane `pane`.
// Resolves with the new agent's address.
export async function restart(t, built, pane) {
  const task = t.labels?.["herdr.task"];
  if (task) {
    // herdr-task resumes its own session when the agent stays the same.
    const r = await exec("herdr-task", ["switch", task, "--folder", t.foreground?.cwd ?? t.cwd, "--argv", JSON.stringify(built.base), "--json"]);
    let out = {};
    try { out = JSON.parse(r.stdout || "{}"); } catch {}
    if (r.code !== 0 || !out.terminal) throw new Error((r.stderr || r.stdout).trim() || "herdr-task switch failed");
    const origin = t.labels?.["herdr.chat.origin"] || t.address;
    await hc(["label", out.terminal, `herdr.chat=${chatLabel(pane)}`, `herdr.chat.origin=${origin}`]);
    // It started in the tab: park it behind this chat, as the Chat switch does.
    await exec("herdr-app", ["do", "terminal.park", "--terminal", out.terminal]);
    return out.terminal;
  }
  const env = `HERDR_RESTART_CHAT="$1"${built.resume ? " HERDR_RESTART_RESUME=1" : ""}`;
  const r = await exec("sh", ["-c", `${env} bash "$2" "$3" "$4"`, "x", chatLabel(pane), `${appHome()}/mods/coordinator/restart.sh`, t.address, JSON.stringify(built.argv)]);
  const addr = r.stdout.trim().split("\n").pop();
  if (r.code !== 0 || !addr) throw new Error(r.stderr.trim() || "The agent didn't restart.");
  return addr;
}


// Profiles are machine-local. Only their IDs belong in synchronized role choices.
export async function profiles(machine = null) {
  const r = await exec("sh", ["-c", "f=\"${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/agent-profiles.json\"; if [ -f \"$f\" ]; then cat \"$f\"; else printf '{\"profiles\":[]}'; fi"], { on: machine });
  if (r.code !== 0) throw new Error("Cannot read agent profiles");
  const data = JSON.parse(r.stdout);
  return (data.profiles ?? []).filter((x) => typeof x.id === "string" && /^[\w-]+$/.test(x.id)
    && x.agent === "codex" && typeof x.home === "string" && x.home.startsWith("/") && !/[\0\r\n]/.test(x.home));
}
export async function profilePick(pick, machine = null) {
  if (!pick?.profile) return pick;
  return { ...pick, launch: profileLaunch(pick, await profiles(machine)) };
}
