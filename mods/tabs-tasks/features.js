import {projectFolder} from './project-folder.js';
// Feature Assistants have durable IDs; a view, terminal address or tab is not their identity.
import { appHome, exec, hc, run, shared, setShared, openOverlay } from 'herdr';
import { spaces, panes, terminals } from './live.js';
import { readShepherdr, shepherdrFor } from './coordinator.js';
import { featureViews, isFeatureAssistant, featureOwner, runningFeatureAssistant, chatPane, chatLabel } from './core/spaces.js';
import { FIND } from './core/session-find.js';
import * as agent from './agent.js';
import { workspaceCall } from './workspace-store.js';
import { startRole, withRoleView } from './role-launch.js';
export { workspaceCall } from './workspace-store.js';
export function featureSettings(cfg) {
 const base=cfg.coordinator??{}, role=cfg.feature;
 const pick={...base,...(role??{})};
 // An explicit primary-account choice has no profile key; do not inherit Account 2.
 if(role&&!Object.prototype.hasOwnProperty.call(role,'profile'))delete pick.profile;
 return pick;
}
export const featureRecords = () => shared('workspace.features') ?? [];
export function featureViewState(features = featureRecords()) {
 return {features,spaces:spaces(),panes:panes(),terminals:terminals(),slots:shared('coordinator.slots')??{},companions:shared('workspace.companions')??{}};
}
function reconcileNames(snapshot, attempted = new Map(), only = null) {
 const names=featureViews(snapshot).byTab, tabs=new Map(snapshot.spaces.flatMap(s=>s.tabs.map(t=>[t.id,t])));
 for(const id of attempted.keys())if(!names.has(id))attempted.delete(id);
 for(const [id,rec] of names){
  if(only&&rec.id!==only)continue;
  const tab=tabs.get(id);
  if(tab.name===rec.name&&tab.named){attempted.delete(id);continue;}
  // A delayed host update must not generate a rename on every poll.
  const key=JSON.stringify([rec.id,rec.name,tab.name,tab.named]);
  if(attempted.get(id)===key)continue;
  run('tab.rename',{id,name:rec.name});attempted.set(id,key);
 }
}
export function featureRequest(id) { setShared('workspace.feature.request', { id, at: Date.now(), nonce: Math.random() }); }
export function startFeature(space = spaces().find(s=>s.active), context = '', source = null) {
 if(!space) return;
 if(context) setShared('workspace.feature.request',{create:{space:space.id,folder:shared('workspace.roots')?.[space.id]??space.folder,context,source,autoName:true},at:Date.now(),nonce:Math.random()});
 else openOverlay({mod:'workspace-launchers',kind:'dialog',frame:'none',width:460,height:240,props:{mode:'feature',space:space.id}});
}
async function app(command,args) {
 const r=await exec('herdr-app',['do',command,JSON.stringify(args)]);let out;try{out=JSON.parse(r.stdout);}catch{throw new Error(r.stderr||'Herdr did not answer.');}
 if(r.code||out.error)throw new Error(out.error||r.stderr);return out;
}
export async function openFeature(record) {
 const space=spaces().find(s=>s.id===record.space);
 if(!space)throw new Error('The feature’s space is not open.');
 if(space.machine)throw new Error('Feature Assistants currently run in local spaces.');
 const snapshot=featureViewState([...featureRecords().filter(r=>r.id!==record.id),record]);
 const candidates=snapshot.terminals.filter(k=>featureOwner(k,record));
 const live=candidates.find(k=>runningFeatureAssistant(k,record));
 const views=featureViews(snapshot);
 const extras=new Set(Object.values(snapshot.companions).map(r=>r.pane));
 const owned=snapshot.panes.filter(p=>views.byPane.get(p.pane)?.id===record.id&&!extras.has(p.pane));
 let existing=owned.find(p=>live&&(p.terminal===live.address||p.pane===chatPane(live)))??owned.find(p=>p.mod==='chat');
 reconcileNames(snapshot,new Map(),record.id);
 const slot=`feature-${record.id}`;
 const spec={role:'feature',template:'feature',space,folder:record.folder,slot,settings:record.settings,featureRecord:record};
 const terminal=await startRole({...spec,...(existing?.mod==='chat'?{pane:existing.pane,tab:existing.tab}:{})});
 // The core may just have repaired a legacy feature slot before the native
 // list catches up. Use its verified address, not a saved pane ID.
 if(!existing){
  const owner=snapshot.terminals.find(k=>k.address===terminal);
  existing=snapshot.panes.find(p=>space.tabs.some(t=>t.id===p.tab)&&!extras.has(p.pane)&&
   (p.terminal===terminal||p.mod==='chat'&&p.pane===chatPane(owner)&&snapshot.terminals.every(k=>k.state!=='live'||chatPane(k)!==p.pane||k.address===terminal||featureOwner(k,record))));
 }
 if(existing&&(existing.mod==='chat'||existing.terminal===terminal)){
  await bindFeature(record,terminal,slot,existing,existing.mod==='chat',candidates);
  if(existing.mod==='chat'){
   // Restore the original Chat, even when the slot receipt and its props still
   // name the shell that the core recovered. StartRole resumes the exact session.
   setShared('workspace.feature.resume',{record:{...record,terminal},address:terminal,pane:existing.pane,at:Date.now(),nonce:Math.random()});
  }
  run('space.select',{id:space.id});run('tab.select',{id:existing.tab});run('pane.focus',{pane:existing.pane});return;
 }
 await withRoleView(async()=>{
 await app('space.select',{id:space.id});
 // Older records did not save the view mode. A retained Chat label is evidence
 // of its last view, even if the corresponding pane vanished in the reboot.
 const chat=record.view==='chat'||(!record.view&&candidates.some(k=>chatPane(k)));
 const out=chat?await app('tab.new',{space:space.id,name:record.name,mod:'chat',props:{terminal,role:'feature',template:'feature',feature:record.id,slot,space:record.space,folder:record.folder,settings:record.settings,featureRecord:record}})
  :await app('terminal.keep',{terminal,place:'tab'});
 if(!out.pane||!out.tab)throw new Error('Herdr did not return the Feature Assistant view. Reopen the feature to try again.');
 await app('tab.rename',{id:out.tab,name:record.name});
 await bindFeature(record,terminal,slot,out,chat,candidates);
 });
}
async function bindFeature(record,terminal,slot,view,chat,candidates) {
 const origin=candidates.find(k=>k.address===terminal)?.labels?.['herdr.chat.origin']||candidates.find(k=>k.address===record.terminal)?.labels?.['herdr.chat.origin']||`slot:${slot}`;
 const result=await hc(['label',terminal,`herdr.chat=${chat?chatLabel(view.pane):''}`,`herdr.chat.slot=${slot}`,`herdr.chat.origin=${origin}`,`herdr.coordinator.tab=${view.tab}`]);
 if(result.code)throw new Error('Could not bind the Feature Assistant to its view. Reopen the feature to try again.');
 const slots=shared('coordinator.slots')??{},previous=slots[slot];
 const legacyTerminal=chat&&(previous?.pane===view.pane?previous.legacyTerminal:null) || (chat?candidates.find(k=>chatPane(k)===view.pane)?.address:null);
 setShared('coordinator.slots',{...slots,[slot]:{space:record.space,tab:view.tab,pane:view.pane,folder:record.folder,feature:record.id,...(legacyTerminal?{legacyTerminal}:{})}});
 await workspaceCall('feature-update',{id:record.id,tab:view.tab,pane:view.pane,terminal,view:chat?'chat':'terminal'});
 // Leave old shells intact, but retire their obsolete ownership and view labels.
 // Recheck with core: never strip labels from an agent that started in the meantime.
 for(const old of candidates.filter(k=>k.address!==terminal&&!runningFeatureAssistant(k,record))){
  const info=await hc(['get',old.address,'--json']);let current;
  try{current=JSON.parse(info.stdout);}catch{}
  if(info.code||!featureOwner({...current,address:old.address},record)||!current.foreground?.name||runningFeatureAssistant({...current,address:old.address},record))continue;
  await hc(['label',old.address,'herdr.chat=','herdr.chat.slot=','herdr.chat.origin=','herdr.feature=','herdr.role=','herdr.coordinator.space=','herdr.coordinator.tab=']);
 }
}
// Terminal-first Features must be resumable even if Chat has never been opened. Read the
// exact running process's log and account, just as Chat does; no transcript is copied.
export async function captureFeatureSession(record, address) {
 const result=await hc(['get',address,'--json']);if(result.code)return null;
 const t=JSON.parse(result.stdout),kind=({'claude-code':'claude',claude:'claude',codex:'codex'})[t.status?.app??t.foreground?.name];
 if(t.state!=='live'||!kind||!t.foreground?.pid)return null;
 const found=await exec('sh',['-c',FIND,'chat',kind,String(t.foreground.pid)]);
 const path=found.stdout.trim().split('\n').pop(),session=agent.sessionOf(kind,path);
 if(!session)return null;
 const dflt=await agent.defaults(kind,null,{pid:t.foreground.pid});
 const raw=t.foreground.argv??t.argv??[],at=raw.findIndex(a=>/^(codex|claude)$/.test(String(a).split('/').pop()));
 if(at<0)return null;
 const argv=[...agent.launchPrefix(kind,t.argv??raw,dflt.home),...raw.slice(at+1)];
 await workspaceCall('feature-update',{id:record.id,kind,session,home:dflt.home,argv,terminal:address});
 if(kind==='codex'){
  const row={feature:record.id,kind,home:dflt.home,session,space:record.space,title:record.name,argv:agent.resumeArgv(kind,argv,session)};
  const saved=await exec('python3',[`${appHome()}/mods/workspace-sessions/bin/herdr-sessions`,'capture',JSON.stringify(row)]);
  if(saved.code)throw new Error(saved.stderr||'Could not remember the feature session.');
 }
 return t.foreground.pid;
}
export function watchFeatures(cx,onError) {
 let seen=shared('workspace.feature.request')?.nonce,busy=false,reading=false;
 const attempted=new Map(),captured=new Map();
 const refresh=async()=>{if(reading)return;reading=true;try{const out=await workspaceCall('features'),old=featureRecords();
 if(JSON.stringify(out.features)!==JSON.stringify(old)){
  setShared('workspace.features',out.features);
 }
 reconcileNames(featureViewState(out.features),attempted);
 for(const k of terminals().filter(k=>isFeatureAssistant(k)&&panes().some(p=>p.terminal===k.address))){
  if(captured.has(k.address)&&(!k.foreground?.pid||captured.get(k.address)===k.foreground.pid))continue;
  const record=out.features.find(r=>r.id===k.labels['herdr.feature']);if(!record)continue;
  const pid=await captureFeatureSession(record,k.address);if(pid)captured.set(k.address,pid);
 }
 }finally{reading=false;}};
 cx.spawn(async()=>{try{await refresh();}catch(e){onError(e);}});
 cx.timer.every(2000,cx=>{cx.spawn(async()=>{try{await refresh();}catch{};});});
 cx.timer.every(150,cx=>{
  const req=shared('workspace.feature.request');if(!req||req.nonce===seen||busy)return;seen=req.nonce;
  if(Date.now()-req.at>15000)return;busy=true;
  cx.spawn(async cx=>{try{
   let rec;
   if(req.rename){
    const name=req.rename.name?.trim();if(!name)throw new Error('Enter a feature name.');
    await workspaceCall('feature-update',{id:req.rename.id,name});await refresh();return;
   }else if(req.create){
    const cfg=shepherdrFor(await readShepherdr(),req.create.space),pick=featureSettings(cfg);
    const space=spaces().find(s=>s.id===req.create.space);
    if(!space)throw new Error('The feature’s space is no longer available.');
    const folder=await projectFolder(space);
    rec=await workspaceCall('feature-create',{...req.create,folder,settings:pick});
   }else rec=await workspaceCall('feature-get',{id:req.id});
   await openFeature(rec);await refresh();
  }catch(e){onError(e);}finally{busy=false;cx.notify();}});
 });
}
