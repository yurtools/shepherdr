// The window's chat (mods/chat) with Herdr zoomed in (GitHub #759): the window reports sizes and presses in pixels at
// the zoom while the chat lays its rows out at zoom 1. A row's measured height went to the list as it came (blank space
// under every row, ~0.9x it at zoom 1.9), and a press was compared with places worked out at zoom 1 (Show more, a
// card's Submit, Accept: missed). No window runs here, so gpui and herdr are stand-ins that keep the handlers given.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";
import { flowchart, chartHeight, fitCamera, FLOW_MAX_ZOOM } from "../core/chat-flowchart.js";

let zoom = 1;
let comfortable = false;
let historyMissing = false;
let markdownScrolling:boolean[]=[];
let projectSpaces:any[]=[];let projectRoots:any;let projectOverlay:any;
const handlers: Record<string, ((...a: any[]) => void)[]> = {};
function el(): any {
  const self: any = new Proxy({}, {
    get(_t, k) {
      if (k === "then") return undefined;
      if (k === "scrollable") return (value:boolean) => { markdownScrolling.push(value); return self; };
      if (k === "when") return (c: unknown, f: (e: any) => any) => (c ? f(self) : self);
      if (k === "on_size_change") return (f: any) => { (handlers.size ??= []).push(f); return self; };
      if (k === "on_mouse_down") return (_b: string, f: any) => { (handlers.down ??= []).push(f); return self; };
      return () => self;
    },
  });
  return self;
}
const theme = new Proxy({}, { get: () => "#000000" });
mock.module("herdr", () => fakeHerdr({
  settings: () => ({ zoom }), theme: () => theme, shared: (key: string) => key === "workspace.roots" ? projectRoots : key === "chat.width" && comfortable ? "comfortable" : undefined, setShared: () => {}, agents: () => [], panes: () => [],
  terminals: () => [], spaces: () => projectSpaces, openOverlay: (x:any) => { projectOverlay=x; }, machines: () => [], knownAgents: () => [], props: () => ({}), window: () => ({ platform: "linux" }),
  home: () => "/nonexistent-home", appHome: () => "/nonexistent-app",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: historyMissing ? "No conversation found with id example" : "", stderr: "" }),
  readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
}));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {}, div: el, svg: el, image: el }));
mock.module("gpui-base", () => fakeGpuiBase({ v_flex: el, h_flex: el, v_virtual_list: el, Scrollbar: el, TextView: { markdown: el } }));
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Chat } = await import("../mods/chat/main.js");
const { default: FlowchartViewer } = await import("../mods/chat-flowchart/main.js");
const chat = () => {
  const c: any = Object.create(Chat.prototype);
  Object.assign(c, { heights: new Map(), measuredAt: new Map(), measureGen: 0, width: 600, range: null, pinned: false, cardW: new Map() });
  c.row = () => el();
  return c;
};
const cx: any = { notify: () => {} };

describe("the window's chat at Herdr's zoom (GitHub #759)", () => {
  beforeEach(() => { comfortable = false; for (const k of Object.keys(handlers)) delete handlers[k]; });

  for (const z of [1, 1.7]) {
    test(`a row 100 px tall gets 100 px in the list at zoom ${z}`, () => {
      zoom = z;
      const c = chat();
      c.measurer([{ id: "a", kind: "text" }], ["a"], theme);
      handlers.size[0]({ width: 600 * z, height: 100 * z }, cx);
      expect(c.heights.get("a")).toBeCloseTo(100);
    });

    test(`Show more takes a press on its words at zoom ${z}`, () => {
      zoom = z;
      const c = chat();
      let folded = 0;
      c.toggleFold = () => { folded++; };
      // The pane, 1130 px wide at zoom 1, as the window reports it; the press on Show more's words (the column's
      // left edge, the bubble's padding in, 30 px into the words), where it's drawn.
      c.paneSize({ width: 1130 * z, height: 800 * z });
      const { left } = c.edges();
      c.notePress({ local_position: { x: (left + 12 + 30) * z, y: 300 * z } });
      const rows = [{ id: "f", kind: "fold" }];
      c.clickRow("f", rows, cx, [40]);
      expect(folded).toBe(1);
    });
  }

  // #775: a long reply measured with words laid out at an older width overlapped the next row.
  test("the measurer's rows are new ones after a width change", () => {
    zoom = 1;
    const c = chat();
    const seen: string[] = [];
    c.row = (_x: any, _t: any, pre: string) => { seen.push(pre); return el(); };
    c.measurer([{ id: "a", kind: "text" }], ["a"], theme);
    c.measureGen++;
    c.heights.clear();
    c.measurer([{ id: "a", kind: "text" }], ["a"], theme);
    expect(seen[0]).not.toBe(seen[1]);
  });
});

test("Chat uses wide panes by default, retains a comfortable option, and never grows beyond a narrow pane", () => {
  const c = chat(); c.width = 1800;
  expect(c.column()).toBe(1764);
  expect(c.edges()).toEqual({ left: 18, right: 1782 });
  comfortable = true;
  expect(c.column()).toBe(760);
  expect(c.edges().left).toBeGreaterThan(400);
  c.width = 480;
  expect(c.edges()).toEqual({ left: 18, right: 462 });
});

test("closing an extra Chat view releases its UI without releasing the original agent's permission hooks", async () => {
  const c = chat();
  let releases = 0, canceled = 0;
  Object.assign(c, { companion: "extra", addr: "t1", machine: null,
    box: { release: () => releases++ }, findBox: { release: () => releases++ },
    scroll: { release: () => releases++ }, dict: { cancel: () => canceled++ } });
  await c.close({});
  expect(releases).toBe(3); expect(canceled).toBe(1);
  expect(c.resumable()).toBe(false);
  expect(await c.checkLost("t1", {})).toBe(false);
});

test("a missing explicitly resumed history session never falls back to a new conversation", async () => {
  const c = chat(); historyMissing = true;
  let fresh = 0;
  Object.assign(c, { lostTried: new Set(), lostSession: async () => fresh++ });
  try {
    await c.checkLost("saved", {}, { argv: ["codex", "resume", "00000000-0000-0000-0000-000000000001"], labels: { "herdr.session": "key" }, state: "live" });
    expect(c.resumeMissing).toBe(true); expect(fresh).toBe(0);
  } finally { historyMissing = false; }
});

test("same-length content changes invalidate native Markdown measurements while hover does not",()=>{
 const c=chat();c.findQuery=()=>'';c.opened=new Set();c.unfolded=new Set();const row:any={id:'reply',kind:'agent',text:'word text'};
 const first=c.key(row);expect(c.key({...row})).toBe(first);
 expect(c.key({...row,text:'word\ntext'})).not.toBe(first);
});

test("project references search the Files root on the space's machine, independently of the target agent",()=>{
 const c=chat();c.myPane=()=> 'target-chat';c.machine='remote-agent';projectSpaces=[{id:'local-space',active:true,folder:'/project'}];projectRoots={'local-space':'/files-override'};
 try {c.openProjectFile({timer:{after(){}}});expect(projectOverlay.props).toMatchObject({root:'/files-override',on:null,pane:'target-chat',space:'local-space'});
 projectSpaces[0].machine='project-host';c.machine=null;c.openProjectFile({timer:{after(){}}});expect(projectOverlay.props.on).toBe('project-host');}
 finally {projectSpaces=[];projectRoots=undefined;projectOverlay=null;}
});

test("an old-width measurement cannot overwrite the resized reply's height",()=>{
 zoom=1;handlers.size=[];const c=chat();const row:any={id:'long',kind:'agent',text:'long reply'};
 c.measurer([row],['key'],theme);const old=handlers.size[0];
 c.measureGen++;c.width=400;c.heights.clear();c.measuredAt.clear();handlers.size=[];
 c.measurer([row],['key'],theme);handlers.size[0]({width:400,height:1800},cx);
 old({width:600,height:23},cx);expect(c.heights.get('key')).toBe(1800);
});
test("Show more after a preview resize remeasures the reply instead of restoring its cached placeholder",()=>{
 zoom=1;comfortable=false;handlers.size=[];const c=chat();c.findQuery=()=>'';c.opened=new Set();c.results=new Map();c.unfolded=new Set(['reply']);c.scroll={scroll_to_item(){}};
 const row:any={id:'reply',blk:'reply',kind:'agent',text:'A paragraph. '.repeat(500)},fold:any={id:'fold:reply',of:'reply',blk:'reply',kind:'fold',open:true};
 const other:any={id:'previous',kind:'agent',text:'Earlier reply'};const oldKey=c.key(row),otherKey=c.key(other);c.heights.set(otherKey,90);c.heights.set(oldKey,23);c.measuredAt.set(oldKey,Date.now()-10000);
 c.measurer([row],[oldKey],theme); // settled old entries do not get another hidden view
 expect(handlers.size).toHaveLength(0);
 c.toggleFold(fold,[other,row,fold]);c.toggleFold({...fold,open:false},[other,{...row,clip:420},fold]);
 const freshKey=c.key(row);expect(freshKey).not.toBe(oldKey);expect(c.heights.has(oldKey)).toBe(false);expect(c.heights.get(otherKey)).toBe(90);
 c.width=400;c.measureGen++;c.measurer([row],[freshKey],theme);expect(handlers.size).toHaveLength(1);
 handlers.size[0]({width:400,height:2500},cx);expect(c.heights.get(freshKey)).toBe(2500);expect(c.unfolded.has('reply')).toBe(true);
});
test("a delayed callback from before collapse cannot restore an obsolete expanded-row height",()=>{
 zoom=1;handlers.size=[];const c=chat();c.findQuery=()=>'';c.opened=new Set();c.results=new Map();c.unfolded=new Set(['reply']);c.scroll={scroll_to_item(){}};
 const row:any={id:'reply',blk:'reply',kind:'agent',text:'Long reply'},fold:any={id:'fold:reply',of:'reply',blk:'reply',kind:'fold'};const key=c.key(row);
 c.measurer([row],[key],theme);const old=handlers.size[0];c.toggleFold(fold,[row,fold]);old({width:600,height:23},cx);expect(c.heights.has(key)).toBe(false);expect(c.measuredAt.has(key)).toBe(false);
});

test("expanded and folded replies leave wheel scrolling to the conversation list",()=>{
 markdownScrolling=[];comfortable=false;const c=chat();c.findMark=(text:string)=>text;c.mentionsIn=(text:string)=>text;
 const text='A long paragraph. '.repeat(500);
 c.rowBare({id:'expanded',kind:'agent',text},theme);c.rowBare({id:'folded',kind:'agent',text,clip:420},theme);c.rowBare({id:'prompt',kind:'user',text},theme);
 expect(markdownScrolling).toEqual([false,false,false]);
});

test("native flowchart source and copy controls route separately at the pane's zoom",()=>{
 zoom=1.7;comfortable=false;const c=chat();c.opened=new Set();c.diagramSources=new Set();
 const code='graph LR\nA --> B  ',row={kind:'codehead',id:'msg:h0',diagram:true,code};
 const copies:any[]=[];c.copy=(text:string,id:string)=>copies.push([text,id]);
 c.paneSize({width:500*zoom,height:800*zoom});
 const right=c.edges().right;
 c.notePress({local_position:{x:(right-4-110)*zoom,y:100*zoom}});
 c.clickRow(row.id,[row],cx,[34]);
 expect(c.diagramSources.has(row.id)).toBe(true);expect(copies).toEqual([]);
 c.notePress({local_position:{x:(right-4-36)*zoom,y:100*zoom}});
 c.clickRow(row.id,[row],cx,[34]);
 expect(copies).toEqual([[code,row.id]]);expect(c.diagramSources.has(row.id)).toBe(true);
 c.notePress({local_position:{x:(right-4-110)*zoom,y:100*zoom}});
 c.clickRow(row.id,[row],cx,[34]);
 expect(c.diagramSources.has(row.id)).toBe(false);
 expect(c.historyRevision).toBe(2);
});

test("native historical diagram expands the prepared geometry at narrow widths and zoom without moving chat",()=>{
  zoom=1.7;comfortable=false;const c=chat();
  const code='graph LR; '+Array.from({length:13},(_,i)=>`N${i}[Stage ${i+1}]`).join(' --> ')+'  ';
  const drawing=flowchart(code).drawing!;
  const rows=[{id:'old:c0',kind:'diagram',side:'user',code,drawing,result:{drawing},bot0:true},
    {id:'old:c1',kind:'diagram',side:'agent',code,drawing,result:{drawing},bot0:true}];
  c.paneSize({width:320*zoom,height:800*zoom});c.scrollTop=404;c.pinned=false;c.historyRevision=7;
  const right=c.edges().right;
  projectOverlay=undefined;
  c.notePress({local_position:{x:(right-270)*zoom,y:100*zoom}});
  c.clickRow(rows[0].id,rows,cx,[100,100]);expect(projectOverlay).toBeUndefined();
  c.notePress({local_position:{x:(right-40)*zoom,y:100*zoom}});
  c.pressMoved=true;c.clickRow(rows[0].id,rows,cx,[100,100]);expect(projectOverlay).toBeUndefined();
  c.pressMoved=false;c.clickRow(rows[0].id,rows,cx,[100,100]);
  expect(projectOverlay).toMatchObject({mod:'chat-flowchart',kind:'dialog',modal:true,props:{drawing,code}});
  expect(projectOverlay.props.drawing).toBe(drawing);
  expect(c.scrollTop).toBe(404);expect(c.pinned).toBe(false);expect(c.historyRevision).toBe(7);
  expect(c.guessBare(rows[0])).toBe(18+chartHeight(drawing,214));
  // Find targets the selected diagram, including when the fenced source is shown.
  c.findQuery=()=> 'Stage 13'; c.findIdx=1;
  const sourceRow={...rows[1],kind:'code',drawing:undefined};
  expect(c.findDiagram([rows[0],sourceRow])).toBe(sourceRow);
  c.expandFindDiagram([rows[0],sourceRow]);expect(projectOverlay.props.drawing).toBe(drawing);
});

test("native expanded viewer owns wheel, keyboard, drag and zoom; resize clamps the camera",()=>{
  zoom=1.7;const v:any=Object.create(FlowchartViewer.prototype);
  v.code='graph LR; '+Array.from({length:13},(_,i)=>`N${i}[Stage ${i+1}]`).join(' --> ')+'  ';
  v.drawing=flowchart(v.code).drawing;v.room={width:260,height:60};v.camera=fitCamera();
  let stops=0,notifies=0,copied='',closed=0;v.dismiss=()=>closed++;v.handle={focus(){}};
  const eventCx={stop_propagation(){stops++},notify(){notifies++},write_to_clipboard(s:string){copied=s},timer:{after(){return {cancel(){}}}}};
  v.key({key:'1'},eventCx);expect(v.view().scale).toBe(1);
  v.key({key:'home'},eventCx);expect(v.view().left).toBeCloseTo(0);
  v.wheel({delta:{x:0,y:-100*zoom},modifiers:{shift:true}},eventCx);expect(v.view().left).toBeCloseTo(-100);
  v.down({position:{x:200,y:100}},eventCx);v.move({position:{x:100,y:80}},eventCx);expect(v.view().left).toBeLessThan(-150);
  v.key({key:'end'},eventCx);expect(v.view().left+v.view().width).toBeCloseTo(v.room.width);
  v.size({width:600*zoom,height:200*zoom},eventCx);expect(v.view().left+v.view().width).toBeCloseTo(600);
  v.key({key:'0'},eventCx);expect(v.view().width).toBeLessThanOrEqual(v.room.width);
  for(let i=0;i<25;i++)v.key({key:'+'},eventCx);expect(v.view().scale).toBe(FLOW_MAX_ZOOM);
  v.key({key:'c',modifiers:{control:true}},eventCx);expect(copied).toBe(v.code);
  v.key({key:'escape'},eventCx);expect(closed).toBe(1);
  expect(stops).toBeGreaterThan(30);expect(notifies).toBeGreaterThan(30);
});

test("a long reply keeps its estimated space until native Markdown finishes, even after the old settling deadline",()=>{
 zoom=1;comfortable=false;handlers.size=[];const c=chat(),row={id:'long',kind:'agent',text:'A paragraph with visible words. '.repeat(200)};
 c.measurer([row],['expanded'],theme);handlers.size[0]({width:600,height:23.2},cx);
 expect(c.heights.has('expanded')).toBe(false);expect(c.measuredAt.has('expanded')).toBe(false);
 handlers.size=[];c.measurer([row],['expanded'],theme);expect(handlers.size).toHaveLength(1);
 handlers.size[0]({width:600,height:1800},cx);expect(c.heights.get('expanded')).toBe(1800);expect(c.measuredAt.has('expanded')).toBe(true);
});
