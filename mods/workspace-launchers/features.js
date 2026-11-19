import {projectFolder} from './project-folder.js';
// Feature Assistants have durable IDs; a view, terminal address or tab is not their identity.
import { appHome, exec, hc, run, shared, setShared, openOverlay } from 'herdr';
import { spaces, panes, terminals } from './live.js';
import { readShepherdr, shepherdrFor } from './coordinator.js';
import { chatLabel, featureViews, isFeatureAssistant } from './core/spaces.js';
import { workspaceCall } from './workspace-store.js';
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
 const candidates=snapshot.terminals.filter(k=>isFeatureAssistant(k)&&k.labels['herdr.feature']===record.id);
 const live=candidates.find(k=>['codex','claude-code'].includes(k.status?.app)||['codex','claude','claude-code'].includes(k.foreground?.name)||k.program?.agent);
 const views=featureViews(snapshot);
 const extras=new Set(Object.values(snapshot.companions).map(r=>r.pane));
 const existing=snapshot.panes.find(p=>views.byPane.get(p.pane)?.id===record.id&&!extras.has(p.pane));
 reconcileNames(snapshot,new Map(),record.id);
 if(existing){if(!live&&record.session)setShared('workspace.feature.resume',{record,at:Date.now(),nonce:Math.random()});run('space.select',{id:space.id});run('tab.select',{id:existing.tab});run('pane.focus',{pane:existing.pane});return;}
 const slot=`feature-${record.id}`;
 const out=await app('tab.new',{space:space.id,name:record.name,mod:'chat',props:{role:'feature',template:'feature',space:space.id,folder:record.folder,slot,feature:record.id,settings:record.settings,featureRecord:record}});
 setShared('coordinator.slots',{...(shared('coordinator.slots')??{}),[slot]:{space:space.id,tab:out.tab,pane:out.pane,folder:record.folder,feature:record.id}});
 if(live)await hc(['label',live.address,`herdr.chat=${chatLabel(out.pane)}`,`herdr.chat.slot=${slot}`,`herdr.chat.origin=slot:${slot}`,`herdr.coordinator.tab=${out.tab}`]);
 await workspaceCall('feature-update',{id:record.id,tab:out.tab,pane:out.pane});
}
export function watchFeatures(cx,onError) {
 let seen=shared('workspace.feature.request')?.nonce,busy=false,reading=false;
 const attempted=new Map();
 const refresh=async()=>{if(reading)return;reading=true;try{const out=await workspaceCall('features'),old=featureRecords();
 if(JSON.stringify(out.features)!==JSON.stringify(old)){
  setShared('workspace.features',out.features);
 }
 reconcileNames(featureViewState(out.features),attempted);
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
