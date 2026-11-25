// Synthetic, isolated web Files preview fixture. Serves the actual built app.
// bun test/fixtures/document-find-web.ts web/dist 19458
import {join} from 'node:path'
const dist=process.argv[2], port=Number(process.argv[3] ?? 19458)
const key='fixture/assistant'
const text='// Document Find fixture\nconst needle = "NEEDLE";\n'+
  Array.from({length:145},(_,i)=>`// Synthetic source line ${i+3}\n`).join('')+
  'const late = "Needle at the end";\n'
const other='Different project file. No matching words.\n'
const prefix=('First 400,000 bytes only.\n'+'x'.repeat(399960)+'\nneedle\n').slice(0,400000)
const files:Record<string,object>={
  'sample.ts':{path:'sample.ts',size:Buffer.byteLength(text),text},
  'other.txt':{path:'other.txt',size:Buffer.byteLength(other),text:other},
  'large.txt':{path:'large.txt',size:600000,text:prefix,tooBig:true},
  'scan.pdf':{path:'scan.pdf',size:1200,binary:true},
}
const snapshot={name:'Find fixture',host:'fixture',user:'You',places:[{id:'fixture-space',name:'Document Find',machine:'fixture',level:2,status:'idle',mode:'regular',chat:key,folder:'/synthetic'}],machines:[{id:'m:fixture',machine:'fixture',name:'Fixture',here:true,status:'idle'}],tasks:[],automations:{},artifacts:[],asks:{},needs:[],settings:[],sections:[],panels:['files','changes']}
Bun.serve({port,hostname:'127.0.0.1',fetch(req,server){
  const u=new URL(req.url)
  if(u.pathname==='/api/ws')return server.upgrade(req)?undefined:new Response('upgrade failed',{status:400})
  if(u.pathname==='/api/worktree'){
    const what=u.searchParams.get('what'), path=u.searchParams.get('path')??''
    if(what==='dir')return Response.json({root:'/synthetic',entries:Object.keys(files).map(name=>({name,dir:false}))})
    if(what==='marks')return Response.json({marks:{}})
    if(what==='file'&&files[path])return Response.json(files[path])
  }
  if(u.pathname.startsWith('/api/'))return new Response('not in fixture',{status:404})
  const file=Bun.file(join(dist,u.pathname==='/'?'index.html':u.pathname))
  return file.exists().then(ok=>ok?new Response(file):new Response(Bun.file(join(dist,'index.html'))))
},websocket:{open(ws){ws.send(JSON.stringify({type:'snapshot',snapshot}))},message(ws,raw){
  const m=JSON.parse(String(raw))
  if(m.type==='watch')ws.send(JSON.stringify({type:'chat',chat:{key,cli:'codex',messages:[],top:true,working:false}}))
  if(m.type==='ping')ws.send(JSON.stringify({type:'pong'}))
}}})
console.log(`Document Find synthetic web fixture: http://127.0.0.1:${port}`)
