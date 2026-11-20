import { expect, test } from 'bun:test';
import { PrefixIndex, PreparedHistory, RecentIndex } from './chat-preparation.js';
import { measureOrder } from './chat-layout.js';

test('prefix sums normalize fractions and nonfinite/out-of-range endpoints', () => {
  const index = new PrefixIndex(); [10, 20, 30].forEach(n => index.push(n));
  for (const [end, sum] of [[-10, 0], [NaN, 0], [-Infinity, 0], [Infinity, 60], [100, 60], [2.9, 30], [0.9, 0]]) expect(index.sum(end)).toBe(sum);
  for(const bad of [-1,NaN,Infinity,0.5,100])index.set(bad,999);
  expect(index.sum()).toBe(60);
  for (const [position, at] of [[-10, 0], [NaN, 0], [-Infinity, 0], [Infinity, 3], [10.5, 1], [59.9, 2], [60, 3]]) expect(index.at(position)).toBe(at);
});

test('indexed fresh measurement selection matches the previous distance/index rule at every edge', () => {
  for (const count of [0, 1, 20, 100]) for (const near of [-1000, -0.5, 0, 0.1, 3.5, 3.9, 19.9, 9999, NaN, Infinity, -Infinity]) {
    const rows = Array.from({ length: count }, (_, i) => ({ id: String(i) })), keys = rows.map(r => r.id);
    const heights = new Map(), at = new Map(), plan = new PreparedHistory(); plan.rows = rows; plan.keys = keys; plan.recent=new RecentIndex(count);
    rows.forEach((r, i) => { if (i % 3 === 0) heights.set(r.id, 30); plan.missing.push(heights.has(r.id) ? 0 : 1); });
    expect(plan.measureOrder(near, 6000, at)).toEqual(measureOrder(rows, keys, heights, at, near, 6000));
  }
});

test('settling selection matches the old rule without scanning any expired rows', () => {
  const plan = new PreparedHistory(), at = new Map(), heights=new Map();plan.recent=new RecentIndex(2000);
  for (let i = 0; i < 2000; i++) {
    plan.rows.push({ id: String(i) }); plan.keys.push(String(i)); plan.positions.set(String(i), i);
    plan.geometry.push(30); plan.missing.push(0);plan.recent.set(i,1);at.set(String(i),1);heights.set(String(i),30);
  }
  plan.measure('1999', '1999', 100, Date.now()); at.set('1999', Date.now());
  let reads=0;const tree=plan.recent.tree;plan.recent.tree=new Proxy(tree,{get(target,key){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key);}});
  const now=Date.now();expect(plan.measureOrder(1999,now,at)).toEqual(measureOrder(plan.rows,plan.keys,heights,at,1999,now));
  expect(reads).toBeGreaterThan(0); expect(reads).toBeLessThan(100);
  plan.measure('1999', '1999', 100000, Date.now()); expect(plan.sizes[1999]).toBe(40000);
});
