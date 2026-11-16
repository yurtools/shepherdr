// File references are added to a particular draft, never sent as a message automatically.
import { shared, setShared, openOverlay, run, focused } from 'herdr';
import { spaces, panes } from './live.js';
export function relativeFile(root, file) {
  const base=String(root??'').replace(/[\\/]+$/,'');
  return base && file.startsWith(base+'/') ? file.slice(base.length+1) : file;
}
export function referenceTargets(space=spaces().find(s=>s.active)) {
  if(!space)return[];
  const tabs=new Map((space.tabs??[]).map(t=>[t.id,t])), seen=shared('workspace.chat-targets')??{};
  const last=shared('workspace.chat-last')?.[space.id];
  return panes().filter(p=>tabs.has(p.tab)&&(p.mod==='chat'||p.mod==='coordinator'||seen[p.pane]?.space===space.id)).map(p=>({pane:p.pane,space:space.id,
    label:tabs.get(p.tab)?.name||'Chat',account:seen[p.pane]?.account||'Assigned agent',on:seen[p.pane]?.on??space.machine??null,last:p.pane===last}))
    .sort((a,b)=>Number(b.last)-Number(a.last));
}
export function queueReference(target,file) {
  const owner=panes().find(p=>p.pane===target.pane);
  if(!owner || !spaces().find(s=>s.id===target.space)?.tabs?.some(t=>t.id===owner.tab))throw new Error('That chat has closed. Choose another chat.');
  if(file.on && file.on!==target.on)throw new Error('Reference this remote file in a chat on the same computer.');
  const all=shared('workspace.file-references')??{}, queue=all[target.pane]??[];
  setShared('workspace.file-references',{...all,[target.pane]:[...queue.slice(-19),{...file,space:target.space,nonce:`${Date.now()}-${Math.random()}`,at:Date.now()}]});
  run('space.select',{id:target.space});run('tab.select',{id:owner.tab});run('pane.focus',{pane:target.pane});
}
export function fileActions(file, at=null, targets=false) {
  const space=spaces().find(s=>s.active), rows=referenceTargets(space);
  if(targets&&rows.length===1){queueReference(rows[0],file);return;}
  openOverlay({mod:'workspace-file-actions',kind:'popup',frame:'none',width:360,height:targets?Math.min(460,60+rows.length*62):170,
    ...(at?{at}:{}),props:{...file,space:space?.id,targets}});
}
