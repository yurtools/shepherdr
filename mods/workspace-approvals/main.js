import { View, div } from 'gpui-kit';
import { v_flex, h_flex, Input, InputState } from 'gpui-base';
import { props, theme, appHome, closeOverlay } from 'herdr';
import { approvalCall, APPROVAL_MODES } from './approval.js';
import { button, segmented, plainError } from './ui.js';
import { keepKeys, dropKeys } from './keyholder.js';
import { approvalOrigin, approvalDecision } from './core/approval-history.js';
export default class Approvals extends View {
 init(_props,cx){
  this.rows=[];this.mode=props()?.mode??'rules';this.scope='task';this.match='exact';this.hours=1;this.decision='allow';this.error=null;
  this.holder=`dialog:approvals:${props()?.overlay??'manager'}`;keepKeys(this.holder);cx.timer.every(1500,()=>keepKeys(this.holder));
  this.handle=cx.focus_handle();this.handle.focus();this.prefix=InputState.new({placeholder:'Command prefix, for example git status'});this.prefix.on('change',(_e,cx)=>cx.notify());
  this.load(cx);
 }
 args(){const p=props()??{};return['--request',`${appHome()}/data/chat-asks/req/${p.id}.json`,...(p.terminal?['--terminal',p.terminal]:[])];}
 chooseHistory(row,cx){if(this.busy)return;this.busy=true;cx.spawn(async cx=>{try{
  this.info=await approvalCall('history-inspect',['--id',row.id]);this.historyId=row.id;this.mode='history-grant';
  this.scope='task';this.match='exact';this.decision=['allow','deny'].includes(row.decision)?row.decision:'allow';
  this.prefix.set_value(this.info.suggested_prefix??'');this.error=null;
 }catch(e){this.error=plainError(e);}this.busy=false;cx.notify();});}
 backToHistory(cx){this.mode='history';this.info=null;this.error=null;this.load(cx);}
 load(cx){this.loading=true;cx.spawn(async cx=>{try{const p=props()??{};if(this.mode==='grant'){this.info=await approvalCall('inspect',this.args());this.prefix.set_value(this.info.suggested_prefix??(this.info.words??[]).slice(0,2).join(' '));}else{this.rows=(await approvalCall(this.mode==='history'?'history':'list',p.space?['--space',p.space]:[])).rows.reverse();}this.error=null;}catch(e){this.error=plainError(e);}this.loading=false;cx.notify();});}
 action(command,args,cx){if(this.busy)return;this.busy=true;cx.spawn(async cx=>{try{await approvalCall(command,args);if(command==='grant')closeOverlay(props()?.overlay);else if(command==='history-grant'){this.notice='Rule saved for future matching requests.';this.backToHistory(cx);}else this.load(cx);this.error=null;}catch(e){this.error=plainError(e);}this.busy=false;cx.notify();});}
 render(cx){const p=props()??{},t=theme();return v_flex().id('approval-manager').track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
  .on_key_down(e=>{if(e.key==='escape')closeOverlay(p.overlay);})
  .child(h_flex().items_center().gap(10).child(div().flex_1().font_semibold().text_size(17).child(this.mode==='history-grant'?'Create rule from history':this.mode==='grant'?'Remember this approval':this.mode==='history'?'Approval history':'Approved command rules'))
    .child(button('approval-close','×',{kind:'plain',onClick:()=>closeOverlay(p.overlay)})))
  .when(this.loading,el=>el.child(div().text_color(t.dim).child('Loading…')))
  .when(Boolean(this.error),el=>el.child(div().p(8).text_size(12).text_color(t.blocked).child(this.error)))
  .when(Boolean(this.notice),el=>el.child(div().text_size(12).text_color(t.muted).child(this.notice)))
  .when(['grant','history-grant'].includes(this.mode)&&Boolean(this.info),el=>el.child(this.grantForm(t,cx)))
  .when(!['grant','history-grant'].includes(this.mode),el=>el
   .child(h_flex().gap(8).child(button('approval-refresh','Refresh',{kind:'plain',onClick:(_e,cx)=>this.load(cx)}))
    .when(this.mode==='history',el=>el.child(button('approval-clear-history','Clear history',{kind:'plain',onClick:(_e,cx)=>this.action('clear-history',[],cx)}))))
   .child(v_flex().id('approval-rows').flex_1().min_h(0).overflow_y_scroll().gap(8)
    .children(this.rows.map((row,i)=>v_flex().p(10).gap(5).rounded(7).border_1().border_color(t.border)
     .child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).text_size(12).child(this.mode==='history'?`${approvalDecision(row)} · ${row.command}`:`${row.decision} · ${(row.pattern??[]).join(' ')}${row.match==='prefix'?' …':''}`))
      .when(this.mode==='history',el=>el.child(button(`history-rule-${i}`,'Create rule…',{kind:'plain',disabled:this.busy,onClick:(_e,cx)=>this.chooseHistory(row,cx)})))
      .when(this.mode!=='history',el=>el.child(button(`revoke-${i}`,'Revoke',{kind:'plain',onClick:(_e,cx)=>this.action('revoke',['--id',row.id],cx)}))))
     .child(div().text_size(11).text_color(t.dim).child(`${row.account??''} · ${row.task||row.space||'Account'}${row.expires?` · expires ${new Date(row.expires*1000).toISOString().slice(0,16).replace('T',' ')} UTC`:''}`))
     .child(div().text_size(11).text_color(t.dim).child(this.mode==='history'?`${approvalOrigin(row)} · ${row.reason??''}`:`${row.cwd} · ${row.scope} · ${row.match}`))))
    .when(!this.loading&&!this.rows.length,el=>el.child(div().p(10).text_color(t.dim).child(this.mode==='history'?'No approval decisions recorded yet.':'No saved command rules. Use Create rule… on a permission card.')))));}
 grantForm(t,cx){return v_flex().id('approval-grant-form').flex_1().min_h(0).overflow_y_scroll().gap(12)
   .when(this.mode==='history-grant',el=>el.child(button('approval-history-back','‹ History',{kind:'plain',onClick:(_e,cx)=>this.backToHistory(cx)})))
   .child(div().text_size(12).text_color(t.dim).child(this.info?.context.account??''))
   .child(div().text_size(12).child(this.info?.command??''))
   .child(div().text_size(11).text_color(t.dim).child(`Folder: ${this.info?.context.cwd??''}`))
   .child(segmented('approval-scope',this.info.words?[['task','This task/session'],['space','This space'],['account','Account in this folder']]:[['task','This task/session']],this.scope,(v,_e,cx)=>{this.scope=v;cx.notify();}))
   .child(segmented('approval-match',this.info.words?[['exact','Exact command'],['prefix','Starting with…']]:[['exact','Exact action for this task']],this.match,(v,_e,cx)=>{this.match=v;if(!this.info.words)this.scope='task';cx.notify();}))
   .when(this.match==='prefix',el=>el.child(Input.new(this.prefix).w_full()))
   .child(segmented('approval-expiry',[[1,'1 hour'],[24,'1 day'],[168,'1 week'],[8760,'1 year']],this.hours,(v,_e,cx)=>{this.hours=v;cx.notify();}))
   .child(segmented('approval-rule-decision',[['allow','Allow matching requests'],['deny','Deny matching requests']],this.decision,(v,_e,cx)=>{this.decision=v;cx.notify();}))
   .child(div().text_size(11).text_color(t.dim).child('The rule is bound to this account and folder. Remembering it enables approved rules for this task/session; global defaults stay unchanged. Scripts and non-command actions can only match this exact action in this task.'))
   .when(this.mode==='history-grant',el=>el.child(div().text_size(12).text_color(t.muted).child('Applies to future matching requests. Saving does not rerun or answer the original action.')))
   .child(button('approval-save-rule',this.busy?'Saving…':this.mode==='history-grant'?'Save rule for future requests':'Save rule and answer this request',{kind:'primary',disabled:this.busy,onClick:(_e,cx)=>this.action(this.mode==='history-grant'?'history-grant':'grant',[...(this.mode==='history-grant'?['--id',this.historyId]:this.args()),'--scope',this.scope,'--match',this.match,'--prefix',this.prefix.value(),'--hours',String(this.hours),'--decision',this.decision,...(this.mode==='history-grant'?[]:['--respond'])],cx)}));}
 close(){this.prefix?.release();dropKeys(this.holder);}
}
