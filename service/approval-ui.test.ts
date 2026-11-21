import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from './fake-herdr';
import { fakeGpuiBase, fakeGpuiKit, element, built, byId, handler } from './fake-gpui';
const state=new Map();let writes:any[]=[],notices:any[]=[],approvalResult:any={rows:[]},commands:any[]=[];
mock.module('herdr',()=>fakeHerdr({theme:()=>new Proxy({},{get:()=> '#111111'}),settings:()=>({}),shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),props:()=>({}),appHome:()=>'/test-app',notify:(n:any)=>notices.push(n),exec:async(...args:any[])=>{commands.push(args);return{code:0,stdout:JSON.stringify(approvalResult),stderr:''}}}));
mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
const { approvalsInit, approvalsSection, approvalsFlush }=await import('../mods/shepherdr-settings/approval-section.js');
const { rememberedControls }=await import('../mods/chat/approval-cards.js');
const { AskCards }=await import('../mods/chat/cards.js');
const { words, permissionStatus, requestHash }=await import('../core/asks.js');
const { strip }=await import('../mods/chat/strips.js');
const { default: Approvals }=await import('../mods/workspace-approvals/main.js');
beforeEach(()=>{state.clear();writes=[];notices=[];commands=[];approvalResult={rows:[]};built.length=0;});
test('Agents exposes a manual default plus role overrides without changing settings on render',()=>{
 const cx:any={timer:{after(){}}};const view:any={scope:null,chain(_section:string,key:string){return[{value:key==='mode'?'manual':key==='policy'?'':undefined}]},scoped(){return{}},set(...args:any[]){writes.push(args)},row(_t:any,title:string,_about:any,control:any,_scope:any,below:any){return element().child(title).when(Boolean(control),(e:any)=>e.child(control)).when(Boolean(below),(e:any)=>e.child(below))}};
 approvalsInit(view,cx);approvalsSection(view,{dim:'#111'},cx);expect(writes).toEqual([]);
 expect(byId('approval-mode-mode-manual')).toBeDefined();expect(byId('approval-mode-worker-inherit')).toBeDefined();
 handler(byId('approval-mode-worker-assistant'),'on_click')!({}, {stop_propagation(){},notify(){}});
 expect(writes[0].slice(0,3)).toEqual(['approvals','worker','assistant']);
});
test('remembered execution grants are absent for plans/questions and bind the requesting terminal',()=>{
 const host={terminal:()=> 'requester'};
 expect(rememberedControls({id:'id',words:{kind:'plan'}},host)).toEqual([]);
 expect(rememberedControls({id:'id',words:{kind:'questions'}},host)).toEqual([]);
 const controls=rememberedControls({id:'id',words:{kind:'permission'},req:{tool_input:{command:'git status'}}},host);
 expect(controls.map((x:any)=>x.label)).toEqual(['Allow for this task','Create rule…','Ask Assistant']);
 const remote=rememberedControls({id:'id',machine:'remote',words:{kind:'permission'}},host);expect(remote.every((x:any)=>x.disabled)).toBe(true);
 const named=rememberedControls({id:'id',words:{kind:'permission'},req:{tool_name:'mcp__openmemory__openmemory_store_project',tool_input:{content:'test'}}},host);
 expect(named.find((c:any)=>c.label==='Create rule…')?.disabled).toBe(false);
});
test('Ask Assistant button delegates the original request through the explicit helper route',async()=>{
 const ask={id:'worker.123.4',terminal:'worker',words:{kind:'permission'},req:{tool_name:'Bash',tool_input:{command:'git status | wc -l'}}};
 const review=rememberedControls(ask,{terminal:()=> 'assistant'}).find((c:any)=>c.label==='Ask Assistant')!;
 approvalResult={action:'wait',reason:'Requesting Assistant review.'};
 await review.fn({spawn:async(fn:any)=>fn({notify(){}})});
 expect(commands).toHaveLength(1);
 expect(commands[0].slice(0,2)).toEqual(['python3',['/test-app/mods/chat/approval-policy.py','review','--request','/test-app/data/chat-asks/req/worker.123.4.json','--terminal','worker']]);
 const req=ask.req,approval=permissionStatus(req,{version:1,request_hash:requestHash(req),state:'person',reason:'assistant-asked',review_reason:'The script destination is unknown. Please choose.'})!;
 const cards=new AskCards({reply(){}},{}),strips:any[]=cards.strips({...ask,approval});
 expect(strips.find((s:any)=>s.key==='status-detail')?.text).toBe(approval.detail);
 expect(strips.find((s:any)=>s.key==='actions').ctls.map((c:any)=>c.label)).toEqual(['Allow once','Deny','Advice']);
});

test('native permission strips keep visible status, distinct icons and manual keyboard actions',()=>{
 const replies:any[]=[],req={tool_name:'Bash',tool_input:{command:'git status'}},ask:any={id:'card',req,words:words(req)};
 const cards=new AskCards({reply:(_a:any,text:string)=>replies.push(text)},{});
 for(const state of ['checking','assistant','person']){
  ask.approval=permissionStatus(req,{version:1,request_hash:requestHash(req),state,reason:'no-rule'});
  const strips:any[]=cards.strips(ask),status=strips.find((s:any)=>s.kind==='status');expect(status.text).toBe(ask.approval.text);expect(strips[0].neutral).toBe(true);
  built.length=0;strip({muted:'#888'},status,false,false);
  expect(built.some((e:any)=>e.calls.some(([n,a]:any)=>n==='text_color'&&a[0]===(state==='person'?'#f5b544':'#888')))).toBe(true);
  expect(strips.find((s:any)=>s.key==='actions').ctls.map((c:any)=>c.label)).toEqual(['Allow once','Deny','Advice']);
 }
 cards.key(ask,{key:'escape'},{stop_propagation(){},notify(){}});expect(JSON.parse(replies[0]).hookSpecificOutput.decision.behavior).toBe('deny');
 const plan={id:'plan',req:{tool_name:'ExitPlanMode'},words:{kind:'plan',title:'Plan',detail:''}};
 expect(cards.strips(plan).some((s:any)=>s.kind==='status')).toBe(false);
});
test('the approval manager holds and releases dialog keyboard ownership',()=>{
 const c:any=new Approvals(),cx:any={focus_handle:()=>({focus(){}}),spawn(){},timer:{every(){}}};c.init({},cx);expect(state.get('keyboard.holder').who).toContain('dialog:approvals:');c.close();expect(state.get('keyboard.holder').who).toBeNull();
});
test('task pipeline grants toast the returned deny or pending outcome, never an invented allow',async()=>{
 for(const action of ['deny','wait','allow']){
  notices=[];approvalResult={action,reason:'Actual pipeline result'};
  const controls=rememberedControls({id:'fixture',words:{kind:'permission'},req:{tool_name:'Bash',tool_input:{command:'git status | wc -l'}}},{terminal:()=> 'fixture'});
  await controls[0].fn({spawn:async(fn:any)=>fn({notify(){}})});
  expect(notices[0].title).toBe(action==='deny'?'Request denied by a saved rule':action==='wait'?'Rules saved · request still waiting':'Allowed for this task/session');
  expect(notices[0].body).toBe('Actual pipeline result');
 }
});

test('closing immediately saves review policy to its captured space, without saving stale scope text',async()=>{
 let saved:any;const view:any={scope:'first',approvalBoxScope:'first',approvalGeneration:0,approvalBox:{value:()=> 'Only local tests'},chain:()=>[{value:''}],target(next:any,scope:string){return(next.spaces[scope]??={})},drop(){},apply:async(fn:any)=>{const next:any={spaces:{}};await Promise.resolve();fn(next);saved=next;}};
 const done=approvalsFlush(view);view.scope='second';await done;expect(saved.spaces.first.approvals.policy).toBe('Only local tests');expect(saved.spaces.second).toBeUndefined();saved=null;await approvalsFlush(view);expect(saved).toBeNull();
});
