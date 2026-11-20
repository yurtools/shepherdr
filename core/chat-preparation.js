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

  step(limit = 8, clock = () => Date.now()) {
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
          break;
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

// Growable prefix sums: measurements update one height without a history-wide
// sizes/reduce pass in render. The second tree locates unmeasured neighbours.
export class PrefixIndex {
  constructor() { this.values = []; this.tree = [0]; }
  sum(end = this.values.length) {
    end = Number.isFinite(end) ? Math.max(0, Math.min(this.values.length, Math.floor(end))) : end === Infinity ? this.values.length : 0;
    let out = 0;
    for (let i = end; i > 0; i -= i & -i) out += this.tree[i];
    return out;
  }
  push(value) {
    const i = this.values.length + 1;
    this.tree[i] = value + this.sum(i - 1) - this.sum(i - (i & -i));
    this.values.push(value);
  }
  set(index, value) {
    if(!Number.isInteger(index)||index<0||index>=this.values.length)return;
    const delta = value - this.values[index];
    this.values[index] = value;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
  }
  // Index containing the zero-based cumulative position (or length at end).
  at(position) {
    if (Number.isNaN(position) || position < 0) position = 0;
    let index = 0, step = 2 ** Math.floor(Math.log2(this.values.length || 1));
    for (; step >= 1; step /= 2) {
      const next = index + step;
      if (next < this.tree.length && this.tree[next] <= position) { index = next; position -= this.tree[next]; }
    }
    return index;
  }
}

// A range maximum finds the first still-settling row without scanning expired
// history. Timestamps only change at a measured row; expiry needs no cleanup.
export class RecentIndex {
  constructor(count) {
    this.count=count;this.base=2**Math.ceil(Math.log2(count||1));this.tree=[];
  }
  set(index,at) {
    if(!Number.isInteger(index)||index<0||index>=this.count)return;
    let i=this.base+index;this.tree[i]=at;
    while(i>1){i=Math.floor(i/2);this.tree[i]=Math.max(this.tree[i*2]??0,this.tree[i*2+1]??0);}
  }
  firstSince(cutoff,from=0) {
    const find=(node,left,right)=>{
      if(right<=from||(this.tree[node]??0)<=cutoff)return this.count;
      if(node>=this.base)return left;
      const mid=(left+right)/2,hit=find(node*2,left,mid);
      return hit<this.count?hit:find(node*2+1,mid,right);
    };
    return find(1,0,this.base);
  }
}

export class PreparedHistory {
  constructor() {
    this.rows = []; this.keys = []; this.index = new Map(); this.positions = new Map();
    this.geometry = new PrefixIndex(); this.missing = new PrefixIndex(); this.recent = new RecentIndex(0);
    this.paths = []; this.artifacts = []; this.strips = []; this.cards = []; this.found = []; this.lit = new Set();
  }
  get sizes() { return this.geometry.values; }
  get total() { return this.geometry.sum(); }
  measure(id, key, height, at) {
    const i = this.positions.get(id);
    if (i === undefined || this.keys[i] !== key) return;
    this.geometry.set(i, Number.isFinite(height)&&height>0?Math.min(height,40000):60); this.missing.set(i, 0);
    this.recent.set(i,at);
  }

  measureOrder(near, now, measuredAt) {
    near = Number.isFinite(near) ? near : 0;
    const out = [], count = this.missing.sum(), n=this.rows.length;
    let a = this.missing.sum(Math.floor(near) + 1) - 1, b = a + 1;
    while (out.length < 8 && (a >= 0 || b < count)) {
      const left = a >= 0 ? this.missing.at(a) : -Infinity, right = b < count ? this.missing.at(b) : Infinity;
      if (near - left <= right - near) { out.push(left); a--; } else { out.push(right); b++; }
    }
    let from=0;
    while(out.length<8){
      const i=this.recent.firstSince(now-4000,from);
      if(i>=n)break;
      out.push(i);from=i+1;
    }
    return out;
  }
}

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
        // Native sort treats a NaN comparator result as equality, stably.
        to[i] = b >= end || a < mid && !(compare(from[a], from[b]) > 0) ? from[a++] : from[b++];
      }
    }
    [from, to] = [to, []];
  }
  return from;
}
