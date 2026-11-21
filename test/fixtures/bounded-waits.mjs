// Execute the shipped loop bodies with a deterministic host, without running mod init.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
const source = file => readFileSync(new URL(file, root), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
const STOP = new Error('fixture stopped');
function deferred() {
  let resolve, reject, subscriptions=0, cancellations=0;
  const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
  const track = p => {
    let count=0;const then=p.then.bind(p);
    p.then=(...args)=>{subscriptions=Math.max(subscriptions,++count);return track(then(...args));};
    return p;
  };
  track(promise);
  promise.cancel = () => { cancellations++; }; // Host cancellation need never settle.
  return {promise,resolve,reject,get subscriptions(){return subscriptions;},get cancellations(){return cancellations;}};
}
function clock() {
  const timers = new Set();
  const after = (ms,fn) => {
    const t={ms,fn,cancel(){timers.delete(t);t.fn=null;},is_done(){return !timers.has(t);}};
    timers.add(t);return t;
  };
  const cx={timer:{after},sleep:ms=>new Promise(resolve=>after(ms,()=>resolve())),notify(){},spawn(fn){return fn(cx);}};
  return {cx,timers,async tick(){const ts=[...timers];for(const t of ts){timers.delete(t);t.fn?.(cx);t.fn=null;}await flush();},cancel(){for(const t of [...timers])t.cancel();}};
}
function method(file,name,next) {
  const text=source(file),start=text.indexOf(`  ${name}(`);
  assert.ok(start>=0,name);
  return text.slice(start,text.indexOf(next,start));
}
function makeMethod(text,env) {
  return new Function(...Object.keys(env),`return class {${text}}`)(...Object.values(env)).prototype;
}
function commands(file) {
  const text=source(file),out=[];
  for(const hit of text.matchAll(/nextCommand\(\)/g)) {
    const start=text.lastIndexOf('cx.spawn(async (cx) => {',hit.index);
    const indent=file==='mods/chat/main.js' && out.length===0?6:4;
    out.push(text.slice(start+'cx.spawn(async (cx) => {'.length,text.indexOf(`\n${' '.repeat(indent)}});`,hit.index)));
  }
  return out;
}

for(const file of ['mods/chat/main.js','mods/pane-chat/main.js','mods/tabs-tasks/main.js','mods/tasks/main.js']) {
  for(const [index,body] of commands(file).entries()) test(`${file} command loop ${index}: quiet ticks, then exactly one command`,async()=>{
    const c=clock(),d=deferred();let delivered=0,reads=0;
    const hit=()=>{delivered++;};
    const self={box:{focus:hit},listFocus:{focus:hit},me:()=>({focused:true}),myPane:()=>null};
    const env={nextCommand:()=>{reads++;return reads===1?d.promise:Promise.reject(STOP);},run:hit,spaces:()=>[],openHistory:hit,setShared:hit,holdKeys(){}};
    const job=new AsyncFunction('cx',...Object.keys(env),body).call(self,c.cx,...Object.values(env)).catch(e=>{if(e!==STOP)throw e;});
    await flush();
    for(let i=0;i<3000;i++)await c.tick();
    const subscriptions=d.subscriptions;
    const command=file.includes('pane-chat')?'wide':file.includes('tabs-tasks')?'sessions':'focus';
    d.resolve(command);await job;c.cancel();
    assert.equal(delivered,1);assert.equal(reads,2);
    assert.ok(subscriptions<=1,`${subscriptions} subscriptions to one never-arriving command`);
    assert.equal(c.timers.size,0);
  });
}

test('actual Tasks.watch: quiet folder has bounded observers and timers, then updates immediately',async()=>{
  const c=clock(),d=deferred();let updates=0,opens=0,job;
  const env={watchFolder:()=>{opens++;return d.promise;},dirs:()=>({tasks:'/fixture/tasks'})};
  // The helper is absent on the before tree; the original loop still runs here.
  try {Object.assign(env,await import(new URL('lib/bounded-wait.js',root)));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
  const proto=makeMethod(method('mods/tasks/main.js','watch','\n  // Every connected'),env);
  const self={load:async()=>{updates++;throw STOP;}};
  c.cx.spawn=fn=>{job=fn(c.cx).catch(e=>{if(e!==STOP)throw e;});};
  proto.watch.call(self,c.cx);await flush();
  for(let i=0;i<3000;i++){assert.equal(c.timers.size,1);await c.tick();}
  const subscriptions=d.subscriptions;
  d.resolve(['/fixture/tasks/list.json']);await job;c.cancel();
  assert.equal(opens,1);assert.equal(updates,1);
  assert.ok(subscriptions<=1,`${subscriptions} subscriptions to one quiet watch`);
  assert.equal(c.timers.size,0);
});

export {clock,deferred,flush,method,makeMethod,source,STOP,root};
