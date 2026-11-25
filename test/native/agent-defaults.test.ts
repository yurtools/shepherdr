import {beforeEach,expect,mock,test} from 'bun:test';
import {fakeHerdr} from '../../service/fake-herdr';
import {fakeGpuiKit,fakeGpuiBase,byId,handler,built} from '../../service/fake-gpui';
let state:Map<string,any>,ps:any[],ts:any[],ss:any[],core:Map<string,any>,calls:any[],files:string[],cfg:any,focus:any,tree:any;
let props:any,holdRun:any,runRelease:any,failKeep=false,sent=false,runTimeout=false,serial=0;
let getResults:Map<string,any>,screen:string,lookups:any[];
const ok=(value:any={})=>({code:0,stdout:typeof value==='string'?value:JSON.stringify(value),stderr:''});
const savedSession='00000000-0000-0000-0000-000000000001';
const savedLog=`/account-two/sessions/rollout-${savedSession}.jsonl`;
function appArgs(args:string[]) {
 if(args[2]?.startsWith('{'))return JSON.parse(args[2]);
 return Object.fromEntries(Array.from({length:(args.length-2)/2},(_,i)=>[args[i*2+2].slice(2),args[i*2+3]]));
}
mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
mock.module('herdr',()=>fakeHerdr({
 appHome:()=>'/app',home:()=>'/person',shared:(k:string)=>state?.get(k),setShared:(k:string,v:any)=>state.set(k,v),
 spaces:()=>ss,panes:()=>ps,terminals:()=>ts,machines:()=>[{name:null,layout:'ready'},{name:'remote',layout:'ready'}],
 focused:()=>({...focus}),props:()=>props,layout:()=>tree,theme:()=>new Proxy({},{get:()=> '#444444'}),settings:()=>({zoom:1}),keys:()=>[],window:()=>({platform:'linux'}),
 knownAgents:async()=>[{key:'codex',name:'Codex',installed:true,run:['codex']}],
 readTextFile:async(path:string)=>path.endsWith('workspace-folders.json')?'{}':JSON.stringify(cfg),
 run:(name:string,data:any)=>{calls.push([name,data]);if(name==='space.select')focus.space=data.id;if(name==='pane.focus')focus.pane=data.pane;},
 hc:async(args:string[])=>{
  calls.push(['hc',args]);
  if(args[0]==='run'){
   const address=`t${++serial}`,labels=Object.fromEntries(args.flatMap((a,i)=>a==='--label'?[args[i+1].split(/=(.*)/s).slice(0,2)]:[]));
   core.set(address,{address,state:'live',labels,status:{app:'codex',state:'blocked'},turn:0,foreground:{pid:100+serial,name:'codex',argv:['codex','--no-daemon']}});
   if(holdRun)await holdRun;
   return runTimeout?{code:1,stdout:"",stderr:"trust timeout"}:ok({address,first_message:{sent}});
  }
  if(args[0]==='get')return getResults.get(args[1])??ok(core.get(args[1])??{state:'done'});
  if(args[0]==='read')return ok(screen);
  if(args[0]==='ls')return ok({terminals:[...core.values()]});
  if(args[0]==='label'){const t=core.get(args[1]);if(t)for(const label of args.slice(2)){const at=label.indexOf('=');t.labels[label.slice(0,at)]=label.slice(at+1);}}
  return ok();
 },
 exec:async(bin:string,args:string[])=>{
  if(bin==='sleep'){await Bun.sleep(1);return ok();}
  if(bin==='test')return ok();
  if(bin==='sh'){
   if(args[1].includes('agent-profiles.json'))return ok({profiles:[{id:'account-two',name:'Second',agent:'codex',home:'/account-two'}]});
   if(args[1].includes('cat "$dir/$1.md"'))return ok('---\ncommand: codex --no-daemon\n---\nGlobal '+args[3]+' instructions.');
   if(args[1].includes('printf "%s" "$2"')){files.push(args[4]);return ok();}
   if(args[2]==='defaults'){lookups.push(['defaults',args[3],args[5]]);return ok('home\t/account-two\n');}
   if(args[2]==='chat'){lookups.push(['chat',...args.slice(3)]);return ok(savedLog);}
   return ok();
  }
  if(bin==='python3'){
   if(args[1]==='launch'){calls.push(['approval',args]);return ok({argv:JSON.parse(args[args.indexOf('--argv')+1])});}
   calls.push(['workspace',args]);return ok();
  }
  if(bin==='git')return ok('/project');
  if(bin!=='herdr-app')return ok();
  if(args[0]==='ls')return ok({spaces:ss});
  const name=args[1],data=appArgs(args);calls.push([name,data]);
  if(name==='space.select')focus.space=data.id;
  if(name==='pane.focus')focus.pane=data.pane;
  if(name==='terminal.keep'){
   if(failKeep)return {code:1,stdout:'{}',stderr:'fixture refusal'};
   return ok({tab:'role-tab',pane:'role-pane',terminal:data.terminal});
  }
  if(name==='tab.new'&&data.mod==='chat')return ok({tab:'role-tab',pane:'role-pane'});
  if(name==='space.new')return ok({space:'new-space'});
  if(name==='pane.split')return ok({pane:'extra-pane'});
  return ok();
 }
}));
const C=await import('../../mods/tabs-tasks/coordinator.js');
const R=await import('../../mods/tabs-tasks/role-launch.js').catch(()=>null) as any;
const OtherR=await import('../../mods/chat/role-launch.js').catch(()=>null) as any;
const {default:Chat}=await import('../../mods/chat/main.js');
const F=await import('../../mods/tabs-tasks/features.js');
const {default:NewMenu}=await import('../../mods/new-menu-tasks/main.js');
const B=await import('../../mods/pane-chat/companions.js');
const {default:Pane}=await import('../../mods/pane-chat/main.js');
const {openTaskThread}=await import('../../mods/chat/panel.js');
const spec=()=>({slot:'slot',space:ss[0],folder:'/project',role:'coordinator',template:'assistant',settings:cfg.everywhere.coordinator});
const launches=()=>calls.filter(c=>c[0]==='hc'&&c[1][0]==='run');
beforeEach(()=>{
 serial=0;state=new Map();ps=[];ts=[];core=new Map();calls=[];files=[];props={};holdRun=null;runRelease=null;sent=true;failKeep=false;runTimeout=false;
 getResults=new Map();screen='';lookups=[];
 ss=[{id:'space',folder:'/project',machine:null,active:true,tabs:[]}];focus={space:'original-space',pane:'original-pane'};
 tree={id:'tasks-thread-body',active:'tasks-thread-chat'};
 cfg={everywhere:{coordinator:{agent:'codex',profile:'account-two',model:'chosen-model',effort:'high',perm:'auto'}},spaces:{space:{instructions:{coordinator:'Only this space.',feature:'Only this feature.'}}}};
 built.length=0;
});
test('new and automatically discovered spaces open their Assistant in Terminal with the resolved role and account',async()=>{
 await C.createSpace('/project',cfg.everywhere.coordinator);
 expect(launches()).toHaveLength(1);expect(launches()[0][1]).toContain('herdr.role=coordinator');
 expect(calls).toContainEqual(['terminal.keep',{terminal:'t1',place:'tab'}]);expect(files[0]).toContain('CODEX_HOME=/account-two');expect(files[0]).toContain('chosen-model');
 expect(calls.some(c=>c[0]==='tab.new'&&c[1].mod==='chat')).toBe(false);
});
test('space-specific and global instructions remain in the same role template with the same approval launch',async()=>{
 await C.openCoordinator(ss[0]);
 expect(files[0]).toContain('Global assistant instructions.');expect(files[0]).toContain('Only this space.');
 expect(calls.find(c=>c[0]==='approval')[1]).toContain('coordinator');expect(calls.find(c=>c[0]==='approval')[1]).toContain('/project');
 expect(launches()[0][1]).toContain('--no-parent');expect(launches()[0][1]).toContain('herdr.coordinator.space=space');
});
test('an already-running Assistant is adopted without a second launch',async()=>{
 ts=[{address:'existing',state:'live',labels:{'herdr.role':'coordinator','herdr.coordinator.space':'space'}}];
 await C.openCoordinator(ss[0]);expect(launches()).toEqual([]);expect(calls).toContainEqual(['terminal.keep',{terminal:'existing',place:'tab'}]);
});
test('focusing an existing lazy Chat Assistant preserves Chat and does not launch',async()=>{
 ss[0].tabs=[{id:'existing-tab'}];ps=[{pane:'existing-pane',tab:'existing-tab',mod:'chat'}];
 state.set('coordinator.slots',{legacy:{space:'space',tab:'existing-tab',pane:'existing-pane'}});
 await C.openCoordinator(ss[0]);expect(launches()).toEqual([]);expect(calls).toEqual([['space.select',{id:'space'}],['tab.select',{id:'existing-tab'}]]);
});
test('hidden Assistant creation restores both space and pane, including a failed keep',async()=>{
 for(const fail of [false,true]){
  state.clear();core.clear();calls=[];failKeep=fail;focus={space:'original-space',pane:'original-pane'};
  await C.openCoordinator(ss[0],false);
  expect(focus).toEqual({space:'original-space',pane:'original-pane'});
  expect(calls.slice(-2)).toEqual([['space.select',{id:'original-space'}],['pane.focus',{pane:'original-pane'}]]);
 }
});
test('a second Assistant open during delayed terminal and layout snapshots never starts twice',async()=>{
 await C.openCoordinator(ss[0],false);expect(ts).toEqual([]);expect(ps).toEqual([]);
 await C.openCoordinator(ss[0],false);expect(launches()).toHaveLength(1);expect(focus.space).toBe('original-space');
});
test('different module copies share an in-flight slot and its resolved receipt before native lists catch up',async()=>{
 holdRun=new Promise(resolve=>{runRelease=resolve;});
 const first=R.startRole(spec());while(!launches().length)await Bun.sleep(1);
 const second=OtherR.startRole(spec());runRelease();
 expect(await first).toBe('t1');expect(await second).toBe('t1');
 expect(await OtherR.startRole(spec())).toBe('t1');expect(launches()).toHaveLength(1);expect(ts).toEqual([]);
});
test('legacy lazy Chat and the tab owner cannot race to launch the same slot',async()=>{
 ps=[{pane:'legacy-pane',tab:'legacy-tab',mod:'chat'}];state.set('coordinator.slots',{slot:{space:'space',tab:'legacy-tab',pane:'legacy-pane',folder:'/project'}});
 holdRun=new Promise(resolve=>{runRelease=resolve;});const native=R.startRole(spec());while(!launches().length)await Bun.sleep(1);
 const work:Promise<any>[]=[],cx:any={notify(){},spawn:(fn:any)=>{const p=Promise.resolve(fn(cx));work.push(p);return p;}};
 const chat:any=Object.create(Chat.prototype);Object.assign(chat,{slot:'slot',role:'coordinator',phase:'fresh',pending:[],queue:[],featureRecord:null,choice:{sel:cfg.everywhere.coordinator},
  flag:async()=>{},follow:async()=>{},watchAsks:async()=>{},reset(){}});
 props={space:'space',folder:'/project'};chat.startAgent(null,cx);runRelease();await native;await Promise.all(work);
 expect(launches()).toHaveLength(1);expect(chat.addr).toBe('t1');expect(ts).toEqual([]);
});
test('folder trust keeps instructions pending across view disposal and sends them once after idle',async()=>{
 sent=false;await R.startRole(spec());await R.deliverRoleInstructions();expect(calls.filter(c=>c[0]==='hc'&&c[1][0]==='send')).toEqual([]);
 core.get('t1').status.state='idle';await OtherR.deliverRoleInstructions();await R.deliverRoleInstructions();
 const sends=calls.filter(c=>c[0]==='hc'&&c[1][0]==='send');expect(sends).toHaveLength(1);expect(sends[0][1][2]).toContain('Only this space.');
});
test('a Feature start retains feature, slot, account, instructions and bounded parent context',async()=>{
 const record={id:'feature-one',name:'Feature one',space:'space',context:'Parent handoff',autoName:true,started:false};
 await R.startRole({...spec(),role:'feature',template:'feature',slot:'feature-feature-one',featureRecord:record});
 const args=launches()[0][1];expect(args).toContain('herdr.feature=feature-one');expect(args).toContain('herdr.chat.slot=feature-feature-one');
 expect(args.at(-1)).toContain('Parent handoff');expect(args.at(-1)).toContain('feature-name');expect(files[0]).toContain('Only this feature.');
});
test('opening a lazy Feature beside starts its exact slot and keeps the original Chat owner',async()=>{
 ss[0].tabs=[{id:'source-tab'},{id:'feature-tab'}];ps=[{pane:'source-pane',tab:'source-tab',terminal:'ordinary'},{pane:'feature-pane',tab:'feature-tab',mod:'chat'}];
 state.set('workspace.features',[{id:'feature-one',space:'space',folder:'/project',name:'One',settings:cfg.everywhere.coordinator,started:false}]);
 state.set('coordinator.slots',{'feature-feature-one':{space:'space',tab:'feature-tab',pane:'feature-pane',feature:'feature-one',folder:'/project'}});
 const choice=B.besideChoices('source-pane')[0];await B.openBeside('source-pane',choice);
 expect(launches()[0][1]).toContain('herdr.feature=feature-one');expect(core.get('t1').labels['herdr.chat']).toBe('feature-pane');
 expect(B.companionFor('extra-pane')?.mode).toBe('terminal');B.closeCompanion('extra-pane');expect(calls.some(c=>c[0]==='terminal.kill')).toBe(false);
});
test('task opening selects Terminal through its header and focusing preserves an explicit Chat selection',()=>{
 openTaskThread('worker-one','T-1',null);expect(state.get('tasks.thread.termreq').terminal).toBe('worker-one');
 calls=[];state.delete('tasks.thread.termreq');openTaskThread('worker-one','T-1',null);
 expect(state.has('tasks.thread.termreq')).toBe(false);expect(calls.some(c=>c[1]?.stack==='tasks-thread-body')).toBe(false);
 openTaskThread('worker-two','T-2',null);expect(state.get('tasks.thread.termreq').terminal).toBe('worker-two');
});
test('ordinary and terminal-only launcher menu actions remain Terminal launches',()=>{
 const menu:any=Object.create(NewMenu.prototype);menu.agents=[{key:'codex',name:'Codex',installed:true,run:['codex']},{key:'goose',name:'Goose',installed:true,run:['goose']}];menu.catalog={chats:[],hidden_agents:[]};
 menu.draw();handler(byId('codex')!,'on_click')!();handler(byId('goose')!,'on_click')!();
 expect(calls.filter(c=>c[0]==='tab.new').map(c=>c[1])).toEqual([{name:'Codex',space:'space',argv:['codex']},{name:'Goose',space:'space',argv:['goose']}]);
});

test('a Terminal-only Feature saves the exact process log and owning account without opening Chat',async()=>{
 const record={id:'feature-one',space:'space',name:'One',started:false};
 await R.startRole({...spec(),role:'feature',template:'feature',slot:'feature-feature-one',featureRecord:record});
 await F.captureFeatureSession(record,'t1');
 const update=calls.find(c=>c[0]==='workspace'&&c[1][1]==='feature-update');
 expect(JSON.parse(update[1][2])).toMatchObject({id:'feature-one',kind:'codex',home:'/account-two',session:'00000000-0000-0000-0000-000000000001',terminal:'t1'});
 expect(JSON.parse(update[1][2]).argv).toContain('CODEX_HOME=/account-two');
 expect(calls.some(c=>c[0]==='tab.new'||c[0]==='terminal.park')).toBe(false);
});

test('opening a restored Feature Chat replaces a shell-only receipt with the saved conversation',async()=>{
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',kind:'codex',session:'saved-session',home:'/account-two',argv:['env','CODEX_HOME=/account-two','codex','--no-daemon'],terminal:'old'};
 const labels={'herdr.feature':record.id,'herdr.role':'feature','herdr.coordinator.space':'space','herdr.chat.slot':'feature-feature-one','herdr.chat.origin':'slot:feature-feature-one','herdr.chat':'old-chat'};
 const shell={address:'old',state:'live',argv:['bash'],foreground:{name:'bash',pid:90,argv:['bash']},labels};
 core.set('old',shell);ts=[shell];ps=[{pane:'old-chat',mod:'chat',tab:'old-tab'}];ss[0].tabs=[{id:'old-tab',name:'One',named:true}];
 state.set('workspace.role.starts',{':feature-feature-one':{token:'before-reboot',address:'old',at:1}});
 await F.openFeature(record);
 expect(launches()).toHaveLength(1);expect(launches()[0][1]).toContain('saved-session');expect(launches()[0][1]).toContain('CODEX_HOME=/account-two');
 expect(core.get('t1').labels['herdr.chat']).toBe('old-chat');expect(core.get('t1').labels['herdr.feature']).toBe(record.id);
 expect(state.get('coordinator.slots')['feature-feature-one']).toMatchObject({feature:record.id,pane:'old-chat',tab:'old-tab'});
 expect(state.get('workspace.feature.resume')).toMatchObject({address:'t1',pane:'old-chat'});
 expect(shell.labels['herdr.chat']).toBe('');expect(calls.some(c=>c[0]==='terminal.keep')).toBe(false);
 expect(calls.some(c=>c[0]==='hc'&&['kill','rm','send'].includes(c[1][0]))).toBe(false);
 await F.openFeature(record);expect(launches()).toHaveLength(1);
});

test('a restored slot with no session cannot silently start a different conversation',async()=>{
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',terminal:'old',settings:cfg.everywhere.coordinator};
 await expect(R.startRole({...spec(),role:'feature',template:'feature',slot:'feature-feature-one',featureRecord:record})).rejects.toThrow(/session/i);
 expect(launches()).toEqual([]);
});

test('a failed recovery cannot forget a previous launch and start a fresh Feature on retry',async()=>{
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',settings:cfg.everywhere.coordinator,started:false};
 const request={...spec(),role:'feature',template:'feature',slot:'feature-feature-one',featureRecord:record};
 state.set('workspace.role.starts',{':feature-feature-one':{token:'before-reboot',address:'gone',at:1}});
 for(let i=0;i<2;i++)await expect(R.startRole(request)).rejects.toThrow(/session/i);
 expect(launches()).toEqual([]);
});

test('a legacy Feature record missing all session associations is not mistaken for a newly created feature',async()=>{
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',context:'Old feature context',settings:cfg.everywhere.coordinator};
 await expect(F.openFeature(record)).rejects.toThrow(/saved session/i);
 expect(launches()).toEqual([]);
});

test('a disappeared Feature Chat is restored as Chat, not a shell or an unrelated pane',async()=>{
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',kind:'codex',session:'saved-session',home:'/account-two',argv:['env','CODEX_HOME=/account-two','codex'],terminal:'old',pane:'missing-chat',tab:'missing-tab'};
 const shell={address:'old',state:'live',argv:['bash'],foreground:{name:'bash',pid:90,argv:['bash']},labels:{'herdr.feature':record.id,'herdr.role':'feature','herdr.coordinator.space':'space','herdr.chat':'missing-chat'}};
 core.set('old',shell);ts=[shell];
 await F.openFeature(record);
 expect(launches()).toHaveLength(1);
 const view=calls.find(c=>c[0]==='tab.new')[1];expect(view).toMatchObject({mod:'chat',props:{terminal:'t1',feature:record.id,slot:'feature-feature-one'}});
 expect(core.get('t1').labels['herdr.chat']).toBe('role-pane');
 const update=calls.find(c=>c[0]==='workspace'&&c[1][1]==='feature-update');
 expect(JSON.parse(update[1][2])).toMatchObject({id:record.id,terminal:'t1',view:'chat',pane:'role-pane'});
});

test('an older restart that kept only the Feature slot is adopted after exact session and account verification',async()=>{
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',kind:'codex',session:'00000000-0000-0000-0000-000000000001',home:'/account-two',argv:['codex'],terminal:'older-address'};
 const active={address:'restored',state:'live',status:{app:'codex',state:'idle'},foreground:{name:'codex',pid:55,argv:['codex']},labels:{'herdr.chat.slot':'feature-feature-one','herdr.coordinator.space':'space','herdr.chat':'chat-pane'}};
 core.set('restored',active);ts=[active];ps=[{pane:'chat-pane',mod:'chat',tab:'old-tab'}];ss[0].tabs=[{id:'old-tab'}];
 await F.openFeature(record);
 expect(launches()).toEqual([]);expect(active.labels).toMatchObject({'herdr.role':'feature','herdr.feature':record.id});
 expect(calls).toContainEqual(['pane.focus',{pane:'chat-pane'}]);
});

test('a stale Chat adopts the exact recovered owner and follows its log, not the shell',async()=>{
 const record={id:'feature-one',space:'space',name:'One',session:'saved-session',home:'/account-two'};
 const labels={'herdr.feature':record.id,'herdr.role':'feature','herdr.coordinator.space':'space','herdr.chat.slot':'feature-feature-one'};
 ts=[{address:'old',state:'live',foreground:{name:'bash'},labels},{address:'restored',state:'live',foreground:{name:'codex'},labels}];
 state.set('coordinator.slots',{'feature-feature-one':{feature:record.id,space:'space',pane:'old-chat',tab:'old-tab'}});
 state.set('workspace.features',[record]);
 const work:Promise<any>[]=[],cx:any={notify(){},spawn:(fn:any)=>{const p=Promise.resolve(fn(cx));work.push(p);return p;}};
 const chat:any=Object.create(Chat.prototype);Object.assign(chat,{role:'feature',feature:record.id,featureRecord:record,slot:'feature-feature-one',addr:'old',phase:'unsupported',reset(){},flag:async()=>{},follow:async()=>{calls.push(['follow',chat.addr]);},watchAsks:async()=>{}});
 expect(chat.slotAgent()).toBe('restored');chat.rebindFeature({record,address:'restored',pane:'old-chat'},cx);await Promise.all(work);
 expect(chat.addr).toBe('restored');expect(chat.phase).toBe('finding');expect(calls).toContainEqual(['follow','restored']);
});

test('switching a running Feature with a stale saved pane keeps the same owner and saves both views',async()=>{
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',kind:'codex',session:'saved-session',home:'/account-two',terminal:'owner'};
 const owner={address:'owner',state:'live',status:{app:'codex',state:'done'},foreground:{name:'codex',pid:52},labels:{'herdr.role':'feature','herdr.feature':record.id,'herdr.coordinator.space':'space','herdr.chat.slot':'feature-feature-one'}};
 const worker={address:'worker',state:'live',labels:{'herdr.role':'worker','herdr.feature':record.id,'herdr.task':'TASK-1','herdr.task.space':'space'}};
 core.set('owner',owner);core.set('worker',worker);ts=[owner,worker];
 const terminal={pane:'actual-pane',tab:'actual-tab',terminal:'owner',app:'codex'};
 ss[0].tabs=[{id:'actual-tab',name:'One',named:true}];ps=[terminal];
 state.set('workspace.features',[record]);state.set('coordinator.slots',{'feature-feature-one':{feature:record.id,space:'space',pane:'stale-pane',tab:'stale-tab'}});
 const header:any=Object.create(Pane.prototype);const work:Promise<any>[]=[],cx:any={notify(){},spawn:(fn:any)=>{const job=Promise.resolve(fn(cx));work.push(job);return job;}};
 header.toChat(terminal,cx);await Promise.all(work);
 const split=calls.find(c=>c[0]==='pane.split')?.[1];expect(split).toMatchObject({pane:'actual-pane',mod:'chat'});
 expect(JSON.parse(split.props)).toMatchObject({terminal:'owner',feature:record.id,featureRecord:{session:record.session,home:record.home}});
 expect(core.get('owner').labels['herdr.chat']).toBe('extra-pane');expect(core.get('worker').labels['herdr.chat']).toBeUndefined();
 expect(state.get('coordinator.slots')['feature-feature-one']).toMatchObject({tab:'actual-tab',pane:'extra-pane'});
 expect(calls.filter(c=>c[0]==='workspace'&&c[1][1]==='feature-update').map(c=>JSON.parse(c[1][2]))).toEqual([{id:record.id,pane:'extra-pane',tab:'actual-tab',view:'chat'}]);
 expect(calls).toContainEqual(['terminal.park',{terminal:'owner'}]);
 ps=[{pane:'extra-pane',tab:'actual-tab',mod:'chat'}];header.toTerminal('extra-pane',cx);await Promise.all(work);
 expect(calls).toContainEqual(['terminal.keep',{terminal:'owner',place:'right'}]);
 expect(core.get('owner').labels['herdr.chat']).toBe('');expect(launches()).toEqual([]);
 expect(state.get('coordinator.slots')['feature-feature-one']).toMatchObject({tab:'actual-tab',pane:'role-pane'});
 expect(calls.filter(c=>c[0]==='workspace'&&c[1][1]==='feature-update').map(c=>JSON.parse(c[1][2])).at(-1)).toEqual({id:record.id,pane:'role-pane',tab:'actual-tab',view:'terminal'});
});

// SHEP-42: the actual YUR-011 hc get succeeded with state=live, status.app=codex,
// status.state=done and foreground.name=codex. Its original launch prompt contained
// "no terminal" in both argv and foreground.argv. Use stand-in IDs/account paths,
// but keep the response shape and matching words that caused the false stop.
function featureLocator() {
 const record={id:'feature-one',space:'space',folder:'/project',name:'One',kind:'codex',session:savedSession,home:'/account-two',terminal:'owner'};
 const argv=['codex','--no-daemon','Original context: no terminal has opened yet.'];
 const owner:any={address:'owner',state:'live',keep:false,status:{app:'codex',state:'done'},argv,
  foreground:{name:'codex',pid:52,argv,cwd:'/project'},
  labels:{'herdr.role':'feature','herdr.feature':record.id,'herdr.coordinator.space':record.space,'herdr.chat.slot':'feature-feature-one','herdr.chat.origin':'slot:feature-feature-one','herdr.chat':'extra-pane'}};
 core.set(owner.address,owner);ts=[owner];ss[0].tabs=[{id:'actual-tab',name:'One'}];ps=[{pane:'extra-pane',tab:'actual-tab',mod:'chat'}];
 state.set('workspace.features',[record]);
 state.set('coordinator.slots',{'feature-feature-one':{feature:record.id,space:record.space,pane:'extra-pane',tab:'actual-tab'}});
 const work:Promise<any>[]=[],cx:any={notify(){},spawn:(fn:any)=>{const job=Promise.resolve(fn(cx));work.push(job);return job;}};
 const chat:any=Object.create(Chat.prototype);
 Object.assign(chat,{role:'feature',feature:record.id,featureRecord:record,slot:'feature-feature-one',addr:owner.address,
  originKey:'slot:feature-feature-one',phase:'finding',path:null,lostTried:new Set(),myPane:()=> 'extra-pane',
  reset(){},flag:async()=>{},loadFirst(){},loadTasks:async()=>{},loadReach:async()=>{},loadSpaceTasks:async()=>{},
  lostSession:async()=>{throw new Error('The Feature must not start a replacement session.');}});
 const locate=async()=>{await chat.locate(cx);await Promise.all(work.splice(0));};
 const noReplacement=()=>expect(calls.filter(c=>c[0]==='hc'&&['run','send','keys','kill','rm'].includes(c[1][0]))).toEqual([]);
 return {record,owner,chat,locate,noReplacement};
}

test('SHEP-42: switched YUR-011 follows the live process even when successful argv says no terminal',async()=>{
 const {record,owner,chat,locate,noReplacement}=featureLocator();
 // Follow the same terminal selected by the ordinary native Chat switch, not a saved pane.
 delete owner.labels['herdr.chat'];owner.keep=true;
 const terminal={pane:'actual-pane',tab:'actual-tab',terminal:owner.address,app:'codex'};
 ps=[terminal];state.set('coordinator.slots',{'feature-feature-one':{feature:record.id,space:record.space,pane:'stale-pane',tab:'stale-tab'}});
 const header:any=Object.create(Pane.prototype),work:Promise<any>[]=[],cx:any={notify(){},spawn:(fn:any)=>{const job=Promise.resolve(fn(cx));work.push(job);return job;}};
 header.toChat(terminal,cx);await Promise.all(work);
 const split=JSON.parse(calls.find(c=>c[0]==='pane.split')[1].props);
 expect(split).toMatchObject({terminal:owner.address,feature:record.id,featureRecord:{session:record.session,home:record.home}});
 ps=[{pane:'extra-pane',tab:'actual-tab',mod:'chat'}];owner.keep=false;
 await locate();
 expect(chat.phase).toBe('finding');expect(chat.path).toBe(savedLog);
 expect(chat.addr).toBe(split.terminal);expect(chat.kind).toBe('codex');
 expect(lookups).toContainEqual(['chat','codex','52']);
 expect(lookups).toContainEqual(['defaults','codex','52']);
 expect(calls).toContainEqual(['hc',['keep',owner.address]]);
 await locate(); // the process account has now resolved; capture the same session.
 const updates=calls.filter(c=>c[0]==='workspace'&&c[1][1]==='feature-update').map(c=>JSON.parse(c[1][2]));
 expect(updates.at(-1)).toMatchObject({id:record.id,terminal:owner.address,session:record.session,home:record.home,kind:'codex'});
 expect(updates.at(-1).argv).toContain('CODEX_HOME=/account-two');
 expect(chat.resumeMissing).toBeUndefined();noReplacement();
});

test('SHEP-42: a live lookup recovers a previously false stopped Chat',async()=>{
 const {chat,locate,noReplacement}=featureLocator();
 chat.phase='unsupported';await locate();
 expect(chat.phase).toBe('finding');expect(chat.path).toBe(savedLog);noReplacement();
});

test('SHEP-42: a kept shell, exited terminal and missing terminal are still stopped',async()=>{
 const {owner,chat,locate,noReplacement}=featureLocator();
 owner.foreground={name:'bash',pid:52,argv:['bash'],cwd:'/project'};
 // Even stale Codex status and launch arguments cannot make Bash an Assistant.
 await locate();expect(chat.phase).toBe('unsupported');expect(chat.path).toBeNull();
 chat.phase='finding';owner.state='exited';await locate();expect(chat.phase).toBe('unsupported');
 chat.phase='finding';
 getResults.set(owner.address,{code:3,stdout:'',stderr:JSON.stringify({error:{kind:'not_found',message:'no terminal "owner"'}})});
 await locate();expect(chat.phase).toBe('unsupported');
 chat.phase='finding';
 getResults.set(owner.address,{code:1,stdout:JSON.stringify({error:{kind:'not_found',message:'no terminal "owner"'}}),stderr:''});
 await locate();expect(chat.phase).toBe('unsupported');
 expect(lookups).toEqual([]);noReplacement();
});

test('SHEP-42: a missing saved Feature session is not replaced',async()=>{
 const {record,owner,chat,locate,noReplacement}=featureLocator();
 owner.argv=['env','CODEX_HOME=/account-two','codex','resume',record.session];
 owner.foreground={name:'bash',pid:52,argv:['bash'],cwd:'/project'};
 screen='No conversation found with id '+record.session;
 await locate();expect(chat.phase).toBe('unsupported');expect(chat.resumeMissing).toBe(true);
 expect(lookups).toEqual([]);noReplacement();
});

test('SHEP-42: a stale address follows only the running owner of this Feature and space',async()=>{
 const {owner,chat,locate,noReplacement}=featureLocator();
 const restored={...owner,address:'restored'},wrong={...owner,address:'wrong',labels:{...owner.labels,'herdr.coordinator.space':'other-space'}};
 const worker={...owner,address:'worker',labels:{...owner.labels,'herdr.task':'TASK-1'}};
 getResults.set(owner.address,{code:3,stdout:'',stderr:JSON.stringify({error:{kind:'not_found',message:'no terminal "owner"'}})});
 ts=[wrong,worker];await locate();expect(chat.phase).toBe('unsupported');expect(chat.addr).toBe(owner.address);
 ts.push(restored);core.set(restored.address,restored);await locate();
 expect(chat.addr).toBe(restored.address);expect(chat.phase).toBe('finding');
 await locate();expect(chat.path).toBe(savedLog);noReplacement();
});

test('SHEP-42: unreachable or malformed lookups do not mark the Feature stopped',async()=>{
 const {owner,chat,locate,noReplacement}=featureLocator();
 chat.phase='ready';chat.path=savedLog;
 for(const result of [{code:1,stdout:'',stderr:'connection timed out'},{code:0,stdout:'',stderr:''},
  {code:1,stdout:JSON.stringify(owner),stderr:'connection interrupted'}]){
  getResults.set(owner.address,result);await locate();
  expect(chat.phase).toBe('ready');expect(chat.path).toBe(savedLog);
 }
 expect(lookups).toEqual([]);noReplacement();
});

test('simultaneous hidden openings in different spaces restore the original focus',async()=>{
 const other={id:'other-space',folder:'/other',tabs:[]};ss.push(other);
 await Promise.all([C.openCoordinator(ss[0],false),C.openCoordinator(other,false)]);
 expect(launches()).toHaveLength(2);expect(focus).toEqual({space:'original-space',pane:'original-pane'});
});

test('a timed-out launch is adopted from core labels even before native snapshots know it',async()=>{
 runTimeout=true;expect(await R.startRole(spec())).toBe('t1');expect(await OtherR.startRole(spec())).toBe('t1');
 expect(launches()).toHaveLength(1);expect(state.get('workspace.role.first').t1).toContain('Global assistant');
});

test('lazy Chat can win the shared start while the native owner waits on the same slot',async()=>{
 ps=[{pane:'legacy-pane',tab:'legacy-tab',mod:'chat'}];state.set('coordinator.slots',{slot:{space:'space',tab:'legacy-tab',pane:'legacy-pane',folder:'/project'}});
 holdRun=new Promise(resolve=>{runRelease=resolve;});
 const work:Promise<any>[]=[],cx:any={notify(){},spawn:(fn:any)=>{const p=Promise.resolve(fn(cx));work.push(p);return p;}};
 const chat:any=Object.create(Chat.prototype);Object.assign(chat,{slot:'slot',role:'coordinator',phase:'fresh',pending:[],queue:[],featureRecord:null,choice:{sel:cfg.everywhere.coordinator},
  flag:async()=>{},follow:async()=>{},watchAsks:async()=>{},reset(){}});
 props={space:'space',folder:'/project'};chat.startAgent(null,cx);while(!launches().length)await Bun.sleep(1);
 const native=R.startRole(spec());runRelease();expect(await native).toBe('t1');await Promise.all(work);expect(launches()).toHaveLength(1);
});

test('a configured unavailable account is refused without any fallback launch',async()=>{
 await expect(R.startRole({...spec(),settings:{agent:'codex',profile:'missing'}})).rejects.toThrow();expect(launches()).toHaveLength(0);
});

test('focusing the current task in Terminal preserves its selection and pending approvals',()=>{
 state.set('tasks.thread',{terminal:'worker-one'});tree.active='tasks-thread-term';state.set('approval',{id:'pending',terminal:'worker-one'});
 openTaskThread('worker-one','T-1',null);expect(calls.some(c=>c[1]?.stack==='tasks-thread-body')).toBe(false);
 expect(state.get('approval')).toEqual({id:'pending',terminal:'worker-one'});
});
