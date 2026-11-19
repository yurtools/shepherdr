import { div } from 'gpui-kit';
import { v_flex, h_flex, TextareaState, Textarea } from 'gpui-base';
import { segmented, button } from './ui.js';
import { APPROVAL_MODES, approvalDialog } from './approval.js';
const DEFAULT='Approve only reversible local work inside the stated project that is necessary for the user’s task. Ask me about publishing, deployment, financial actions, credential access, destructive data changes, changes outside the project, or unclear intent.';
const value=(view,key,fallback)=>view.chain('approvals',key).find(x=>x.value!==undefined&&x.value!==null)?.value??fallback;
export function approvalsInit(view,cx){
 view.approvalBox=TextareaState.new({placeholder:DEFAULT});view.approvalBox.set_auto_grow(3,8);view.approvalGeneration=0;
 view.approvalBox.on('change',(_e,cx)=>{if(view.approvalBoxScope!==(view.scope??'everywhere'))return;if(view.approvalBox.value().trim()===String(value(view,'policy','')).trim())return;const gen=++view.approvalGeneration,scope=view.scope;cx.timer.after(600,cx=>{if(gen!==view.approvalGeneration||scope!==view.scope)return;view.set('approvals','policy',view.approvalBox.value().trim()||null,cx);});});
}
export function approvalsSection(view,t,cx){
 const key=view.scope??'everywhere',rawPolicy=value(view,'policy',''),policy=typeof rawPolicy==='string'?rawPolicy:'';
 if(view.approvalScope!==key){view.approvalScope=key;view.approvalGeneration++;cx.timer.after(0,cx=>{if((view.scope??'everywhere')!==key)return;view.approvalBox.set_value(policy);view.approvalBoxScope=key;cx.notify();});}
 const choices=(field,inherit=false)=>segmented(`approval-mode-${field}`,[...(inherit?[['inherit','Default']]:[]),...APPROVAL_MODES.map(([id,label])=>[id,label,{disabled:id==='codex-review'&&field!=='mode'&&Boolean(view.roles?.[field]?.sel?.agent)&&view.roles[field].sel.agent!=='codex'}])],value(view,field,inherit?'inherit':'manual'),(mode,_e,cx)=>view.set('approvals',field,mode,cx));
 return v_flex().gap(4)
  .child(div().pt(18).pb(6).text_size(15).font_semibold().child('Approvals'))
  .child(view.row(t,'Default approval mode','Separate from execution Permissions. Ask me pauses saved rules; choosing Allow for this task activates its grants only.',choices('mode'),view.scoped('approvals','mode')))
  .children([['coordinator','Assistant'],['feature','Features'],['worker','Workers'],['reviewer','Reviewer']].map(([field,label])=>view.row(t,`${label} approvals`,'Inherit the default or choose how this role’s permission requests are resolved.',choices(field,true),view.scoped('approvals',field))))
  .child(view.row(t,'Review policy','What the Assistant is allowed to approve. Unknown or unclear actions should reach you.',null,view.scoped('approvals','policy'),Textarea.new(view.approvalBox).w_full()))
  .child(h_flex().gap(8).py(10)
    .child(button('approval-rules','Manage rules…',{onClick:()=>approvalDialog('rules',null,view.scope)}))
    .child(button('approval-history','Approval history…',{onClick:()=>approvalDialog('history',null,view.scope)})))
  .child(div().text_size(11).text_color(t.dim).child('Rules and history are local to this computer. Global / Everywhere rules cross accounts and folders; other scopes keep those boundaries. The Assistant reviews other agents, never itself. Codex Auto-review uses an interactive sandbox on new or restarted Codex agents and keeps read-only restrictions. Autopilot is independent.'));
}

export function approvalsFlush(view){
 if(!view.approvalBox||view.approvalBoxScope!==(view.scope??'everywhere'))return Promise.resolve();
 const text=view.approvalBox.value().trim(),scope=view.scope,current=String(value(view,'policy','')).trim();
 if(text===current)return Promise.resolve();
 view.approvalGeneration++;
 return view.apply(next=>{const target=view.target(next,scope);if(text)target.approvals={...(target.approvals??{}),policy:text};else view.drop(target,'approvals','policy');});
}
