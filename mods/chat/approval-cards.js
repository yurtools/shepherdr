// Only expose reusable rules when the request is one safely parseable command.
export function rememberable(value) {
 if(Array.isArray(value))return value.length===3&&/^(?:.*\/)?(?:sh|bash|zsh)$/.test(value[0])&&['-c','-lc'].includes(value[1])?rememberable(value[2]):value.length>0&&value.every(x=>typeof x==='string');
 if(typeof value!=='string'||!value.trim())return false;
 let quote=null,escape=false;
 for(const c of value){if(escape){escape=false;continue;}if(quote==="'"){if(c==="'")quote=null;continue;}if(c==='\\'){escape=true;continue;}if(c==='$'||c==='`')return false;if(quote==='"'){if(c==='"')quote=null;continue;}if(c==='"'||c==="'")quote=c;else if(/[;&|<>\n\r]/.test(c))return false;}
 return !quote&&!escape;
}
import { appHome } from 'herdr';
import { approvalCall, approvalDialog } from './approval.js';
import { toast, plainError } from './ui.js';
const args=ask=>['--request',`${appHome()}/data/chat-asks/req/${ask.id}.json`,...(ask.terminal?['--terminal',ask.terminal]:[])];
export function rememberedControls(ask,host){
 if(ask.words?.kind!=='permission'||ask.words?.unread)return[];
 const bound={...ask,terminal:ask.terminal??host.terminal?.(),machine:ask.machine??host.machine?.()};
 const action=(command,extra,title,cx)=>cx.spawn(async cx=>{try{const out=await approvalCall(command,[...args(bound),...extra]);toast({title,body:out.reason??''});}catch(e){toast({title:'Approval was not changed',body:plainError(e),level:'error'});}cx.notify();});
 const canRemember=rememberable(ask.req?.tool_input?.command);
 return [
  {id:`ask-task-${ask.id}`,label:'Allow for this task',look:'secondary',disabled:Boolean(bound.machine),fn:cx=>action('grant',['--scope','task','--match','exact','--hours','24','--respond'],'Allowed for this task/session',cx)},
  {id:`ask-rule-${ask.id}`,label:'Create rule…',look:'secondary',disabled:Boolean(bound.machine)||!canRemember,fn:()=>approvalDialog('grant',bound)},
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
