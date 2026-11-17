import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from './fake-herdr';
import {fakeGpuiKit,fakeGpuiBase} from './fake-gpui';
mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
let calls:any[],ps:any[],ts:any[],ss:any[],state:Map<string,any>;
mock.module('herdr',()=>fakeHerdr({appHome:()=>'/app',home:()=>'/person',spaces:()=>ss,panes:()=>ps,terminals:()=>ts,
 shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),run:(cmd:string,args:any)=>calls.push([cmd,args]),
 hc:async(args:any)=>{calls.push(['hc',args]);return {code:0,stdout:'{}'}},
 exec:async(bin:string,args:string[])=>{calls.push([bin,args]);return {code:0,stdout:bin==='herdr-app'?'{"tab":"feature-tab","pane":"feature-pane"}':'{}',stderr:''};}}));
const {openFeature,featureSettings}=await import('../mods/workspace-launchers/features.js');
beforeEach(()=>{calls=[];ps=[];ts=[];ss=[{id:'space',tabs:[]}];state=new Map();});
const record:any={id:'stable-feature',space:'space',name:'Browser tabs',folder:'/repo',settings:{agent:'codex',profile:'account-two'},session:'saved-id',home:'/account-two',argv:['env','CODEX_HOME=/account-two','codex']};
test('a feature opens with its persistent identity, original account and resumable record',async()=>{
 await openFeature(record);
 const args=JSON.parse(calls.find(c=>c[0]==='herdr-app')[1][2]);
 expect(args).toMatchObject({space:'space',mod:'chat',props:{role:'feature',feature:'stable-feature',settings:{profile:'account-two'},featureRecord:{session:'saved-id',home:'/account-two'}}});
 expect(state.get('coordinator.slots')['feature-stable-feature']).toMatchObject({feature:'stable-feature',pane:'feature-pane'});
});
test('clicking a running feature focuses its existing view without launching a duplicate',async()=>{
 ts=[{address:'t-feature',state:'live',program:{agent:true},labels:{'herdr.feature':'stable-feature','herdr.role':'feature','herdr.chat':'p-feature'}}];
 ps=[{pane:'p-feature',mod:'chat',tab:'old-tab'}];ss[0].tabs=[{id:'old-tab'}];
 await openFeature(record);expect(calls.some(c=>c[0]==='herdr-app')).toBe(false);expect(calls).toContainEqual(['pane.focus',{pane:'p-feature'}]);
});
test('a closed view reattaches the same live Feature Assistant',async()=>{
 ts=[{address:'t-feature',state:'live',program:{agent:true},labels:{'herdr.feature':'stable-feature','herdr.role':'feature'}}];
 await openFeature(record);expect(calls.find(c=>c[0]==='hc')[1]).toContain('t-feature');expect(calls.find(c=>c[0]==='hc')[1]).toContain('herdr.chat=feature-pane');
});
test('a stopped feature resumes in its existing pane rather than creating a second tab',async()=>{
 ps=[{pane:'old-pane',mod:'chat',tab:'old-tab'}];ss[0].tabs=[{id:'old-tab'}];await openFeature({...record,pane:'old-pane'});
 expect(calls.some(c=>c[0]==='herdr-app')).toBe(false);expect(state.get('workspace.feature.resume').record.id).toBe(record.id);
});

test('Feature Assistant account choices override the Assistant account, including an explicit primary account',()=>{
 const base={agent:'codex',profile:'codex-account-2',model:'gpt-model'};
 expect(featureSettings({coordinator:base})).toEqual(base);
 expect(featureSettings({coordinator:base,feature:{agent:'codex',model:'other'}})).toEqual({agent:'codex',model:'other'});
 expect(featureSettings({coordinator:{agent:'codex'},feature:base}).profile).toBe('codex-account-2');
});
