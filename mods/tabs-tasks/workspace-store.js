import { appHome, exec, panes, shared, setShared } from 'herdr';
export async function workspaceCall(command, payload = {}) {
 const r = await exec('python3', [`${appHome()}/mods/workspace-launchers/bin/workspace-state`, command, JSON.stringify(payload)], { timeout: 20000 });
 let out; try { out=JSON.parse(r.stdout); } catch { throw new Error(r.stderr || 'Workspace data could not be read.'); }
 if(r.code || out.error) throw new Error(out.error || r.stderr); return out;
}

export function launcherAgents(known,catalog) {
 const merged=new Map((known??[]).map(row=>[row.key,row]));
 for(const row of catalog?.agents??[])merged.set(row.key,{...(merged.get(row.key)??{}),...row});
 const configured = new Set((catalog?.agents ?? []).map(row => row.key));
 return [...merged.values()].sort((a,b) => Number(configured.has(b.key))-Number(configured.has(a.key)) || Number(b.installed === true)-Number(a.installed === true) || String(a.name ?? a.key).localeCompare(String(b.name ?? b.key)));
}

const CLIPBOARD_ACTIONS=new Set(['terminal.copy','terminal.paste','terminal.select_all']);
export function requestTerminalClipboard(command,target) {
 if(!CLIPBOARD_ACTIONS.has(command)||!target?.terminal)return;
 setShared('workspace.terminal-clipboard',{command,terminal:target.terminal,pane:target.pane,at:Date.now(),nonce:Math.random()});
}
export async function executeTerminalClipboard(req,io=exec,targets=panes()) {
 if(!CLIPBOARD_ACTIONS.has(req.command))throw new Error('Unknown clipboard action.');
 const target=targets.find(p=>(!req.pane||p.pane===req.pane)&&(p.terminal===req.terminal||p.shown===req.terminal));
 if(!target)throw new Error('The original terminal is no longer open.');
 for(const [command,args] of [['pane.focus',{pane:target.pane}], [req.command,req.command==='terminal.select_all'?{terminal:req.terminal}:null]]){
  const r=await io('herdr-app',['do',command,...(args?[JSON.stringify(args)]:[])]);
  let out;try{out=JSON.parse(r.stdout??'{}');}catch{}
  if(r.code||out?.error)throw new Error(out?.error||r.stderr||'Clipboard action failed.');
 }
}
export function watchTerminalClipboard(cx,onError) {
 let seen=shared('workspace.terminal-clipboard')?.nonce;
 cx.timer.every(100,cx=>{
  const req=shared('workspace.terminal-clipboard');if(!req||req.nonce===seen)return;seen=req.nonce;
  if(Date.now()-req.at>3000)return;
  // This persistent owner survives the popup closing; a closed mod cancels its async calls.
  cx.spawn(async()=>{try{await executeTerminalClipboard(req);}catch(e){onError(e);}});
 });
}
