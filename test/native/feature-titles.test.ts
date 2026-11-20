import {beforeEach,expect,mock,test} from 'bun:test';
import {fakeHerdr} from '../../service/fake-herdr';
import {fakeGpuiKit,fakeGpuiBase,built,byId} from '../../service/fake-gpui';
let ps:any[],ts:any[],ss:any[],state:Map<string,any>,actions:any[],viewProps:any,reads:Record<string,number>,work:Promise<any>[];
mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
mock.module('herdr',()=>fakeHerdr({
 spaces:()=>{reads.spaces++;return ss;},panes:()=>{reads.panes++;return ps;},terminals:()=>{reads.terminals++;return ts;},machines:()=>[],agents:()=>[],
 shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),props:()=>viewProps,
 theme:()=>new Proxy({},{get:()=> '#444444'}),settings:()=>({zoom:1}),layout:()=>({}),window:()=>({platform:'linux'}),home:()=>'/fixture',
 focused:()=>({pane:ps[0]?.pane,tab:'tab'}),run:(...a:any[])=>actions.push(a),openOverlay:(p:any)=>actions.push(['overlay',p]),closeOverlay:()=>{},
 hc:async(args:string[])=>{actions.push(['hc',args]);if(args[0]==='label')for(const label of args.slice(2)){const i=label.indexOf('=');ts[0].labels[label.slice(0,i)]=label.slice(i+1);}return {code:0,stdout:'{}'};},
 exec:async(bin:string,args:string[])=>{
  if(bin==='sh')return {code:0,stdout:'{}'};
  const cmd=args[1];actions.push([cmd,args]);
  if(cmd==='pane.split'){ps.push({pane:'replacement-chat',mod:'chat',tab:'tab'});return {code:0,stdout:'{"pane":"replacement-chat"}'};}
  if(cmd==='terminal.keep'){ps.push({pane:'replacement-terminal',terminal:'fixture-agent',tab:'tab'});return {code:0,stdout:'{"pane":"replacement-terminal"}'};}
  if(cmd==='terminal.park')ps=ps.filter(p=>!p.terminal);
  if(cmd==='pane.close')ps=ps.filter(p=>p.pane!==args[3]);
  return {code:0,stdout:'{}'};
 }
}));
const {default:Tabs}=await import('../../mods/tabs-tasks/main.js');
const {default:Pane}=await import('../../mods/pane-chat/main.js');
const {default:Prompt}=await import('../../mods/prompt-chat/main.js');
const {renameTab}=await import('../../mods/tabs-tasks/coordinator.js');
const rec={id:'fixture-feature',space:'space',name:'Feature tab title consistency',folder:'/fixture'};
beforeEach(()=>{
 ss=[{id:'space',active:true,tabs:[{id:'tab',active:true,name:'t55',named:false}]}];ps=[{pane:'chat',mod:'chat',tab:'tab'}];
 ts=[{address:'fixture-agent',state:'live',program:{agent:true,name:'Codex'},status:'idle',labels:{'herdr.role':'feature','herdr.feature':rec.id,'herdr.chat':'chat'}}];
 state=new Map<string,any>([['workspace.features',[rec]],['addons.off',['autopilot']],['counts.red',false],['counts.green',false]]);
 actions=[];viewProps={pane:'chat'};reads={spaces:0,panes:0,terminals:0};work=[];built.length=0;
});
const text=(e:any):string=>typeof e==='string'?e:(e?.kids??[]).map(text).join(' ');
function drawTabs(){built.length=0;const v:any=Object.create(Tabs.prototype);v.syncPanel=()=>{};v.render(cx);return text(byId('tab-tab'));}
const cx:any={notify(){},spawn:(f:any)=>{const p=Promise.resolve(f(cx));work.push(p);return p;},timer:{after(){}}};
test('the real tab and pane render methods agree through host title, status and program changes without render-time renames',()=>{
 for(const name of ['t55','Codex','tb3','Manual host drift'])for(const status of ['idle','working','blocked','done']) {
  ss[0].tabs[0].name=name;ts[0].status=status;ts[0].program.name=status==='working'?'Working CLI':'Codex';
  reads={spaces:0,panes:0,terminals:0};expect(drawTabs()).toContain(rec.name);
  expect(reads).toEqual({spaces:1,panes:1,terminals:1});
  built.length=0;const v:any=Object.create(Pane.prototype);expect(text(v.render(cx))).toContain(rec.name);
 }
 expect(actions.filter(a=>a[0]==='tab.rename'||a[0]==='feature-update')).toEqual([]);
});
test('ordinary manual names, terminal addresses and automatic program naming keep their existing meanings',()=>{
 ts[0].labels={'herdr.chat':'chat'};
 for(const [name,expected] of [['t55','t55'],['Codex','Codex'],['My shell','My shell'],['tb3','Terminal']]) {
  ss[0].tabs[0].name=name;expect(drawTabs().trim()).toBe(expected);
 }
 ts[0].labels={'herdr.chat':'chat','herdr.feature':rec.id,'herdr.task':'JOB-1'};ss[0].tabs[0].name='Worker name';expect(drawTabs()).toContain('Worker name');
});
test('Chat/Terminal swaps retain feature slot and props so a recreated chat remains resumable',async()=>{
 state.set('coordinator.slots',{[`feature-${rec.id}`]:{...rec,feature:rec.id,tab:'tab',pane:'chat'}});
 const v:any=Object.create(Pane.prototype);v.toTerminal('chat',cx);await Promise.all(work);
 expect(state.get('coordinator.slots')[`feature-${rec.id}`]).toMatchObject({pane:'replacement-terminal',tab:'tab',feature:rec.id});
 viewProps={pane:'replacement-terminal'};expect(text(v.render(cx))).toContain(rec.name);expect(drawTabs()).toContain(rec.name);
 v.busy=false;v.toChat(ps[0],cx);await Promise.all(work);
 const split=actions.find(a=>a[0]==='pane.split');const props=JSON.parse(split[1][split[1].indexOf('--props')+1]);
 expect(props).toMatchObject({feature:rec.id,role:'feature',slot:`feature-${rec.id}`,featureRecord:rec});
 expect(state.get('coordinator.slots')[`feature-${rec.id}`]).toMatchObject({pane:'replacement-chat',tab:'tab'});
 ts=[];viewProps={pane:'replacement-chat'};expect(text(v.render(cx))).toContain(rec.name);expect(drawTabs()).toContain(rec.name);
});
test('Rename edits the durable feature while an ordinary tab still uses the host rename command',()=>{
 renameTab(ss[0].tabs[0]);viewProps=actions.at(-1)[1].props;expect(viewProps).toMatchObject({title:'Rename feature',feature:rec.id,value:rec.name});
 const p:any=Object.create(Prompt.prototype);p.text='New feature title';p.submit();expect(state.get('workspace.feature.request').rename).toEqual({id:rec.id,name:'New feature title'});
 ts[0].labels={};state.set('coordinator.slots',{});actions=[];renameTab(ss[0].tabs[0]);viewProps=actions.at(-1)[1].props;
 expect(viewProps.title).toBe('Rename tab');p.text='Manual tab';p.submit();expect(actions.at(-1)).toEqual(['tab.rename',{id:'tab',name:'Manual tab'}]);
});
