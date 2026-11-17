import { appHome, exec, hc, shared, setShared, machines } from 'herdr';
import { spaces, terminals } from './live.js';
import { workspaceCall } from './features.js';
const quote = s => `'${String(s).replace(/'/g,"'\\''")}'`;
async function openPage(request) {
 const space=spaces().find(s=>s.id===request.space);if(!space)throw new Error('Choose a space for the browser tab.');
 if(space.machine)throw new Error('Browser tabs currently run in local spaces.');
 const page=await workspaceCall('browser-create',request);
 const argv=['node',`${appHome()}/bin/herdr-browser-view`,'--page',page.id];
 const r=await exec('herdr-app',['do','tab.new',JSON.stringify({space:space.id,name:page.name,argv})]);
 let out;try{out=JSON.parse(r.stdout);}catch{throw new Error(r.stderr||'Browser tab did not open.');}
 if(r.code||out.error){await workspaceCall('browser-update',{id:page.id,open:false});throw new Error(out.error||r.stderr);}
 await workspaceCall('browser-update',{id:page.id,tab:out.tab,terminal:out.terminal});
 if(out.terminal)await hc(['label',out.terminal,`herdr.browser.page=${page.id}`]);
 return out;
}
export function watchBrowserTabs(cx,onError) {
 let seen=shared('workspace.browser.request')?.nonce,busy=false,checking=false;
 cx.timer.every(150,cx=>{
  const req=shared('workspace.browser.request');if(!req||req.nonce===seen||busy)return;seen=req.nonce;if(Date.now()-req.at>15000)return;
  busy=true;cx.spawn(async cx=>{try{await openPage(req);}catch(e){onError(e);}finally{busy=false;cx.notify();}});
 });
 const restarted=new Map();
 cx.timer.every(5000,cx=>{if(checking||machines().find(m=>m.name==null)?.layout!=='ready')return;checking=true;cx.spawn(async()=>{try{
  const rows=(await workspaceCall('browsers')).browsers;
  for(const page of rows.filter(p=>p.open&&p.tab&&p.terminal)){
   const space=spaces().find(s=>s.id===page.space);if(!space)continue;
   const tab=space.tabs.find(t=>t.id===page.tab);
   if(!tab){await workspaceCall('browser-update',{id:page.id,open:false});continue;}
   const terminal=terminals().find(t=>t.address===page.terminal&&t.state==='live');if(!terminal)continue;
   const foreground=terminal.foreground?.argv??[];
   const running=foreground.some(a=>String(a).endsWith('herdr-browser-view'));
   const shell=['bash','zsh','fish','sh'].includes(String(terminal.foreground?.name??'').split('/').pop());
   if(running){restarted.delete(page.terminal);continue;}
   if(!running&&shell&&Date.now()-(restarted.get(page.terminal)??0)>15000){
    // Core recovery restores this dedicated browser terminal as a shell. Restart only our labelled viewer host.
    if(terminal.labels?.['herdr.browser.page']!==page.id)continue;
    restarted.set(page.terminal,Date.now());
    const command=['node',`${appHome()}/bin/herdr-browser-view`,'--page',page.id].map(quote).join(' ');
    await hc(['send',page.terminal,command]);
   }
  }
 }catch{}finally{checking=false;}});});
}
