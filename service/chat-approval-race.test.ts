import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
const constants=source.match(/const UNREAD_APPROVAL = [^\n]+\nconst approvalTitle = [^\n]+/)?.[0]??`const UNREAD_APPROVAL='Approval request details unavailable';const approvalTitle=title=>title;`;
function method(name:string){const at=source.indexOf(`  ${name}(`),a=at<0?source.indexOf(`  async ${name}(`):at;if(a<0)throw Error('Missing method '+name);return source.slice(a,source.indexOf('\n  }',a)+4);}
function local(text:string|null,previous:any[]=[]){
 const ended:any[]=[];let alerts=0;
 const C=new Function('exec','readTextFile','words',`${constants}; return class {${method('readAsks')}}`)(async()=>({stdout:'t1.123.456.json\n'}),async()=>text,()=>({kind:'permission',title:'Real command'}));
 const v:any=new C();v.addr='t1';v.askDir='/synthetic';v.asks=previous;v.cards={keep(){}};v.askEnded=(...a:any[])=>ended.push(a);v.askAlert=()=>alerts++;
 return {v,ended,get alerts(){return alerts}};
}
test('an approval removed during Auto-review handoff never creates an unreadable request card',async()=>{
 const h=local(null);await h.v.readAsks({notify(){}});expect(h.v.asks).toEqual([]);expect(h.alerts).toBe(0);expect(h.ended).toEqual([]);
});
test('a genuinely malformed approval uses agent-neutral wording',async()=>{
 const h=local('{bad json');await h.v.readAsks({notify(){}});expect(h.v.asks[0].words).toMatchObject({title:'Approval request details unavailable',unread:true});
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
