import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {permissionStatus,requestHash} from '../core/asks.js';
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
const constants=source.match(/const UNREAD_APPROVAL = [^\n]+\nconst approvalTitle = [^\n]+/)?.[0]??`const UNREAD_APPROVAL='Approval request details unavailable';const approvalTitle=title=>title;`;
function method(name:string){const at=source.indexOf(`  ${name}(`),a=at<0?source.indexOf(`  async ${name}(`):at;if(a<0)throw Error('Missing method '+name);return source.slice(a,source.indexOf('\n  }',a)+4);}
function local(text:string|null,previous:any[]=[]){
 const ended:any[]=[];let alerts=0;
 const C=new Function('exec','readTextFile','words','permissionStatus',`${constants}; return class {${method('readAsks')}}`)(async()=>({stdout:'t1.123.456.json\n'}),async(path:string)=>path.endsWith('.json')&&path.includes('/req/')?text:null,()=>({kind:'permission',title:'Real command'}),permissionStatus);
 const v:any=new C();v.addr='t1';v.askDir='/synthetic';v.asks=previous;v.cards={keep(){}};v.askEnded=(...a:any[])=>ended.push(a);v.askAlert=()=>alerts++;
 return {v,ended,get alerts(){return alerts}};
}
test('an approval removed during Auto-review handoff never creates an unreadable request card',async()=>{
 const h=local(null);await h.v.readAsks({notify(){}});expect(h.v.asks).toEqual([]);expect(h.alerts).toBe(0);expect(h.ended).toEqual([]);
});
test('a genuinely malformed approval uses agent-neutral wording',async()=>{
 const h=local('{bad json');await h.v.readAsks({notify(){}});expect(h.v.asks[0].words).toMatchObject({title:'Approval request details unavailable',unread:true});
});
test('closing a request during its Advice read cannot leave a live native card',async()=>{
 const req={tool_name:'Bash',tool_input:{command:'git status'}},id='t1.123.456';let closed=false;
 const C=new Function('exec','readTextFile','words','permissionStatus',`${constants};return class {${method('readAsks')}}`)(async()=>({stdout:id+'.json\n'}),async(path:string)=>{
  if(path.endsWith('.advice')){closed=true;return null;}
  if(path.includes('/ans/'))return closed?'{}':null;
  if(path.endsWith('.json'))return JSON.stringify(req);
  return null;
 },()=>({kind:'permission',title:'Run: git status'}),permissionStatus);
 const v:any=new C();Object.assign(v,{addr:'t1',askDir:'/fixture',asks:[],cards:{keep(){}},askEnded(){},askAlert(){}});
 await v.readAsks({notify(){}});expect(v.asks).toEqual([]);
});
test('a readable approval retains its actual command title',async()=>{
 const h=local('{"tool_name":"Bash"}');await h.v.readAsks({notify(){}});expect(h.v.asks[0].words.title).toBe('Real command');
});
test('worker approval reads also ignore a request removed after the inbox listed it',async()=>{
 let pending=Promise.resolve();
 const C=new Function('shared','readTextFile','words',`${constants};return class {${method('workerAsks')}}`)(()=>[{id:'request',terminal:'worker'}],async()=>null,()=>{throw Error('no request to parse')});
 const v:any=new C();v.workerTasks=()=>new Map([['worker',{ref:'TASK-1',title:'Task'}]]);v.answeredAsks=new Set();v.shownAsks=new Map();v.readingAsks=new Set();v.workerCards={keep(){}};v.secretCards={items:()=>[]};v.askDir='/synthetic';v.workerAskEnded=()=>{throw Error('no card should end')};
 const inner={notify(){}};v.workerAsks({timer:{after:(_n:number,fn:any)=>fn({spawn:(f:any)=>{pending=f(inner)}})}});await pending;
 expect(v.shownAsks.size).toBe(0);expect(v.readingAsks.size).toBe(0);
});
test('old persisted fallback titles become neutral without dropping approval outcomes',()=>{
 const C=new Function('localStorage',`${constants};return class {${method('loadAskEnds')}}`)({getItem:()=>JSON.stringify([{id:'old',title:"Claude asks for something the chat can't read",how:'Sent to Codex Auto-review'},{id:'real',title:'Run: git status',how:'Allowed'}])});
 const v:any=new C();v.addr='t1';v.loadAskEnds();expect(v.askEnds[0]).toMatchObject({title:'Approval request details unavailable',how:'Sent to Codex Auto-review'});expect(v.askEnds[1].title).toBe('Run: git status');
});

test('a visible native card refreshes status without re-alerting while the Assistant reviews',async()=>{
 const req={tool_name:'Bash',tool_input:{command:'git status'}},id='t1.123.456';
 let metadata:any={version:1,request_hash:requestHash(req),state:'checking'},exists=true,answered=false,alerts=0,changes=0;
 const C=new Function('exec','readTextFile','words','permissionStatus',`${constants};return class {${method('readAsks')}}`)(async()=>({stdout:exists?id+'.json\n':''}),async(path:string)=>path.includes('/ans/')?(answered?'{}':null):path.endsWith('.status')?JSON.stringify(metadata):exists?JSON.stringify(req):null,()=>({kind:'permission',title:'Run: git status'}),permissionStatus);
 const v:any=new C();v.addr='t1';v.askDir='/fixture';v.asks=[];v.cards={keep(){}};v.askEnded=()=>{};v.askAlert=()=>alerts++;
 const cx={notify(){changes++}};
 await v.readAsks(cx);expect(v.asks[0].approval.state).toBe('checking');expect(alerts).toBe(0);
 metadata={...metadata,state:'assistant',reviewer:'feature'};await v.readAsks(cx);expect(v.asks[0].approval.text).toBe('Waiting for Feature Assistant review');expect(alerts).toBe(0);
 metadata={...metadata,state:'person',reason:'assistant-asked',review_reason:'The destination needs your choice.'};await v.readAsks(cx);expect(v.asks[0].approval.attention).toBe(true);expect(v.asks[0].approval.detail).toContain(metadata.review_reason);expect(alerts).toBe(1);
 answered=true;await v.readAsks(cx);expect(v.asks).toEqual([]);expect(changes).toBe(4);
});

test('a worker card in its Feature Assistant chat refreshes from the inbox status',()=>{
 const req={tool_name:'Bash',tool_input:{command:'git status'}},hash=requestHash(req),id='worker.123.456';
 let listed:any=[{id,terminal:'worker',requestHash:hash,approval:{state:'assistant',text:'Waiting for Feature Assistant review',attention:false}}];
 const C=new Function('shared','requestHash','permissionStatus',`return class {${method('workerAsks')}}`)(()=>listed,requestHash,permissionStatus);
 const v:any=new C();v.workerTasks=()=>new Map([['worker',{ref:'TASK-1'}]]);v.shownAsks=new Map([[id,{id,req,requestHash:hash,ref:'TASK-1'}]]);v.answeredAsks=new Set();v.readingAsks=new Set();v.workerCards={keep(){}};v.secretCards={items:()=>[]};
 expect(v.workerAsks({})[0].approval.state).toBe('assistant');
 listed=[{...listed[0],approval:{state:'person',text:'Waiting for your decision',attention:true}}];
 expect(v.workerAsks({})[0].approval.state).toBe('person');
});

test('a manual click losing to native handoff reports the handoff, never an invented allow',async()=>{
 const outcomes:any[]=[];
 const C=new Function('answerAsk','readTextFile',`return class {${method('replyPermission')}}`)(async()=>{throw Error('claimed already')},async(path:string)=>path.includes('/end/')?'Sent to Codex Auto-review · final result not reported':null);
 const v:any=new C();v.askDir='/fixture';v.askEnded=(_ask:any,how:string)=>outcomes.push(how);
 await v.replyPermission({id:'one',req:{tool_name:'Bash'}},'allow','Allowed in the chat',{notify(){}});
 expect(outcomes).toEqual(['Sent to Codex Auto-review · final result not reported']);
});
