import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from './fake-herdr';
import { fakeGpuiBase, fakeGpuiKit, element, built, byId, handler } from './fake-gpui';
const state=new Map();let writes:any[]=[];
mock.module('herdr',()=>fakeHerdr({theme:()=>new Proxy({},{get:()=> '#111111'}),settings:()=>({}),shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),props:()=>({}),appHome:()=>'/test-app',exec:async()=>({code:0,stdout:'{"rows":[]}',stderr:''})}));
mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
const { approvalsInit, approvalsSection, approvalsFlush }=await import('../mods/shepherdr-settings/approval-section.js');
const { rememberedControls }=await import('../mods/chat/approval-cards.js');
const { default: Approvals }=await import('../mods/workspace-approvals/main.js');
beforeEach(()=>{state.clear();writes=[];built.length=0;});
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
});
test('the approval manager holds and releases dialog keyboard ownership',()=>{
 const c:any=new Approvals(),cx:any={focus_handle:()=>({focus(){}}),spawn(){},timer:{every(){}}};c.init({},cx);expect(state.get('keyboard.holder').who).toContain('dialog:approvals:');c.close();expect(state.get('keyboard.holder').who).toBeNull();
});

test('closing immediately saves review policy to its captured space, without saving stale scope text',async()=>{
 let saved:any;const view:any={scope:'first',approvalBoxScope:'first',approvalGeneration:0,approvalBox:{value:()=> 'Only local tests'},chain:()=>[{value:''}],target(next:any,scope:string){return(next.spaces[scope]??={})},drop(){},apply:async(fn:any)=>{const next:any={spaces:{}};await Promise.resolve();fn(next);saved=next;}};
 const done=approvalsFlush(view);view.scope='second';await done;expect(saved.spaces.first.approvals.policy).toBe('Only local tests');expect(saved.spaces.second).toBeUndefined();saved=null;await approvalsFlush(view);expect(saved).toBeNull();
});
