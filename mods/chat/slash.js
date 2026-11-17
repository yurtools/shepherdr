// Slash commands for the "/" list above the message box. Whatever the person types goes to
// the agent as typed; this only suggests. A command that opens a menu in the CLI (no
// arguments given) needs the terminal, so the chat switches to it after sending.

import { exec, appHome } from "herdr";

// The lists and the scan are core/slash.js, shared with the web app.
import { SCAN, scanned, commandList } from "./core/slash.js";
export { opensMenu, typing, match } from "./core/slash.js";

const cache = new Map();
// Every command this agent knows: [{ name, about }], built-in first. Cached per machine and folder.
export async function commands(kind, machine, cwd) {
  if (kind !== "claude") return commandList(kind);
  const k = `${machine ?? ""}|${cwd ?? ""}`;
  if (!cache.has(k)) cache.set(k, exec("sh", ["-c", SCAN, "scan", cwd ?? ""], { on: machine }).then((r) => scanned(r.stdout)).catch(() => []));
  return commandList(kind, await cache.get(k));
}

export async function skills(machine,cwd,home) {
 if(machine) return []; // Remote helper is not assumed to be installed.
 const r=await exec('python3',[`${appHome()}/mods/chat/bin/herdr-skills`,cwd??'',home??''],{timeout:10000});
 if(r.code)throw new Error(r.stderr||'Skills could not be read.');return JSON.parse(r.stdout);
}
export function skillSuggestions(text,skills) {
 const m=/(?:^|\s)\$([\w:.-]*)$/.exec(text);if(!m)return null;
 return match(skills,m[1]).map(s=>({...s,skill:true,key:`skill-${s.name}`}));
}
