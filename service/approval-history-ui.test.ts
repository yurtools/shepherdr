import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {element} from './fake-gpui';
import {approvalOrigin,approvalDecision} from '../core/approval-history.js';
const src=readFileSync(new URL('../mods/workspace-approvals/main.js',import.meta.url),'utf8');
function fixture(){
 const buttons:any[]=[],calls:any[]=[];let task=Promise.resolve();
 const klass=src.slice(src.indexOf('export default class')).replace('export default ','');
 const C=new Function('View','div','v_flex','h_flex','Input','button','segmented','approvalCall','props','closeOverlay','plainError','approvalOrigin','approvalDecision','theme',`return ${klass}`)(class{},()=>element(),()=>element(),()=>element(),{new:()=>element()},(id:any,label:any,opts:any)=>{buttons.push({id,label,opts});return element()},()=>element(),async(...a:any[])=>{calls.push(a);return {context:{account:'Account 2',cwd:'/original'},words:['git','status'],suggested_prefix:'git status'}},()=>({}),()=>calls.push(['close']),String,approvalOrigin,approvalDecision,()=>({}));
 const v:any=new C();v.mode='history';v.prefix={set_value(x:any){this.text=x},value(){return this.text??''}};v.rows=[];v.load=()=>{};
 const cx:any={spawn:(fn:any)=>{task=fn(cx)},notify(){}};
 return {v,cx,buttons,calls,wait:()=>task};
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
