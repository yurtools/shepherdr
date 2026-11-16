import { expect, test } from "bun:test";
import { measuredHeight, viewportScroll, hoverMessage, measureOrder, pendingMarkdownHeight } from "./chat-layout.js";
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
