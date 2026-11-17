// Feature Assistants have durable IDs; a view, terminal address or tab is not their identity.
import { appHome, exec, hc, run, shared, setShared, openOverlay } from 'herdr';
import { spaces, panes, terminals } from './live.js';
import { readShepherdr, shepherdrFor } from './coordinator.js';
import { chatLabel, chatPane } from './core/spaces.js';
import { workspaceCall } from './workspace-store.js';
export { workspaceCall } from './workspace-store.js';
export const featureRecords = () => shared('workspace.features') ?? [];
export function featureRequest(id) { setShared('workspace.feature.request', { id, at: Date.now(), nonce: Math.random() }); }
export function startFeature(space = spaces().find(s=>s.active), context = '', source = null) {
 if(!space) return;
 if(context) setShared('workspace.feature.request',{create:{space:space.id,folder:shared('workspace.roots')?.[space.id]??space.folder,context,source,autoName:true},at:Date.now(),nonce:Math.random()});
 else openOverlay({mod:'workspace-launchers',kind:'dialog',width:600,height:330,props:{mode:'feature',space:space.id}});
}
async function app(command,args) {
 const r=await exec('herdr-app',['do',command,JSON.stringify(args)]);let out;try{out=JSON.parse(r.stdout);}catch{throw new Error(r.stderr||'Herdr did not answer.');}
 if(r.code||out.error)throw new Error(out.error||r.stderr);return out;
}
export async function openFeature(record) {
 const space=spaces().find(s=>s.id===record.space);
 if(!space)throw new Error('The feature’s space is not open.');
 if(space.machine)throw new Error('Feature Assistants currently run in local spaces.');
 const candidates=terminals().filter(k=>k.state==='live'&&k.labels?.['herdr.feature']===record.id&&k.labels?.['herdr.role']==='feature');
 const live=candidates.find(k=>['codex','claude-code'].includes(k.status?.app)||['codex','claude','claude-code'].includes(k.foreground?.name)||k.program?.agent);
 const pane=live&&panes().find(p=>p.terminal===live.address||p.pane===chatPane(live));
 if(pane){run('space.select',{id:space.id});run('tab.select',{id:pane.tab});run('pane.focus',{pane:pane.pane});return;}
 const existing=panes().find(p=>p.pane===record.pane&&p.mod==='chat'&&space.tabs.some(t=>t.id===p.tab));
 if(existing){if(!live&&record.session)setShared('workspace.feature.resume',{record,at:Date.now(),nonce:Math.random()});run('space.select',{id:space.id});run('tab.select',{id:existing.tab});run('pane.focus',{pane:existing.pane});return;}
 const slot=`feature-${record.id}`;
 const out=await app('tab.new',{space:space.id,name:record.name,mod:'chat',props:{role:'feature',template:'feature',space:space.id,folder:record.folder,slot,feature:record.id,settings:record.settings,featureRecord:record}});
 setShared('coordinator.slots',{...(shared('coordinator.slots')??{}),[slot]:{space:space.id,tab:out.tab,pane:out.pane,folder:record.folder,feature:record.id}});
 if(live)await hc(['label',live.address,`herdr.chat=${chatLabel(out.pane)}`,`herdr.chat.slot=${slot}`,`herdr.chat.origin=slot:${slot}`,`herdr.coordinator.tab=${out.tab}`]);
 await workspaceCall('feature-update',{id:record.id,tab:out.tab,pane:out.pane});
}
export function watchFeatures(cx,onError) {
 let seen=shared('workspace.feature.request')?.nonce,busy=false,reading=false;
 const refresh=async()=>{if(reading)return;reading=true;try{const out=await workspaceCall('features'),old=featureRecords();
 if(JSON.stringify(out.features)!==JSON.stringify(old)){
  for(const rec of out.features){const before=old.find(x=>x.id===rec.id);if(before&&before.name!==rec.name&&rec.tab&&spaces().some(s=>s.tabs.some(t=>t.id===rec.tab)))run('tab.rename',{id:rec.tab,name:rec.name});}
  setShared('workspace.features',out.features);
 }}finally{reading=false;}};
 cx.spawn(async()=>{try{await refresh();}catch(e){onError(e);}});
 cx.timer.every(2000,cx=>{cx.spawn(async()=>{try{await refresh();}catch{};});});
 cx.timer.every(150,cx=>{
  const req=shared('workspace.feature.request');if(!req||req.nonce===seen||busy)return;seen=req.nonce;
  if(Date.now()-req.at>15000)return;busy=true;
  cx.spawn(async cx=>{try{
   let rec;
   if(req.create){
    const cfg=shepherdrFor(await readShepherdr(),req.create.space),base=cfg.coordinator??{},pick={...base,...(cfg.feature??{})};
    // One signed-in account per space; feature role still controls model/thinking/permissions.
    if(base.agent==='codex'&&pick.agent==='codex'){if(base.profile)pick.profile=base.profile;else delete pick.profile;}
    rec=await workspaceCall('feature-create',{...req.create,settings:pick});
   }else rec=await workspaceCall('feature-get',{id:req.id});
   await openFeature(rec);await refresh();
  }catch(e){onError(e);}finally{busy=false;cx.notify();}});
 });
}
