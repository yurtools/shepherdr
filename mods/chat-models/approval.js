import { appHome, exec, openOverlay } from 'herdr';
export const APPROVAL_MODES=[['manual','Ask me'],['rules','Approved rules'],['assistant','Assistant review'],['codex-review','Codex Auto-review']];
export async function approvalCall(command,args=[],on=null){
 const r=await exec('python3',[`${appHome()}/mods/chat/approval-policy.py`,command,...args],{on,timeout:20000});
 let out;try{out=JSON.parse(r.stdout);}catch{throw new Error(r.stderr||'Approval settings could not be read.');}
 if(r.code!==0||out.error)throw new Error(out.error||r.stderr||'Approval operation failed.');return out;
}
// The same exclusive answer claim as the hook/reviewer. Never replace an answer from
// another card, the terminal, or a native handoff while this card was being pressed.
export async function answerPermission(request,hash,text,reason){
 return approvalCall('answer',['--request',request,'--hash',hash,'--answer',text,'--reason',reason??'']);
}
export function approvalDialog(mode,ask=null,space=null){openOverlay({mod:'workspace-approvals',kind:'dialog',frame:'none',width:900,height:0.82,props:{mode,id:ask?.id,terminal:ask?.terminal,space}});}
export async function approvalArgv(argv,space,role,cwd,on=null){
 const args=['--argv',JSON.stringify(argv),'--space',String(space??'').split('/').pop(),'--role',role??'agent','--cwd',cwd??''];
 if(on){
  // Optional policy support must not break an older linked machine's existing launch.
  const script='f="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/chat/approval-policy.py"; if [ -f "$f" ]; then exec python3 "$f" launch "$@"; else exit 44; fi';
  const r=await exec('sh',['-c',script,'approval-launch',...args],{on,timeout:10000});
  if(r.code===44)return argv;
  let out;try{out=JSON.parse(r.stdout);}catch{throw new Error(r.stderr||'Could not read remote approval settings.');}
  if(r.code!==0||out.error||!Array.isArray(out.argv))throw new Error(out.error||r.stderr||'Remote approval launch failed.');
  return out.argv;
 }
 const out=await approvalCall('launch',args);if(!Array.isArray(out.argv))throw new Error('Approval launch returned invalid arguments.');return out.argv;
}
