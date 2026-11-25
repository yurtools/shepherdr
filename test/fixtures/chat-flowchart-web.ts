import { join } from 'node:path';
const dist = process.argv[2];
const port=Number(process.argv[3]??19444);
const key='fixture/assistant';
const now=Date.now();
const fence=(code:string,closed=true)=>'\x60\x60\x60mermaid\n'+code+(closed?'\n\x60\x60\x60':'');
const vertical='flowchart TD\n  A([Start]) --> B{Ready to publish?}\n  B -->|Yes| C[Publish]\n  B -->|No| D[Revise draft]\n  D --> B\n  C --> '+Array.from({length:10},(_,i)=>`V${i}[Vertical step ${i+1}]`).join(' --> ')+' -->|All checks done| Z([Final vertical step])';
const horizontal='graph LR\n  A[Receive request] --> B[Review details] --> C{Approved?}\n  C -->|Yes| D[Publish]\n  C -->|No| E[Ask for changes]\n  D --> '+Array.from({length:9},(_,i)=>`H${i}[Horizontal step ${i+1}]`).join(' --> ')+' -->|All checked| Z([Final horizontal step])  ';
const bad='flowchart TD\n  A -->';
const incomplete='flowchart TD\n  Start --> Draft';
const messages=[
  {id:'older',who:'agent',at:now-60000,text:'Old messages still use ordinary fenced code:\n\n\x60\x60\x60js\nconst sample = 42;\n\x60\x60\x60'},
  {id:'vertical',who:'agent',at:now-50000,text:'Here is the publishing flow:\n\n'+fence(vertical)+'\n\nA second diagram in the same message:\n\n'+fence(horizontal)+'\n\nThe draft loops until it is ready.'},
  {id:'horizontal',who:'you',at:now-40000,text:'Can it also draw my Mermaid graph?\n\n'+fence(horizontal)},
  {id:'invalid',who:'agent',at:now-30000,text:'If a diagram is invalid, its source remains available.\n\n'+fence(bad)},
  {id:'stream',who:'agent',at:now-20000,text:'An in-progress block:\n\n'+fence(incomplete,false)},
];
const snapshot={name:'Flowchart fixture',host:'fixture',user:'You',places:[{id:'fixture-space',name:'flowcharts',machine:'fixture',level:2,status:'idle',mode:'regular',chat:key}],machines:[{id:'m:fixture',machine:'fixture',name:'Fixture',here:true,status:'idle'}],tasks:[],automations:{},artifacts:[],asks:{},needs:[],settings:[],sections:[]};
const chat=()=>({key,cli:'codex',messages,top:true,working:false});
const sockets=new Set<any>();
Bun.serve({port,hostname:'127.0.0.1',fetch(req,server){
 const path=new URL(req.url).pathname;
 if(path==='/api/ws')return server.upgrade(req)?undefined:new Response('upgrade failed',{status:400});
 if(path==='/fixture/complete'){
  messages[4].text='An in-progress block:\n\n'+fence(incomplete);
  for(const ws of sockets)ws.send(JSON.stringify({type:'chat',chat:chat()}));
  return new Response('completed');
 }
 if(path.startsWith('/api/'))return new Response('not in fixture',{status:404});
 const file=Bun.file(join(dist,path==='/'?'index.html':path));
 return file.exists().then(ok=>ok?new Response(file):new Response(Bun.file(join(dist,'index.html'))));
},websocket:{open(ws){sockets.add(ws);ws.send(JSON.stringify({type:'snapshot',snapshot}));},message(ws,raw){
 const m=JSON.parse(String(raw));
 if(m.type==='watch')ws.send(JSON.stringify({type:'chat',chat:chat()}));
 if(m.type==='ping')ws.send(JSON.stringify({type:'pong'}));
},close(ws){sockets.delete(ws)}}});
console.log(`Synthetic Chat fixture listening on 127.0.0.1:${port}`);
