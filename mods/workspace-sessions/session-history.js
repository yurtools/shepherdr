import { workspaceCall } from "./workspace-store.js";
// Local saved Codex sessions. The tab bar owns launch/structural work; dialogs may close at once.
import { appHome, exec, hc, run, shared, setShared, openOverlay, focused } from "herdr";
import { panes, spaces, terminals } from "./live.js";
import { chatPane } from "./core/spaces.js";
import { resumeArgv, launchPrefix, sessionOf } from "./core/agents.js";
import { openBeside } from "./companions.js";

const helper = () => `${appHome()}/mods/workspace-sessions/bin/herdr-sessions`;
export function historyScope(space) {
  if (!space || space.machine || space.id.includes("/")) throw new Error("Session history is currently available on this computer.");
  return { space: space.id, folder: shared("workspace.roots")?.[space.id] || space.folder };
}
export async function historyRead(command, scope, key = null) {
  const r = await exec("python3", [helper(), command, "--space", scope.space, "--folder", scope.folder ?? "", ...(key ? ["--key", key] : [])], { timeout: 20000 });
  let out = {}; try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr || "Couldn't read session history.");
  return out;
}
export function openHistory(space = spaces().find(s => s.active), selected = null) {
  openOverlay({ mod: "workspace-sessions", kind: "dialog", frame: "none", width: 1080, height: 0.86,
    props: { space: space?.id, pane: focused()?.pane, selected } });
}
export function requestSession(scope, key, beside = null) {
  setShared("sessions.openreq", { ...scope, key, beside, at: Date.now(), nonce: Math.random() });
}

// Saved argv keeps CLI options; folder-history entries restore the model, reasoning and basic
// permission policy recorded by Codex. Every launch explicitly retains the owning account home.
export function sessionArgv(row) {
  if (!row.home?.startsWith("/") || !/^[0-9a-fA-F-]{36}$/.test(row.session)) throw new Error("This session has no valid account or session ID.");
  const old = Array.isArray(row.argv) ? row.argv : [];
  let base = old.some(a => /(^|\/)codex$/.test(a)) ? old : ["codex", "--no-daemon"];
  if (base !== old) {
    if (row.model) base.push("--model", row.model);
    if (row.effort) base.push("-c", `model_reasoning_effort=${JSON.stringify(row.effort)}`);
    const sandbox = ["read-only", "workspace-write", "danger-full-access"].includes(row.sandbox) ? row.sandbox : "workspace-write";
    const approval = ["untrusted", "on-failure", "on-request", "never"].includes(row.approval) ? row.approval : "on-request";
    base.push("--sandbox", sandbox, "--ask-for-approval", approval);
  }
  const resumed = resumeArgv("codex", base, row.session);
  const at = resumed.findIndex(a => /(^|\/)codex$/.test(a));
  return [...launchPrefix("codex", resumed, row.home), ...resumed.slice(at + 1)];
}
async function app(command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)]);
  let out = {}; try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr || "Herdr didn't finish opening the session.");
  return out;
}
export async function openSavedSession(req) {
  const space = spaces().find(s => s.id === req.space);
  const scope = historyScope(space);
  const result = await historyRead("get", scope, req.key);
  if (result.liveVerified === false) throw new Error("Cannot check running sessions. Try again once herdr-core is connected.");
  const row = result.session;
  if (row.feature) { const { openFeature } = await import("./features.js"); return openFeature(await workspaceCall("feature-get", {id:row.feature})); }
  if (row.terminal) {
    if (req.beside) return openBeside(req.beside, { terminal: row.terminal, id: row.terminal, label: row.title, origin: terminals().find(k => k.address === row.terminal)?.labels?.["herdr.chat.origin"] || row.terminal });
    const owner = panes().find(p => p.terminal === row.terminal || p.pane === chatPane(terminals().find(k => k.address === row.terminal)));
    if (!owner) throw new Error("That session is already running. Use Beside to open another view.");
    const ownerSpace = spaces().find(s => s.tabs.some(t => t.id === owner.tab));
    if (ownerSpace && ownerSpace.id !== space.id) await app("space.select", { id: ownerSpace.id });
    await app("tab.select", { id: owner.tab });
    return app("pane.focus", { pane: owner.pane });
  }
  const argv = sessionArgv(row);
  let opened;
  if (req.beside) {
    const target = panes().find(p => p.pane === req.beside);
    if (!target || !space.tabs.some(t => t.id === target.tab)) throw new Error("The pane beside which you were opening has closed.");
    await app("tab.select", { id: target.tab });
    await app("pane.focus", { pane: target.pane });
    opened = await app("terminal.open", { argv, folder: row.cwd, name: row.title === "Assistant" ? "Assistant history" : row.title, place: "right" });
  } else opened = await app("tab.new", { space: space.id, argv, folder: row.cwd, name: row.title === "Assistant" ? "Assistant history" : row.title });
  const address = opened.terminal;
  if (!address) throw new Error("Herdr didn't return the resumed agent. Check its new tab.");
  await hc(["label", address, `herdr.session=${row.key}`, `herdr.chat.origin=history:${row.key}`]);
  const terminalPane = opened.pane ?? panes().find(p => p.terminal === address)?.pane;
  if (!terminalPane) throw new Error("The resumed agent is open in Terminal mode.");
  await app("pane.focus", { pane: terminalPane });
  return terminalPane;
}
export function watchSessionHistory(cx, onError) {
  let seen = shared("sessions.openreq")?.nonce, busy = false;
  cx.timer.every(150, (cx) => {
    const req = shared("sessions.openreq");
    if (!req || req.nonce === seen || busy) return;
    seen = req.nonce;
    if (Date.now() - req.at > 15000) return;
    busy = true;
    cx.spawn(async (cx) => {
      try { await openSavedSession(req); } catch (e) { onError(e); }
      finally { busy = false; cx.notify(); }
    });
  });
}

// Capture ownership while the exact process/log/account are known, so later folder renames
// cannot lose the association. Folder scanning also recovers sessions closed before installation.
export function rememberChatSession(chat, cx) {
  const feature=chat.role==='feature' ? chat.feature : null;
  if(feature && !chat.companion && !chat.thread && chat.path && chat.argv && (chat.kind!=='codex'||chat.dflt?.home&&chat.dfltFor===`${chat.kind}|${chat.t?.foreground?.pid}`)) {
    const session=sessionOf(chat.kind,chat.path);
    const record={id:feature,kind:chat.kind,session,home:chat.dflt?.home,argv:chat.argv,terminal:chat.addr};
    const sig=JSON.stringify(record);
    if(session && chat.featureSaved!==sig && !chat.featureSaving){
      chat.featureSaving=true;
      cx.spawn(async()=>{try{if(chat.addr===record.terminal&&sessionOf(chat.kind,chat.path)===session){await workspaceCall('feature-update',record);chat.featureSaved=sig;}}finally{chat.featureSaving=false;}});
    }
  }
  if (chat.kind !== "codex" || chat.companion || chat.thread || !chat.dflt?.home || !chat.path || chat.dfltFor!==`${chat.kind}|${chat.t?.foreground?.pid}`) return;
  const session = sessionOf("codex", chat.path);
  const pane = panes().find(p => p.pane === chat.myPane());
  const space = spaces().find(s => s.tabs.some(t => t.id === pane?.tab));
  if (!session || !space || space.machine) return;
  const tab = space.tabs.find(t => t.id === pane.tab);
  const row = { ...(feature ? { feature } : {}), kind: "codex", home: chat.dflt.home, session, space: space.id, title: tab?.name, argv: resumeArgv("codex", chat.argv ?? ["codex"], session) };
  const signature = JSON.stringify(row);
  if (signature === chat.historySaved || chat.historySaving) return;
  chat.historySaving = true;
  cx.spawn(async () => {
    try {
      const r = await exec("python3", [helper(), "capture", signature]);
      if (r.code === 0) {
        chat.historySaved = signature;
      }
    } finally { chat.historySaving = false; }
  });
}
