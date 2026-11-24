import { appHome } from 'herdr';
import { approvalCall, approvalDialog } from './approval.js';
import { toast, plainError } from './ui.js';
import { requestHash } from './core/asks.js';
const args=ask=>['--request',`${appHome()}/data/chat-asks/req/${ask.id}.json`,...(ask.terminal?['--terminal',ask.terminal]:[])];
export function adviceControl(ask,host){
 const bound={...ask,terminal:ask.terminal??host.terminal?.(),machine:ask.machine??host.machine?.()};
 return {id:`ask-advice-${ask.id}`,label:'Advice',look:'secondary',disabled:Boolean(bound.machine)||['processing','pending','ready'].includes(ask.approval?.advice?.state),fn:cx=>cx.spawn(async cx=>{
  try{await approvalCall('advice',[...args(bound),'--hash',requestHash(ask.req)]);}
  catch{toast({title:'Advice unavailable',body:'The request may have changed or closed. Refresh the card and try again.',level:'error'});}
  cx.notify();
 })};
}
export function rememberedControls(ask,host){
 if(ask.words?.kind!=='permission'||ask.words?.unread)return[];
 const bound={...ask,terminal:ask.terminal??host.terminal?.(),machine:ask.machine??host.machine?.()};
 const action=(command,extra,title,cx)=>cx.spawn(async cx=>{try{const out=await approvalCall(command,[...args(bound),...extra]);toast({title:command==='grant'&&out.action==='deny'?'Request denied by a saved rule':command==='grant'&&out.action==='wait'?'Rules saved · request still waiting':command==='grant'&&out.action==='saved'?'Rules saved for future requests':title,body:out.reason??''});}catch(e){toast({title:'Approval was not changed',body:plainError(e),level:'error'});}cx.notify();});
 return [
  {id:`ask-task-${ask.id}`,label:'Allow for this task',look:'secondary',disabled:Boolean(bound.machine),fn:cx=>action('grant',['--task-grant','--respond'],'Allowed for this task/session',cx)},
  // The authoritative inspector chooses shell stages, exact payload, or an
  // explicitly named tool. Never infer Bash from an arbitrary input.command.
  {id:`ask-rule-${ask.id}`,label:'Create rule…',look:'secondary',disabled:Boolean(bound.machine),fn:()=>approvalDialog('grant',bound)},
  {id:`ask-review-${ask.id}`,label:'Ask Assistant',look:'secondary',disabled:Boolean(bound.machine),fn:cx=>action('review',[],'Assistant review requested',cx)},
 ];
}
export function recordPermission(ask,text,host,cx){
 if(ask.words?.kind!=='permission'||ask.machine)return;
 let decision;try{decision=JSON.parse(text).hookSpecificOutput?.decision?.behavior;}catch{return;}
 if(!['allow','deny'].includes(decision))return;
 const bound={...ask,terminal:ask.terminal??host.terminal?.()};
 cx.spawn(async()=>{try{await approvalCall('record',[...args(bound),'--decision',decision,'--reason','Decided by the person in Chat']);}catch{}});
}
