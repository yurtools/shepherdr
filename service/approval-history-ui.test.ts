import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {element} from './fake-gpui';
import * as ruleUI from '../core/approval-history.js';
const src=readFileSync(new URL('../mods/workspace-approvals/main.js',import.meta.url),'utf8');
function fixture(info:any={context:{account:'Account 2',cwd:'/original'},tool:'Bash',words:['git','status'],suggested_prefix:'git status'}){
 const buttons:any[]=[],calls:any[]=[];let task=Promise.resolve();
 const klass=src.slice(src.indexOf('export default class')).replace('export default ','');
 const segments:any[]=[];
 const C=new Function('View','div','v_flex','h_flex','Input','button','segmented','approvalCall','props','closeOverlay','plainError',...Object.keys(ruleUI),'theme',`return ${klass}`)(class{},()=>element(),()=>element(),()=>element(),{new:()=>element()},(id:any,label:any,opts:any)=>{buttons.push({id,label,opts});return element()},(id:any,opts:any,value:any,pick:any)=>{segments.push({id,opts,value,pick});return element()},async(...a:any[])=>{calls.push(a);return info},()=>({}),()=>calls.push(['close']),String,...Object.values(ruleUI),()=>({}));
 const v:any=new C();v.mode='history';v.prefix={set_value(x:any){this.text=x},value(){return this.text??''}};v.rows=[];v.load=()=>{};
 const cx:any={spawn:(fn:any)=>{task=fn(cx)},notify(){}};
 return {v,cx,buttons,calls,segments,wait:()=>task};
}
test('a history rule uses the historic ID and never sends an answer to the old approval',async()=>{
 const {v,cx,buttons,calls,wait}=fixture();v.chooseHistory({id:'historic',decision:'deny'},cx);await wait();
 expect(calls).toEqual([['history-inspect',['--id','historic']]]);expect(v.mode).toBe('history-grant');expect(v.decision).toBe('deny');
 v.hours=24;v.grantForm({},cx);const save=buttons.find(b=>b.id==='approval-save-rule');expect(save.label).toBe('Save rule for future requests');
 save.opts.onClick(null,cx);await wait();const request=calls.find(c=>c[0]==='history-grant');
 expect(request[1]).toContain('historic');expect(request[1]).not.toContain('--request');expect(request[1]).not.toContain('--respond');expect(calls.some(c=>c[0]==='close')).toBe(false);
 expect(v.mode).toBe('history');
});
test('history shows readable sources and a create-rule action beside each row',()=>{
 const {v,cx,buttons}=fixture();v.rows=[{id:'old',source:'rule',decision:'allow',command:'git status',reason:'task exact rule abc'}];v.render(cx);
 expect(buttons.find(b=>b.id==='history-rule-0').label).toBe('Create rule…');
});
test('Global and Forever are explicit, with Forever immediately after one year',async()=>{
 const f=fixture();f.v.chooseHistory({id:'old'},f.cx);await f.wait();f.v.grantForm({},f.cx);
 expect(f.segments.find(s=>s.id==='approval-scope').opts).toContainEqual(['global','Global / Everywhere']);
 const expiry=f.segments.find(s=>s.id==='approval-expiry');expect(expiry.opts.slice(-2)).toEqual([[8760,'1 year'],[0,'Forever']]);
 expiry.pick(0,null,f.cx);f.v.scope='global';f.buttons.find(b=>b.id==='approval-save-rule').opts.onClick(null,f.cx);await f.wait();
 expect(f.calls.find(c=>c[0]==='history-grant')[1]).toEqual(expect.arrayContaining(['--scope','global','--hours','0']));
 expect(ruleUI.approvalRuleLifetime({expires:0})).toBe('Forever');
 expect(ruleUI.approvalRuleScope({scope:'global',inherited:true})).toContain('inherited in this space');
});
test('named tool any-arguments is an explicit match and retains the full tool identity',async()=>{
 const tool='mcp__openmemory__openmemory_store_project',f=fixture({tool,tool_wide:true,context:{account:'A',cwd:'/p'},words:null});
 f.v.chooseHistory({id:'tool'},f.cx);await f.wait();f.v.grantForm({},f.cx);
 expect(f.segments.find(s=>s.id==='approval-match').opts).toContainEqual(['tool','This tool · any arguments']);
 expect(f.segments.find(s=>s.id==='approval-scope').opts).toHaveLength(1);
 f.segments.find(s=>s.id==='approval-match').pick('tool',null,f.cx);f.segments.length=0;f.v.grantForm({},f.cx);
 expect(f.segments.find(s=>s.id==='approval-scope').opts).toHaveLength(4);
 f.v.scope='global';f.segments.find(s=>s.id==='approval-match').pick('exact',null,f.cx);expect(f.v.scope).toBe('task');
 expect(ruleUI.approvalRuleTitle({tool,match:'tool',decision:'allow'})).toContain('openmemory_store_project · any arguments');
});
test('stage selection submits only the selected stage and its own prefix',async()=>{
 const f=fixture({tool:'Bash',context:{account:'A',cwd:'/p'},words:['git','status'],stages:[['git','status'],['timeout','50s','hc','wait']],stage_prefixes:['git status','timeout 50s hc wait'],stage_commands:['git status','timeout 50s hc wait'],stage:0});
 f.v.chooseHistory({id:'pipeline'},f.cx);await f.wait();f.v.grantForm({},f.cx);
 f.buttons.find(b=>b.id==='approval-stage-1').opts.onClick(null,f.cx);expect(f.v.prefix.value()).toBe('timeout 50s hc wait');expect(f.v.info.words[0]).toBe('timeout');
 f.buttons.length=0;f.v.grantForm({},f.cx);f.buttons.find(b=>b.id==='approval-save-rule').opts.onClick(null,f.cx);await f.wait();
 expect(f.calls.find(c=>c[0]==='history-grant')[1]).toEqual(expect.arrayContaining(['--stage','1','--prefix','timeout 50s hc wait']));
});
