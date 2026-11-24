// Loaded after the unmodified lib/bounded-wait.js module by the C harness.
// The host has deterministic, cancellable timers. These are not real GPUI ticks.
globalThis.timers = new Set();
globalThis.cx = {timer:{after(ms, fn) {
  const task={fn,cancel(){timers.delete(task);task.fn=null;}};
  timers.add(task);return task;
}}};
globalThis.tick = () => {for(const t of [...timers]) {const fn=t.fn;t.cancel();fn?.();}};
globalThis.cancelled = 0;
globalThis.never = () => {const p=new Promise(()=>{});p.cancel=()=>{cancelled++;};return p;};
globalThis.resolveSource = null;
globalThis.source = new Promise(resolve=>{resolveSource=resolve;});
source.cancel=()=>{cancelled++;};
globalThis.wait = new BoundedWait();
globalThis.total = 0;
globalThis.lastView = null;
globalThis.failure = null;
globalThis.done = true;
globalThis.step = count => {
  done=false;failure=null;
  (async()=>{
    for(let i=0;i<count;i++) {
      total++;
      if(mode==='repeated_race')await Promise.race([source,Promise.resolve()]);
      if(mode==='helper_timeout') {
        const p=wait.next(cx,'source',()=>source,1000);tick();
        if(await p!==TIMEOUT)throw Error('expected timeout');
      }
      if(mode==='helper_replace') {
        const p=wait.next(cx,total,never,4000);
        wait.prepare(total+0.5,never);
        if(await p!==DISPOSED)throw Error('replacement failed');
      }
      if(mode==='helper_dispose') {
        const w=new BoundedWait(),p=w.next(cx,total,never,5000);
        w.dispose();if(await p!==DISPOSED)throw Error('disposal failed');
      }
      if(mode==='helper_reload') {
        // Keep the same source rooted forever; discard views WITHOUT dispose or
        // finally. Only host-style timer callback cancellation removes roots.
        (()=>{
          const view={data:new Array(1000).fill(total)},w=new BoundedWait();
          lastView=new WeakRef(view);
          (async()=>{await w.next(cx,'source',()=>source,4000);view.resumed=true;})();
        })();
        for(const t of [...timers])t.cancel();
      }
    }
    done=true;
  })().catch(e=>{failure=String(e.stack||e);done=true;});
};
globalThis.check = () => {
  if(timers.size)throw Error('timer retained');
  if(mode==='helper_timeout' && wait.current.state.listeners.size)throw Error('listener retained after timeout');
  if(mode==='helper_reload' && lastView.deref())throw Error('discarded view retained');
};
globalThis.deliver = () => {
  done=false;
  (async()=>{
    if(mode==='helper_timeout') {
      const p=wait.next(cx,'source',()=>source,1000);resolveSource(false);
      const result=await p;if(result.value!==false || timers.size)throw Error('event not delivered immediately');
    }
    if(mode==='helper_replace')wait.clear();
    wait.dispose();done=true;
  })().catch(e=>{failure=String(e.stack||e);done=true;});
};
