import { beforeEach, expect, mock, test } from 'bun:test';
import { fakeHerdr } from './fake-herdr';
import {fakeGpuiKit,fakeGpuiBase} from './fake-gpui';
mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
let calls:any[],ps:any[],ts:any[],ss:any[],rows:any[],state:Map<string,any>;
mock.module('herdr',()=>fakeHerdr({appHome:()=>'/app',home:()=>'/person',spaces:()=>ss,panes:()=>ps,terminals:()=>ts,
 shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),run:(cmd:string,args:any)=>calls.push([cmd,args]),openOverlay:(spec:any)=>calls.push(['overlay',spec]),
 hc:async(args:any)=>{calls.push(['hc',args]);return {code:0,stdout:'{}'}},
 exec:async(bin:string,args:string[])=>{calls.push([bin,args]);if(args[1]==='feature-update'){const p=JSON.parse(args[2]);rows=rows.map(r=>r.id===p.id?{...r,...p}:r);return {code:0,stdout:JSON.stringify(rows.find(r=>r.id===p.id))};}return {code:0,stdout:bin==='herdr-app'?'{"tab":"feature-tab","pane":"feature-pane"}':JSON.stringify({features:rows}),stderr:''};}}));
const {openFeature,featureSettings,startFeature,watchFeatures}=await import('../mods/workspace-launchers/features.js');
beforeEach(()=>{calls=[];ps=[];ts=[];ss=[{id:'space',tabs:[]}];rows=[{...record}];state=new Map();});
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
 expect(calls).toContainEqual(['tab.rename',{id:'old-tab',name:record.name}]);
});
test('a closed view reattaches the same live Feature Assistant',async()=>{
 ts=[{address:'t-feature',state:'live',program:{agent:true},labels:{'herdr.feature':'stable-feature','herdr.role':'feature'}}];
 await openFeature(record);expect(calls.find(c=>c[0]==='hc')[1]).toContain('t-feature');expect(calls.find(c=>c[0]==='hc')[1]).toContain('herdr.chat=feature-pane');
});
test('a stopped feature resumes in its existing pane rather than creating a second tab',async()=>{
 ps=[{pane:'old-pane',mod:'chat',tab:'old-tab'}];ss[0].tabs=[{id:'old-tab',name:'Codex'}];
 state.set('coordinator.slots',{'feature-stable-feature':{space:'space',feature:record.id,pane:'old-pane',tab:'old-tab'}});
 await openFeature({...record,pane:'obsolete-pane'});
 expect(calls.some(c=>c[0]==='herdr-app')).toBe(false);expect(state.get('workspace.feature.resume').record.id).toBe(record.id);
 expect(calls).toContainEqual(['tab.rename',{id:'old-tab',name:record.name}]);
});

function fixture(name='t55') {
 ss[0].tabs=[{id:'current-tab',name,named:false}];ps=[{pane:'current-pane',mod:'chat',tab:'current-tab'}];
 ts=[{address:'fixture-agent',state:'live',program:{agent:true},labels:{'herdr.feature':record.id,'herdr.role':'feature','herdr.chat':'current-pane'}}];
}
async function watcher() {
 const timers=new Map<number,any>(),pending:Promise<any>[]=[];
 const cx:any={timer:{every:(ms:number,f:any)=>timers.set(ms,f)},notify(){},spawn:(f:any)=>{const p=Promise.resolve(f(cx));pending.push(p);return p;}};
 watchFeatures(cx,(e:any)=>{throw e;});await Promise.all(pending);
 return async(ms=2000)=>{timers.get(ms)(cx);await Promise.all(pending);};
}
test('initial load repairs a terminal address even though the durable feature name never changed',async()=>{
 fixture();await watcher();expect(calls).toContainEqual(['tab.rename',{id:'current-tab',name:record.name}]);
 expect(state.get('workspace.features')).toEqual(rows);
});
test('unchanged records repair Codex drift and do not send repeated renames while the host catches up',async()=>{
 fixture();state.set('workspace.features',rows);const tick=await watcher();calls=[];
 ss[0].tabs[0].name='Codex';await tick();expect(calls).toContainEqual(['tab.rename',{id:'current-tab',name:record.name}]);
 calls=[];await tick();await tick();expect(calls.filter(c=>c[0]==='tab.rename')).toEqual([]);
 ss[0].tabs[0]={id:'current-tab',name:record.name,named:true};await tick();calls=[];
 ss[0].tabs[0].name='t55';await tick();expect(calls.filter(c=>c[0]==='tab.rename')).toHaveLength(1);
});
test('a feature rename follows current identity, never the obsolete stored tab',async()=>{
 fixture();ss[0].tabs.push({id:'obsolete-tab',name:'My terminal',named:true});ps.push({pane:'obsolete-pane',tab:'obsolete-tab',terminal:'shell'});
 state.set('workspace.features',rows);rows=[{...record,tab:'obsolete-tab',pane:'obsolete-pane',name:'Renamed feature'}];
 await watcher();expect(calls.filter(c=>c[0]==='tab.rename')).toEqual([['tab.rename',{id:'current-tab',name:'Renamed feature'}]]);
});
test('reopening a stale saved binding creates a feature view instead of claiming an unrelated chat',async()=>{
 ss[0].tabs=[{id:'unrelated-tab',name:'Manual name'}];ps=[{pane:'reused-pane',mod:'chat',tab:'unrelated-tab'}];
 await openFeature({...record,tab:'unrelated-tab',pane:'reused-pane'});
 expect(calls.some(c=>c[0]==='herdr-app')).toBe(true);expect(calls.some(c=>c[0]==='pane.focus'&&c[1].pane==='reused-pane')).toBe(false);
 expect(calls.filter(c=>c[0]==='tab.rename')).toEqual([]);
});
test('feature Rename requests change the canonical name before any tab reconciliation',async()=>{
 fixture();const tick=await watcher();calls=[];
 state.set('workspace.feature.request',{rename:{id:record.id,name:'New feature name'},nonce:1,at:Date.now()});await tick(150);
 expect(rows[0].name).toBe('New feature name');expect(state.get('workspace.features')[0].name).toBe('New feature name');
 expect(calls).toContainEqual(['tab.rename',{id:'current-tab',name:'New feature name'}]);
 expect(calls.some(c=>c[0]==='herdr-app')).toBe(false);
});

test('Feature Assistant account choices override the Assistant account, including an explicit primary account',()=>{
 const base={agent:'codex',profile:'codex-account-2',model:'gpt-model'};
 expect(featureSettings({coordinator:base})).toEqual(base);
 expect(featureSettings({coordinator:base,feature:{agent:'codex',model:'other'}})).toEqual({agent:'codex',model:'other'});
 expect(featureSettings({coordinator:{agent:'codex'},feature:base}).profile).toBe('codex-account-2');
});

test('Start feature uses a compact form instead of the launcher-manager dimensions',()=>{
 startFeature(ss[0]);expect(calls).toContainEqual(['overlay',expect.objectContaining({mod:'workspace-launchers',kind:'dialog',frame:'none',width:460,height:240,props:{mode:'feature',space:'space'}})]);
});
