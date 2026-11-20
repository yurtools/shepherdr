import { expect, test } from "bun:test";
import { measuredHeight, viewportScroll, hoverMessage, measureOrder, pendingMarkdownHeight, messageChunks } from "./chat-layout.js";
test("a tall last reply becoming visible does not mean the viewport is at the bottom", () => {
 expect(viewportScroll(100, -20, 3000, 800)).toEqual({ offset: 120, bottom: false });
 expect(viewportScroll(2190, -30, 3000, 800)).toEqual({ offset: 2200, bottom: true });
 expect(viewportScroll(2200, 50, 3000, 800)).toEqual({ offset: 2150, bottom: false });
});
test("fractional layout noise cannot oscillate a settled message's height", () => {
 expect(measuredHeight(200, 200.3)).toBe(200);
 expect(measuredHeight(200, 200.7)).toBe(200);
 expect(measuredHeight(200, 230.1)).toBe(230);
 expect(measuredHeight(200, NaN)).toBe(200);
});
test("hover repaint changes only when entering another message, not within a long reply", () => {
 const rows = [{ id: "intro" }, { id: "long", blk: "reply" }, { id: "bar", of: "reply" }];
 expect(hoverMessage(20, 200, rows, [100, 2000, 30])).toBe("reply");
 expect(hoverMessage(700, 200, rows, [100, 2000, 30])).toBe("reply");
});
test("settled visible replies are not remeasured indefinitely; revised content is", () => {
 const rows = [{ id: "a" }, { id: "b" }], heights = new Map([["a:old", 500]]), at = new Map([["a:old", 1000]]);
 expect(measureOrder(rows, ["a:old", "b:new"], heights, at, 0, 6000)).toEqual([1]);
 expect(measureOrder(rows, ["a:old", "b:new"], heights, at, 0, 2000)).toEqual([1, 0]);
 expect(measureOrder(rows, ["a:revised", "b:new"], heights, at, 0, 6000)).toEqual([0, 1]);
});

test("long Markdown placeholders wait for content, while short labels and folded text remain measurable",()=>{
 const row={kind:'agent',text:'A real paragraph with visible words. '.repeat(100)};
 expect(pendingMarkdownHeight(row,23,800)).toBe(true);
 expect(pendingMarkdownHeight(row,1400,800)).toBe(false);
 expect(pendingMarkdownHeight({...row,clip:420},23,800)).toBe(false);
 expect(pendingMarkdownHeight({kind:'agent',text:'[Short label](https://example.com/'+ 'path/'.repeat(1000)+')'},23,800)).toBe(false);
 expect(pendingMarkdownHeight({kind:'agent',text:'<!--'+ 'hidden '.repeat(1000)+'-->Short reply'},23,800)).toBe(false);
});
test('external context messages expand as bounded rows without losing UTF-16 text',()=>{
 const text=('A lengthy context paragraph with links https://example.test/file\n').repeat(800)+'😀tail';
 const chunks=messageChunks(text);expect(chunks.length).toBeGreaterThan(10);expect(chunks.join('')).toBe(text);
 expect(chunks.every(s=>s.length<=4001)).toBe(true);
 expect(chunks.every(s=>!/[\uD800-\uDBFF]$/.test(s))).toBe(true);
 const rows=Array.from({length:100},(_,i)=>({id:String(i)}));
 expect(measureOrder(rows,rows.map(r=>r.id),new Map(),new Map(),99,Date.now()).length).toBeLessThanOrEqual(8);
});

test('measurement selection matches distance/index priority without sorting cold history',()=>{
 const rows=Array.from({length:10000},(_,i)=>({id:String(i)})),keys=rows.map(r=>r.id),heights=new Map(),at=new Map();
 let visits=0;const has=heights.has.bind(heights);heights.has=k=>{visits++;return has(k);};
 expect(measureOrder(rows,keys,heights,at,9999,6000)).toEqual([9999,9998,9997,9996,9995,9994,9993,9992]);expect(visits).toBe(8);
 let seed=7123;
 for(let run=0;run<100;run++){
  heights.clear();at.clear();
  for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;if(seed%3)heights.set(keys[i],20);at.set(keys[i],seed%7000);}
  const small=rows.slice(0,100),names=keys.slice(0,100);
  for(const near of [-10,0,3.5,20,99,110,NaN,Infinity]){
   const fresh=small.map((_,i)=>i).filter(i=>!heights.has(names[i])).sort((a,b)=>Math.abs(a-near)-Math.abs(b-near)).slice(0,30);
   const settling=small.map((_,i)=>i).filter(i=>heights.has(names[i])&&6000-(at.get(names[i])??0)<4000);
   expect(measureOrder(small,names,heights,at,near,6000)).toEqual([...new Set([...fresh,...settling])].slice(0,8));
  }
 }
});
