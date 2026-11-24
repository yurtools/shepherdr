// A pending host promise gets ONE observer, however many periodic waits time out.
// Shared source: edit lib/, then bin/sync-shared. No host imports: the caller owns
// the original cancellable handle and the timer belongs to the supplied cx.
export const TIMEOUT = Symbol('timeout');
export const DISPOSED = Symbol('disposed');
const observed = new WeakMap();
// Host cancellation removes the timer's strong reference. Reap its weak slot
// after GC as well, even if this source is retained and never settles again.
const abandoned = new FinalizationRegistry(({ state, ref }) => state.listeners.delete(ref));

function settle(state, outcome) {
  state.outcome = outcome;
  const listeners = [...state.listeners];
  state.listeners.clear();
  for (const ref of listeners) ref.deref()?.(outcome);
}

// Deliberately separate from next()/listen(): these closures must capture only
// state, never a view, cx, timer, resolver, or the original FolderWatch handle.
function observe(source) {
  let state = observed.get(source);
  if (!state) {
    state = { outcome: null, listeners: new Set() };
    observed.set(source, state);
    source.then(value => settle(state, { value }), error => settle(state, { error }));
  }
  return state;
}

function listen(state, cx, ms) {
  let stop;
  const promise = new Promise((resolve, reject) => {
    let timer = null, active = true;
    const finish = outcome => {
      if (!active) return;
      active = false;
      state.listeners.delete(ref);
      abandoned.unregister(ref);
      timer?.cancel();
      timer = null;
      resolve(outcome);
    };
    const ref = new WeakRef(finish);
    // The host drops timer callbacks on close/reload WITHOUT settling awaits or
    // running finally. Weak listeners let the abandoned continuation and its
    // view/cx be collected even if somebody retains the source forever.
    for (const old of state.listeners) if (!old.deref()) state.listeners.delete(old);
    state.listeners.add(ref);
    abandoned.register(finish, { state, ref }, ref);
    stop = () => finish(DISPOSED);
    try { timer = cx.timer.after(ms, () => finish(TIMEOUT)); }
    catch (error) { state.listeners.delete(ref); abandoned.unregister(ref); active = false; reject(error); }
  });
  return { promise, stop };
}

// One sequential mixed event/timeout loop. The key identifies its source (e.g.
// a folder). A timeout keeps that source; settlement consumes it. Replacement,
// clear and dispose cancel the ORIGINAL handle, even when cancel never settles.
export class BoundedWait {
  constructor() { this.current = null; this.pending = null; this.disposed = false; }

  clear() {
    const current = this.current;
    this.current = null;
    const pending = this.pending;
    this.pending = null;
    pending?.stop();
    current?.source.cancel?.();
  }

  dispose() { this.disposed = true; this.clear(); }

  prepare(key, open) {
    if (this.disposed) return;
    if (this.current && this.current.key !== key) this.clear();
    if (!this.current) {
      const source = open();
      this.current = { key, source, state: observe(source) };
    }
  }

  async next(cx, key, open, ms, onRejected) {
    if (this.disposed) return DISPOSED;
    this.prepare(key, open);
    const current = this.current;
    let outcome = current.state.outcome;
    if (!outcome) {
      const pending = listen(current.state, cx, ms);
      this.pending = pending;
      try { outcome = await pending.promise; }
      finally { if (this.pending === pending) this.pending = null; }
    }
    if (this.disposed || this.current !== current) return DISPOSED;
    if (outcome === TIMEOUT || outcome === DISPOSED) return outcome;
    if (this.current === current) this.current = null;
    // Only source failures may be recovered. A stale cx/timer failure must end
    // the loop, rather than being swallowed and starting a busy microtask loop.
    if ('error' in outcome) {
      if (onRejected) return { value: onRejected(outcome.error) };
      throw outcome.error;
    }
    return { value: outcome.value };
  }
}
