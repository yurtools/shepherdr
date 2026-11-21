import {test,expect} from 'bun:test';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {element} from './fake-gpui';
import * as ruleUI from '../core/approval-history.js';
const src=readFileSync(new URL('../mods/workspace-approvals/main.js',import.meta.url),'utf8');
function fixture(info:any={context:{account:'Account 2',cwd:'/original'},tool:'Bash',words:['git','status'],suggested_prefix:'git status'},backend?:any){
 const buttons:any[]=[],calls:any[]=[];let task=Promise.resolve();
 const klass=src.slice(src.indexOf('export default class')).replace('export default ','');
 const segments:any[]=[];
 const C=new Function('View','div','v_flex','h_flex','Input','button','segmented','approvalCall','props','closeOverlay','plainError','dropKeys',...Object.keys(ruleUI),'theme',`return ${klass}`)(class{},()=>element(),()=>element(),()=>element(),{new:()=>element()},(id:any,label:any,opts:any)=>{buttons.push({id,label,opts});return element()},(id:any,opts:any,value:any,pick:any)=>{segments.push({id,opts,value,pick});return element()},async(...a:any[])=>{calls.push(a);return backend?backend(...a):a[0].endsWith('preview')?{valid:true,coverage:'Literal arguments may vary.'}:info},()=>({}),()=>calls.push(['close']),String,()=>{},...Object.values(ruleUI),()=>({}));
 const v:any=new C();v.mode='history';v.prefix={set_value(x:any){this.text=x},value(){return this.text??''},release(){}};v.rows=[];v.load=()=>{};
 const cx:any={spawn:(fn:any)=>{task=fn(cx)},notify(){}};
 return {v,cx,buttons,calls,segments,wait:()=>task};
}
test('a history rule uses the historic ID and never sends an answer to the old approval',async()=>{
 const {v,cx,buttons,calls,wait}=fixture();v.chooseHistory({id:'historic',decision:'deny'},cx);await wait();
 expect(calls[0]).toEqual(['history-inspect',['--id','historic']]);expect(calls[1][0]).toBe('history-preview');expect(v.mode).toBe('history-grant');expect(v.decision).toBe('deny');
 v.hours=24;v.grantForm({},cx);const save=buttons.find(b=>b.id==='approval-save-rule');expect(save.label).toBe('Save rule for future requests');
 save.opts.onClick(null,cx);await wait();const request=calls.find(c=>c[0]==='history-grant');
 expect(request[1]).toContain('historic');expect(request[1]).not.toContain('--request');expect(request[1]).not.toContain('--respond');expect(calls.some(c=>c[0]==='close')).toBe(false);
 expect(v.mode).toBe('history');
});

test('edited prefixes use real validation and save their actual tokens without replaying history',async()=>{
 const root=mkdtempSync(join(tmpdir(),'prefix-editor-'));
 const policy=new URL('../mods/chat/approval-policy.py',import.meta.url).pathname;
 const env={...process.env,HERDR_APP_HOME:join(root,'app'),HERDR_TASK_SETTINGS:join(root,'settings.json'),SHEPHERDR_NO_MIGRATE:'1'};
 const data=join(root,'app/data/approvals');mkdirSync(data,{recursive:true});
 const context={account:'/fixture-account',cwd:'/fixture-project',space:'fixture',task:'T-1',session:'original',terminal:'gone'};
 const command='tail -n 5 "$FILE"';
 // Generate the historic seed through the actual policy, rather than making one
 // that merely mirrors the inspector's current response.
 const seed=`import sys,json;sys.path.insert(0,${JSON.stringify(new URL('../mods/tasks/bin',import.meta.url).pathname)});from herdr_task import approvals as A;A.audit({'tool_name':'Bash','tool_input':{'command':${JSON.stringify(command)}}},${JSON.stringify(context)},'ask','Fixture','user');print(A.history_rows()[-1]['id'])`;
 try{
  const id=execFileSync('python3',['-c',seed],{env,encoding:'utf8'}).trim();
  const backend=(cmd:string,args:string[])=>JSON.parse(execFileSync('python3',[policy,cmd,...args],{env,encoding:'utf8'}));
  const f=fixture(undefined,backend);f.v.chooseHistory({id},f.cx);await f.wait();
  f.v.grantForm({},f.cx);f.segments.find(s=>s.id==='approval-match').pick('prefix',null,f.cx);await f.wait();
  for(const prefix of ['tailx','tail -n 5 "$FILE"','tail']){
   f.v.prefix.set_value(prefix);f.v.queuePreview(f.cx);await f.wait();f.buttons.length=0;f.v.grantForm({},f.cx);
   expect(f.v.preview.valid).toBe(prefix==='tail');
   expect(f.buttons.find(b=>b.id==='approval-save-rule').opts.disabled).toBe(prefix!=='tail');
   if(prefix!=='tail')expect(f.v.preview.error).toContain('literal argument tokens');
  }
  expect(f.v.preview.coverage).toContain('arguments may vary');expect(f.v.preview.coverage).not.toContain('read-only');
  f.v.scope='space';f.v.hours=0;f.buttons.find(b=>b.id==='approval-save-rule').opts.onClick(null,f.cx);await f.wait();
  const raw=`import sys,json;sys.path.insert(0,${JSON.stringify(new URL('../mods/tasks/bin',import.meta.url).pathname)});from herdr_task import approvals as A\nwith A.locked(): print(json.dumps(A.read(A.store()/'rules.json')))`;
  const rows=JSON.parse(execFileSync('python3',['-c',raw],{env,encoding:'utf8'}));
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({pattern:['tail'],match:'prefix',tool:'Bash',scope:'space',expires:0,account:context.account,cwd:context.cwd});
  expect(rows[0].inherited).toBeUndefined();expect(existsSync(join(root,'app/data/chat-asks/ans'))).toBe(false);
  expect(f.calls.find(c=>c[0]==='history-grant')[1]).not.toContain('--respond');
  const pending=`import sys,json;sys.path.insert(0,${JSON.stringify(new URL('../mods/tasks/bin',import.meta.url).pathname)});from herdr_task import approvals as A;p=A.app_home()/'data/chat-asks/req/fixture.json';r={'tool_name':'Bash','tool_input':{'command':'tail "$(touch NEVER_RUN)"'}};A.write(p,r);A.write(p.with_suffix('.context'),{**${JSON.stringify(context)},'request_key':A.request_key(r)});print(p)`;
  const path=execFileSync('python3',['-c',pending],{env,encoding:'utf8'}).trim();
  const p=fixture(undefined,backend);Object.assign(p.v,{mode:'grant',info:backend('inspect',['--request',path]),stage:0,match:'prefix',scope:'space',hours:1,decision:'allow',args:()=>['--request',path]});
  p.v.prefix.set_value('tail');await p.v.refreshPreview(p.cx);p.v.grantForm({},p.cx);
  const save=p.buttons.find(b=>b.id==='approval-save-rule');expect(save.label).toBe('Save rule for future requests');expect(save.opts.disabled).toBe(false);
  save.opts.onClick(null,p.cx);await p.wait();
  expect(p.v.notice).toContain('still waiting');expect(p.calls.some(c=>c[0]==='close')).toBe(false);
  expect(existsSync(path)).toBe(true);expect(existsSync(path.replace('/req/','/ans/'))).toBe(false);
  expect(JSON.parse(execFileSync('python3',['-c',raw],{env,encoding:'utf8'})).at(-1)).toMatchObject({pattern:['tail'],match:'prefix',scope:'space',tool:'Bash'});
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('unsupported actions show future-only coverage while named browser tools keep exact payload identity',async()=>{
 const f=fixture({tool:'functions.exec_command',context:{account:'A',cwd:'/p'},command:'tail "$(curl example.invalid)"',words:['tail'],stages:[['tail']],stage_exact:[false],future_only:true,boundary:'Command substitution needs a separate decision.',suggested_prefix:'tail'});
 f.v.chooseHistory({id:'substitution'},f.cx);await f.wait();f.v.grantForm({},f.cx);
 expect(f.segments.find(s=>s.id==='approval-match').opts[0]).toEqual(['exact','Exact payload for this task']);
 f.segments.find(s=>s.id==='approval-match').pick('prefix',null,f.cx);await f.wait();f.buttons.length=0;f.v.grantForm({},f.cx);
 expect(f.buttons.find(b=>b.id==='approval-save-rule').label).toBe('Save rule for future requests');
 const tool=fixture({tool:'mcp__browser__run',tool_wide:true,context:{account:'A',cwd:'/p'},words:null,command:'mcp__browser__run · command data: open URL'});
 tool.v.chooseHistory({id:'browser'},tool.cx);await tool.wait();tool.v.grantForm({},tool.cx);
 expect(tool.segments.find(s=>s.id==='approval-match').opts).not.toContainEqual(['prefix','Starting with…']);
 expect(tool.v.match).toBe('exact');expect(tool.v.preview.valid).toBe(true);
});
test('history shows readable sources and a create-rule action beside each row',()=>{
 const {v,cx,buttons}=fixture();v.rows=[{id:'old',source:'rule',decision:'allow',command:'git status',reason:'task exact rule abc'}];v.render(cx);
 expect(buttons.find(b=>b.id==='history-rule-0').label).toBe('Create rule…');
 expect(ruleUI.approvalDecision({decision:'saved'})).toBe('Rule saved');
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

test('a newer edit invalidates coverage before its scheduled callback starts',async()=>{
 let resolve:any;
 const f=fixture(undefined,()=>new Promise(r=>{resolve=r}));
 Object.assign(f.v,{mode:'history-grant',historyId:'old',match:'prefix',stage:0,scope:'task',hours:1,info:{words:['tail','file'],stages:[['tail','file']],context:{},tool:'Bash'}});
 f.v.prefix.set_value('tail');f.v.queuePreview(f.cx);const old=f.wait();
 const scheduled:any[]=[];f.cx.spawn=(fn:any)=>scheduled.push(()=>fn(f.cx));
 const version=f.v.previewVersion;f.v.prefix.set_value('tailx');f.v.queuePreview(f.cx);
 expect(f.v.previewVersion).toBeGreaterThan(version);expect(f.v.preview).toBeNull();
 resolve({valid:true,coverage:'old tail coverage'});await old;
 expect(f.v.preview).toBeNull();expect(f.v.previewing).toBe(true);
 f.v.grantForm({},f.cx);expect(f.buttons.at(-1).opts.disabled).toBe(true);
 const newer=scheduled[0]();resolve({valid:false,error:'new prefix does not match'});await newer;
 expect(f.v.preview.valid).toBe(false);
});

test('stage changes, history navigation and close reject old preview results',async()=>{
 for(const change of ['stage','history','close']){
  let resolve:any;const f=fixture(undefined,()=>new Promise(r=>{resolve=r}));
  Object.assign(f.v,{mode:'history-grant',historyId:'old',match:'prefix',stage:0,info:{words:['tail'],stages:[['tail'],['jq']],stage_prefixes:['tail','jq'],context:{},tool:'Bash'}});
  f.v.prefix.set_value('tail');f.v.queuePreview(f.cx);const old=f.wait(),version=f.v.previewVersion;
  f.cx.spawn=()=>{};
  if(change==='stage')f.v.chooseStage(1,f.cx);
  else if(change==='history')f.v.backToHistory(f.cx);
  else f.v.close();
  expect(f.v.previewVersion).toBeGreaterThan(version);
  resolve({valid:true,coverage:'stale stage coverage'});await old;
  expect(f.v.preview).toBeNull();
  if(change==='stage'){expect(f.v.stage).toBe(1);expect(f.v.prefix.value()).toBe('jq');}
 }
});

test('out-of-order previews cannot replace the newest valid coverage',async()=>{
 const replies:any[]=[];const f=fixture(undefined,()=>new Promise(r=>replies.push(r)));
 Object.assign(f.v,{mode:'history-grant',historyId:'old',match:'prefix',stage:0,info:{words:['tail','-n','5'],stages:[['tail','-n','5']],context:{},tool:'Bash'}});
 f.v.prefix.set_value('tail -n');f.v.queuePreview(f.cx);const first=f.wait();
 f.v.prefix.set_value('tail');f.v.queuePreview(f.cx);const second=f.wait();
 replies[1]({valid:true,coverage:'tail arguments may vary'});await second;
 replies[0]({valid:false,error:'old error'});await first;
 expect(f.v.preview).toEqual({valid:true,coverage:'tail arguments may vary'});expect(f.v.previewing).toBe(false);
});
