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
    const delta = value - this.values[index];
    this.values[index] = value;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
  }
  // Index containing the zero-based cumulative position (or length at end).
  at(position) {
    let index = 0, step = 2 ** Math.floor(Math.log2(this.values.length || 1));
    for (; step >= 1; step /= 2) {
      const next = index + step;
      if (next < this.tree.length && this.tree[next] <= position) { index = next; position -= this.tree[next]; }
    }
    return index;
  }
}

export class PreparedHistory {
  constructor() {
    this.rows = []; this.keys = []; this.index = new Map(); this.positions = new Map();
    this.geometry = new PrefixIndex(); this.missing = new PrefixIndex(); this.settling = new Map();
    this.paths = []; this.artifacts = []; this.strips = []; this.cards = []; this.found = []; this.lit = new Set();
  }
  get sizes() { return this.geometry.values; }
  get total() { return this.geometry.sum(); }
  measure(id, key, height, at) {
    const i = this.positions.get(id);
    if (i === undefined || this.keys[i] !== key) return;
    this.geometry.set(i, Number.isFinite(height)&&height>0?Math.min(height,40000):60); this.missing.set(i, 0);
    if (Date.now() - at < 4000) this.addSettling(i);
  }
  removeSettling(node) {
    if (node.before) node.before.after = node.after; else this.firstSettling = node.after;
    if (node.after) node.after.before = node.before; else this.lastSettling = node.before;
    this.settling.delete(node.i);
  }
  addSettling(i, recent = true) {
    const previous = this.settling.get(i);
    if (previous) this.removeSettling(previous);
    const node = { i, before: null, after: null };
    if (recent) {
      node.after = this.firstSettling;
      if (node.after) node.after.before = node;
      this.firstSettling = node;
      this.lastSettling ??= node;
    } else {
      node.before = this.lastSettling;
      if (node.before) node.before.after = node;
      this.lastSettling = node;
      this.firstSettling ??= node;
    }
    this.settling.set(i, node);
  }
  measureOrder(near, now, measuredAt) {
    const out = [], count = this.missing.sum();
    let a = this.missing.sum(Math.max(0, Math.min(this.rows.length, near + 1))) - 1, b = a + 1;
    while (out.length < 8 && (a >= 0 || b < count)) {
      const left = a >= 0 ? this.missing.at(a) : -Infinity, right = b < count ? this.missing.at(b) : Infinity;
      if (near - left <= right - near) { out.push(left); a--; } else { out.push(right); b++; }
    }
    // Expiry is bounded too. Retire a few old candidates per frame, even while
    // fresh candidates fill the layout budget. No settled full-history scan.
    let visits = 0, node = this.firstSettling;
    while (node && visits++ < 32) {
      const next = node.after, i = node.i;
      if (now - (measuredAt.get(this.keys[i]) ?? 0) >= 4000) this.removeSettling(node);
      else if (out.length < 8) out.push(i);
      node = next;
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
        to[i] = b >= end || a < mid && compare(from[a], from[b]) <= 0 ? from[a++] : from[b++];
      }
    }
    [from, to] = [to, []];
  }
  return from;
}
