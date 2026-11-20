// Native history preparation is a cooperative transaction, never render work.
// A new source revision queues a successor without restarting a running pass.
// Presentation changes cancel it: rows from another context cannot be acted on.
export class Preparation {
  constructor() {
    this.snapshot = null;
    this.context = null;
    this.source = null;
    this.pending = null;
    this.running = null;
    this.closed = false;
  }

  request(context, source, create) {
    if (this.closed) return;
    if (!equal(context, this.context)) {
      this.context = context;
      this.snapshot = null;
      this.running = null;
      this.pending = null;
      this.source = null;
    }
    if (equal(source, this.source)) return;
    this.source = source;
    this.pending = { context, source, create };
  }

  step(limit = 8, clock = () => performance.now()) {
    if (this.closed) return { visits: 0, changed: false };
    const start = clock();
    let visits = 0, changed = false;
    try {
      while (visits < limit && (visits === 0 || clock() - start < 3)) {
        if (!this.running) {
          if (!this.pending) break;
          this.running = this.pending;
          this.pending = null;
          this.running.iterator = this.running.create();
        }
        const work = this.running;
        const next = work.iterator.next();
        visits++;
        // A callback may invalidate or close its owner while preparing a row.
        if (this.closed || this.running !== work) break;
        if (next.done) {
          this.snapshot = next.value;
          this.running = null;
          changed = true;
        }
      }
      return { visits, changed };
    } catch (error) {
      // Retry the same source on the next request. Never keep a poisoned cursor.
      this.running = null;
      this.source = null;
      return { visits, changed, error };
    }
  }

  get busy() { return !this.closed && !!(this.running || this.pending); }

  close() {
    this.closed = true;
    this.snapshot = this.running = this.pending = this.source = this.context = null;
  }
}

export const equal = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

// Stable merge sort. Sorting a large history must also yield, including copying
// runs; native Array.sort would hide an entire pass inside one callback.
export function* sortPlan(values, compare) {
  let from = values, to = [];
  for (let width = 1; width < values.length; width *= 2) {
    for (let base = 0; base < values.length; base += width * 2) {
      const mid = Math.min(values.length, base + width), end = Math.min(values.length, base + width * 2);
      let a = base, b = mid;
      for (let i = base; i < end; i++) {
        yield;
        to[i] = b >= end || a < mid && compare(from[a], from[b]) <= 0 ? from[a++] : from[b++];
      }
    }
    [from, to] = [to, []];
  }
  return from;
}
