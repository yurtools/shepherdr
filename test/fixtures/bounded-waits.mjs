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
  const timers = new Set(), intervals = new Set();
  const after = (ms,fn) => {
    const t={ms,fn,cancel(){timers.delete(t);t.fn=null;},is_done(){return !timers.has(t);}};
    timers.add(t);return t;
  };
  const every=(ms,fn)=>{const t={ms,fn,cancel(){intervals.delete(t);t.fn=null;}};intervals.add(t);return t;};
  const cx={timer:{after,every},sleep:ms=>new Promise(resolve=>after(ms,()=>resolve())),notify(){},spawn(fn){return fn(cx);}};
  return {cx,timers,intervals,async tick(){const ts=[...timers];for(const t of ts){timers.delete(t);t.fn?.(cx);t.fn=null;}await flush();},cancel(){for(const t of [...timers,...intervals])t.cancel();}};
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

for(const value of [undefined,false,null,[]]) test(`actual Tasks.watch: quiet folder then falsey fulfillment ${JSON.stringify(value)}`,async()=>{
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
  d.resolve(value);await job;c.cancel();
  assert.equal(opens,1);assert.equal(updates,1);
  assert.ok(subscriptions<=1,`${subscriptions} subscriptions to one quiet watch`);
  assert.equal(c.timers.size,0);
});

const helper=await import(new URL('lib/bounded-wait.js',root)).catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return null;});
if(helper) {
  const {BoundedWait,TIMEOUT,DISPOSED}=helper;
  test('helper: ten thousand timeouts remove listeners/timers, then delivers all falsey values',async()=>{
    const c=clock(),d=deferred(),w=new BoundedWait();
    for(let i=0;i<10000;i++) {
      const p=w.next(c.cx,'a',()=>d.promise,1000);
      assert.equal(w.current.state.listeners.size,1);assert.equal(c.timers.size,1);
      await c.tick();assert.equal(await p,TIMEOUT);
      assert.equal(w.current.state.listeners.size,0);assert.equal(c.timers.size,0);
    }
    assert.equal(d.subscriptions,1);
    d.resolve(undefined);await flush();assert.deepEqual(await w.next(c.cx,'a',()=>d.promise,1000),{value:undefined});
    for(const value of [false,null,[]])assert.deepEqual(await w.next(c.cx,{},()=>Promise.resolve(value),1000),{value});
    w.dispose();assert.equal(c.timers.size,0);
  });

  test('helper: both event/timeout boundary orders deliver once without an extra subscription',async()=>{
    for(const order of ['event-first','timer-first','same-turn']) {
      const c=clock(),d=deferred(),w=new BoundedWait();
      const p=w.next(c.cx,'a',()=>d.promise,4000);
      if(order==='timer-first')await c.tick();
      d.resolve(false);
      if(order==='event-first')await flush();else await c.tick();
      const got=await p;
      const event=got===TIMEOUT?await w.next(c.cx,'a',()=>d.promise,4000):got;
      assert.deepEqual(event,{value:false});assert.equal(d.subscriptions,1);assert.equal(c.timers.size,0);
      const next=deferred(),p2=w.next(c.cx,'a',()=>next.promise,4000);
      await c.tick();assert.equal(await p2,TIMEOUT); // No duplicate cached event.
      w.dispose();
    }
  });

  test('helper: replacement and dispose cancel raw handles even when host cancellation never settles',async()=>{
    const c=clock(),a=deferred(),b=deferred(),w=new BoundedWait();
    const first=w.next(c.cx,'a',()=>a.promise,5000),old=w.current.state;
    const second=w.next(c.cx,'b',()=>b.promise,5000);
    assert.equal(await first,DISPOSED);assert.equal(a.cancellations,1);assert.equal(old.listeners.size,0);
    a.resolve('late old folder');await flush();assert.equal(w.current.source,b.promise);
    w.dispose();assert.equal(await second,DISPOSED);assert.equal(b.cancellations,1);
    assert.equal(w.current,null);assert.equal(w.pending,null);assert.equal(c.timers.size,0);
    assert.equal(await w.next(c.cx,'c',()=>{throw STOP;},1),DISPOSED);
  });

  test('helper: an event queued just before close/replacement cannot resume a retired view',async()=>{
    for(const action of ['close','replace']) {
      const c=clock(),d=deferred(),w=new BoundedWait(),p=w.next(c.cx,'old',()=>d.promise,1000);
      d.resolve('event');
      // Source observer runs first, then close wins before next() resumes.
      await Promise.resolve();
      if(action==='close')w.dispose();else w.prepare('new',()=>new Promise(()=>{}));
      assert.equal(await p,DISPOSED);w.dispose();assert.equal(c.timers.size,0);
    }
  });

  test('helper: rejection, recovery and stale-timer errors remain separate',async()=>{
    const c=clock(),w=new BoundedWait(),d=deferred();
    const p=w.next(c.cx,'a',()=>d.promise,5000);d.reject(STOP);await assert.rejects(p,e=>e===STOP);
    assert.equal(c.timers.size,0);
    const failed=Symbol('failed');assert.deepEqual(await w.next(c.cx,'a',()=>Promise.reject(STOP),5000,()=>failed),{value:failed});
    const bad={timer:{after(){throw STOP;}}};
    await assert.rejects(w.next(bad,'a',()=>new Promise(()=>{}),1,()=>false),e=>e===STOP);
    w.dispose();
  });

  test('helper: multiple views share one source observer and keep independent timers',async()=>{
    const a=clock(),b=clock(),d=deferred(),wa=new BoundedWait(),wb=new BoundedWait();
    const pa=wa.next(a.cx,'a',()=>d.promise,1000),pb=wb.next(b.cx,'a',()=>d.promise,5000);
    await a.tick();assert.equal(await pa,TIMEOUT);assert.equal(b.timers.size,1);
    d.resolve(null);assert.deepEqual(await pb,{value:null});
    assert.deepEqual(await wa.next(a.cx,'a',()=>d.promise,1000),{value:null});
    assert.equal(d.subscriptions,1);wa.dispose();wb.dispose();
  });

  test('host reload without finally: externally retained sources cannot retain discarded views/cx',async()=>{
    const sources=[],views=[];
    for(let i=0;i<40;i++) {
      const c=clock(),d=deferred();sources.push(d.promise);
      (()=>{const owner={large:new Array(10000).fill(i)},w=new BoundedWait();views.push(new WeakRef(owner));
        (async()=>{await w.next(c.cx,'a',()=>d.promise,4000);owner.ran=true;})();})();
      c.cancel(); // The real host drops callbacks; no promise settles, no finally runs.
    }
    for(let i=0;i<5;i++){await new Promise(setImmediate);global.gc();}
    assert.equal(views.filter(ref=>ref.deref()).length,0);
    assert.equal(sources.length,40);
  });

  test('actual Tasks.watch rejection retries after five seconds, and close cancels its watch',async()=>{
    const c=clock(),a=deferred(),b=deferred();let opens=0,job,updates=0;
    const proto=makeMethod(method('mods/tasks/main.js','watch','\n  // Every connected'),{...helper,watchFolder:()=>++opens===1?a.promise:b.promise,dirs:()=>({tasks:'/tasks'})});
    const self={load:async()=>{updates++;}};c.cx.spawn=fn=>{job=fn(c.cx);};proto.watch.call(self,c.cx);await flush();
    a.reject(STOP);await flush();assert.equal(opens,1);assert.equal([...c.timers][0].ms,5000);assert.equal(updates,0);
    await c.tick();assert.equal(opens,2);
    proto.close.call(self);await job;assert.equal(b.cancellations,1);assert.equal(c.timers.size,0);
  });

  test('actual Inbox: bounded quiet polling, disposal/reopen, old cleanup cannot release the new guard',async()=>{
    const c=clock(),watches=[],jobs=[];let reads=0;
    const text=source('lib/inbox.js'),body=text.slice(text.indexOf('export function startInbox'),text.indexOf('\n// Touches the hook'));
    const env={...helper,exec:async()=>({}),flags:async()=>{},readAsks:async()=>{reads++;},readTasks:async()=>{},ASKS:()=>'/asks',watchFolder:()=>{const d=deferred();watches.push(d);return d.promise;},agentAlerts(){},shared:()=>null,toAgent(){}};
    const start=new Function(...Object.keys(env),`let started=null;${body.replace('export ','')};return startInbox;`)(...Object.values(env));
    c.cx.spawn=fn=>{const p=fn(c.cx);jobs.push(p);return p;};
    const first=start(c.cx);await flush();assert.equal(start(c.cx),undefined);assert.deepEqual([...c.intervals].map(t=>t.ms),[1000,20000,500]);
    for(let i=0;i<3000;i++)await c.tick();
    assert.equal(reads,3001);assert.equal(watches.length,1);assert.equal(watches[0].subscriptions,1);
    watches[0].resolve([]);await flush();assert.equal(reads,3002);assert.equal(watches.length,2);
    first.dispose();await flush();assert.equal(watches[1].cancellations,1);assert.equal(c.timers.size,0);assert.equal(c.intervals.size,0);
    const second=start(c.cx);await flush();first.dispose();assert.equal(start(c.cx),undefined);
    assert.equal(watches.length,3);second.dispose();await Promise.all(jobs);assert.equal(c.intervals.size,0);
  });

  test('actual Chat permission watcher: quiet ticks, local event, remote replacement, close',async()=>{
    const c=clock(),watches=[];let reads=0,remote=0;
    const proto=makeMethod(method('mods/chat/main.js','async watchAsks','\n  // Another machine'),{...helper,exec:async()=>({}),watchFolder:()=>{const d=deferred();watches.push(d);return d.promise;}});
    const self={addr:'agent',askDir:'/asks',readAsks:async()=>{reads++;},readRemoteAsks:async()=>{remote++;}};
    const job=proto.watchAsks.call(self,c.cx);await flush();for(let i=0;i<3000;i++)await c.tick();
    assert.equal(reads,3001);assert.equal(watches[0].subscriptions,1);assert.equal([...c.timers][0].ms,5000);
    watches[0].resolve([]);await flush();assert.equal(reads,3002);
    self.machine='remote';await c.tick();assert.equal(watches[1].cancellations,1);assert.equal(remote,1);assert.equal([...c.timers][0].ms,3000);
    self.machine=null;await c.tick();self.askWait.dispose();await job;assert.equal(watches[2].cancellations,1);
  });

  test('actual Chat transcript follower: quiet ticks, event, folder replacement and close',async()=>{
    const c=clock(),watches=[];let pulls=0;
    const proto=makeMethod(method('mods/chat/main.js','async follow','\n  // ---- sending'),{...helper,starting:()=>false,openCard:()=>false,watchFolder:()=>{const d=deferred();watches.push(d);return d.promise;}});
    const self={path:'/a/log',pending:[],phase:'running',status:()=> 'idle',ownTerminal:()=>null,locate:async()=>{},pull:async()=>{pulls++;},lookJobs:async()=>{},flag:async()=>{},alerts(){},drainQueue(){}};
    const job=proto.follow.call(self,c.cx);await flush();for(let i=0;i<3000;i++)await c.tick();
    assert.equal(pulls,3001);assert.equal(watches[0].subscriptions,1);assert.equal([...c.timers][0].ms,4000);
    watches[0].resolve([]);await flush();assert.equal(pulls,3002);
    self.path='/b/log';await c.tick();assert.equal(watches[1].cancellations,1);
    watches[1].resolve([]);await flush();assert.equal(watches[2].subscriptions,1);
    self.logWait.dispose();await job;assert.equal(watches[2].cancellations,1);
  });

  test('actual voice loop preserves second ticks, heartbeat/alive cadence and navigation-time events',async()=>{
    const c=clock(),watches=[];let time=0,beats=0,touches=0,navigations=0;
    const proto=makeMethod(method('mods/chat/main.js','async followCall','\n  // What the window shows now'),{...helper,Date:{now:()=>time},readTextFile:async()=>'{"phase":"listening"}',exec:async()=>{touches++;},watchFolder:()=>{const d=deferred();watches.push(d);return d.promise;}});
    const self={callDir:'/call',call:{phase:'listening',doing:'',said:'',who:null,started:0},status:()=> 'idle',callShared(){beats++;},callSay(){},callWhere(){},callNav:async()=>{navigations++;if(navigations===1)watches[0].resolve([]);}};
    const job=proto.followCall.call(self,c.cx);await flush();assert.equal(navigations,2);assert.equal(watches.length,2);
    for(let i=0;i<3000;i++){assert.equal([...c.timers][0].ms,1000);time+=1000;await c.tick();}
    assert.equal(watches[1].subscriptions,1);assert.equal(beats,Math.floor(time/16000));assert.equal(touches,Math.floor(time/5000));
    self.call=null;self.voiceWait.dispose();await job;assert.equal(watches[1].cancellations,1);assert.equal(c.timers.size,0);
  });

  for(const name of ['artifacts','spaces-chat'])test(`actual ${name} watch: quiet folder, event and disposal`,async()=>{
    const c=clock(),watches=[];let updates=0,job;
    const env={...helper,dirs:()=>({artifacts:'/artifacts'}),watchFolder:()=>{const d=deferred();watches.push(d);return d.promise;}};
    const proto=makeMethod(method(`mods/${name}/main.js`,'watch',name==='artifacts'?'\n  async load':'\n  // The space\'s own menu'),env);
    const self=name==='artifacts'?{ctx:{},load:async()=>{updates++;}}:{watching:new Map(),git:{},refreshGit(){updates++;}};
    c.cx.spawn=fn=>{job=fn(c.cx);return job;};
    if(name==='artifacts')proto.watch.call(self,c.cx);else proto.watch.call(self,'/repo',c.cx);
    await flush();for(let i=0;i<3000;i++)await c.tick();assert.equal(watches[0].subscriptions,1);
    watches[0].resolve([]);await flush();assert.equal(updates,1);
    if(name==='artifacts')proto.close.call(self);else {self.watching.get('/repo').dispose();self.watching.delete('/repo');}
    await job;assert.equal(watches[1].cancellations,1);assert.equal(c.timers.size,0);
  });

  test('actual Coordinator instructions loop keeps paths, timeout and close behavior',async()=>{
    const c=clock(),watches=[];let job,reads=0;
    const env={...helper,props:()=>({view:'instructions'}),DIR:()=>'/templates',FILE:()=>'/templates/assistant.md',watchFolder:()=>{const d=deferred();watches.push(d);return d.promise;},readTextFile:async()=>{reads++;return 'new instructions';}};
    const proto=makeMethod(method('mods/coordinator/main.js','init','\n  load(cx)'),env),self={load(){},saved:'old instructions'};
    c.cx.spawn=fn=>{job=fn(c.cx);return job;};proto.init.call(self,{},c.cx);await flush();for(let i=0;i<3000;i++)await c.tick();
    assert.equal(watches[0].subscriptions,1);assert.equal([...c.timers][0].ms,5000);
    watches[0].resolve(['/templates/assistant.md']);await flush();assert.equal(reads,1);assert.equal(self.saved,'new instructions');
    self.instructionWait.dispose();await job;assert.equal(watches[1].cancellations,1);
  });
}

export {clock,deferred,flush,method,makeMethod,source,STOP,root};
