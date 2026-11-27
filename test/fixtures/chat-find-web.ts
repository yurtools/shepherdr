// Synthetic, local-only Chat Find fixture. No real logs, messages or actions.
import { join } from 'node:path';
const dist=process.argv[2], port=Number(process.argv[3]??19559), now=Date.now();
const key='p:fixture:find', other='p:fixture:other';
const fence=(lang:string,source:string)=>`\`\`\`${lang}\n${source}\n\`\`\``;
const code=['const needle = 1;',...Array.from({length:68},(_,n)=>`// separate line ${n+1}`),'const NEEDLE = 2;',...Array.from({length:24},(_,n)=>`// details ${n+1}`),'const needle = 3;'].join('\n');
const diagram='flowchart LR\n  Alpha[Review needle<br>Done] --> Omega[Publish result]  ';
const messages=[
  {id:'human',who:'you',text:'Person: Needle, literal punctuation [a+b] and café. Needle.',at:now-60000},
  {id:'agent',who:'agent',text:'Agent: **needle** then `NEEDLE` and **nee**dle. A [readable link](https://example.invalid/hidden-target). Literal \\* and `a+b`.',at:now-50000},
  {id:'quiet',who:'agent',brief:{label:'Message from Reviewer',from:'Reviewer'},text:'A hidden note: needle from the reviewer.',at:now-40000},
  {id:'long',who:'agent',text:`Long source with three separate hits.\n\n${fence('js',code)}`,at:now-30000},
  {id:'diagram',who:'agent',text:`Diagram from a retained message.\n\n${fence('mermaid',diagram)}`,at:now-20000},
  {id:'unicode',who:'agent',text:'Unicode: CAFÉ, café, 😀 café and İ before café. No hidden work.',at:now-10000},
];
let earlier=true, otherHistory='other-1';
let otherMessages=[{id:'human',who:'you',text:'Another Feature: needle once.',at:now}];
const chats=()=>[{key,historyKey:'find-1',cli:'codex',messages,earlier,top:!earlier,working:false},{key:other,historyKey:otherHistory,cli:'claude',messages:otherMessages,top:true,working:false}];
const snapshot={name:'Find fixture',host:'fixture',user:'You',places:[{id:'fixture/find',name:'Search fixture',machine:'fixture',level:2,status:'idle',mode:'regular',chat:key,home:true},{id:'fixture/other',name:'Second Feature',machine:'fixture',level:2,status:'idle',mode:'regular',chat:other}],machines:[{id:'m:fixture',machine:'fixture',name:'Fixture',here:true,status:'idle'}],tasks:[],automations:{},artifacts:[],asks:{},needs:[],settings:[],sections:[]};
const sockets=new Set<any>();
const push=()=>{for(const ws of sockets)for(const chat of chats())ws.send(JSON.stringify({type:'chat',chat}));};
Bun.serve({port,hostname:'127.0.0.1',async fetch(req,server){
 const path=new URL(req.url).pathname;
 if(path==='/api/ws')return server.upgrade(req)?undefined:new Response('upgrade failed',{status:400});
 if(path==='/api/action'&&req.method==='POST'){
  const body=await req.json() as {type:string;chat:string};
  if(body.type==='earlier'&&body.chat===key){if(earlier){earlier=false;messages.unshift({id:'earlier',who:'agent',text:'Earlier retained needle and NEEDLE.',at:now-120000});push();}return Response.json({ok:true});}
  return new Response('not a fixture action',{status:404});
 }
 if(path==='/fixture/large'){
  otherMessages.push(...Array.from({length:800},(_,i)=>({id:`bulk-${i}`,who:'agent',text:i%200===0?'Bulkmarker retained.':`Retained message ${i}.`,at:now+i+20})));push();return new Response('larger history');
 }
 if(path==='/fixture/session'){otherHistory='other-2';otherMessages=[{id:'human',who:'you',text:'Replacement session, no old words.',at:now}];push();return new Response('replaced');}
 if(path==='/fixture/stream'){messages.push({id:'stream',who:'agent',text:'Streamed needle is new.',at:now+1000});push();return new Response('streamed');}
 if(path.startsWith('/api/'))return new Response('not in fixture',{status:404});
 const file=Bun.file(join(dist,path==='/'?'index.html':path));
 return await file.exists()?new Response(file):new Response(Bun.file(join(dist,'index.html')));
},websocket:{open(ws){sockets.add(ws);ws.send(JSON.stringify({type:'snapshot',snapshot}));},message(ws,raw){const m=JSON.parse(String(raw));if(m.type==='watch')for(const chat of chats())ws.send(JSON.stringify({type:'chat',chat}));if(m.type==='ping')ws.send(JSON.stringify({type:'pong'}));},close(ws){sockets.delete(ws)}}});
console.log(`Synthetic Find fixture listening on 127.0.0.1:${port}`);
