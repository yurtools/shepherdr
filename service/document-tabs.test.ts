import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, built, dispatch, element, byId } from "./fake-gpui";
let root:string, disk:()=>Promise<string|null>, modelPanes:any[], viewProps:any, state:Map<string,any>, actions:any[], writeDisk:(path:string,text:string,expected:string)=>Promise<void>;
mock.module("herdr",()=>fakeHerdr({appHome:()=>root,theme:()=>new Proxy({},{get:()=>"#111111"}),settings:()=>({}),readTextFile:()=>disk(),writeTextFile:(path:string,text:string,expected:string)=>writeDisk(path,text,expected),panes:()=>modelPanes,props:()=>viewProps,shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),run:(name:string,args:any)=>actions.push([name,args])}));
mock.module("gpui-kit",()=>fakeGpuiKit());mock.module("gpui-base",()=>fakeGpuiBase({TextView:{markdown:(id:string,text:string)=>element("TextView").id(id).child(text)}}));
const { default: Document }=await import("../mods/workspace-document/main.js");
let view:any, pending:Promise<any>[], released:string[], cx:any;
const key=(name:string)=>`:/project/${name}`;
function add(name:string,text="saved",saved="saved") {
 const doc:any={path:`/project/${name}`,on:null,text,saved,kind:"text",editor:{release(){released.push(name)}}};
 view.docs.set(key(name),doc);return doc;
}
beforeEach(async()=>{
 modelPanes=[];viewProps={};state=new Map();actions=[];(globalThis as any).localStorage={getItem:()=>null,setItem(){},removeItem(){}};
 root=await mkdtemp(join(tmpdir(),"shepherdr-document-tabs-"));disk=async()=>"saved";writeDisk=async()=>{throw Error("unexpected source write")};released=[];pending=[];built.length=0;
 view=Object.create(Document.prototype);view.docs=new Map();
 cx={notify(){},stop_propagation(){},timer:{after(){}},spawn(fn:any){const p=Promise.resolve(fn(cx));pending.push(p);return p;}};
});
afterEach(async()=>{await Promise.all(pending);await rm(root,{recursive:true,force:true});});
test("closing one file preserves other tabs and chooses the next, previous, then empty state",async()=>{
 add("a.ts");add("b.ts");add("c.ts");view.active=key("b.ts");
 await view.closeFile(key("b.ts"),cx);expect([...view.docs.keys()]).toEqual([key("a.ts"),key("c.ts")]);expect(view.active).toBe(key("c.ts"));
 await view.closeFile(key("c.ts"),cx);expect(view.active).toBe(key("a.ts"));
 await view.closeFile(key("a.ts"),cx);expect(view.active).toBeNull();expect(view.docs.size).toBe(0);expect(released).toEqual(["b.ts","c.ts","a.ts"]);
});

test('PDF open, source commands, save, drafts and reload never read or write text bytes', async () => {
 let reads=0; disk=async()=>{reads++;throw Error('PDF must never reach text loader')};
 // The document routes to the actual common loader; replace only its host execution boundary.
 const { PdfPreview }=await import('../mods/workspace-document/pdf-view.js');
 const call=PdfPreview.prototype.call;
 PdfPreview.prototype.call=async function(op:string){return op==='render'?{page:1,pages:2,version:'one',image:'/tmp/page.png',width:1546,height:2000}:{};};
 try {
  view.open('/project/report.pdf',null,cx,{root:'/project',space:'one'});await Promise.all(pending);
  const doc=view.docs.get(key('report.pdf'));expect(doc.kind).toBe('pdf');expect(doc.pdf.pages).toBe(2);expect(doc.editor).toBeUndefined();
  view.save(doc,cx);view.editor(doc);await view.draft(doc);view.reload(doc,cx);await Promise.all(pending);
  built.length=0;view.render(cx);expect(byId('save')).toBeUndefined();expect(byId('mode-Source')).toBeUndefined();expect(byId('pdf-next')).toBeDefined();
  expect(reads).toBe(0);await expect(readFile(view.draftPath(doc))).rejects.toThrow();
  await view.closeFile(key('report.pdf'),cx);expect(doc.pdf.closed).toBe(true);
 } finally { PdfPreview.prototype.call=call; }
});

test('two spaces with identical PDF filenames keep distinct loaders and reopening refreshes', async()=>{
 const { PdfPreview }=await import('../mods/workspace-document/pdf-view.js');
 const call=PdfPreview.prototype.call;let renders=0;
 PdfPreview.prototype.call=async function(op:string){if(op==='render'){renders++;return{page:1,pages:2,version:String(renders),image:'/tmp/page.png',width:1546,height:2000};}return{};};
 try {
  view.open('/one/report.pdf',null,cx,{root:'/one',space:'one'});view.open('/two/report.pdf',null,cx,{root:'/two',space:'two'});await Promise.all(pending);
  const one=view.docs.get(':/one/report.pdf'),two=view.docs.get(':/two/report.pdf');
  expect(one.pdf).not.toBe(two.pdf);expect(one.pdf.token).not.toBe(two.pdf.token);expect(one.root).toBe('/one');expect(two.root).toBe('/two');
  view.open('/one/report.pdf',null,cx);await Promise.all(pending);expect(renders).toBe(3);
  await view.close();expect(one.pdf.closed).toBe(true);expect(two.pdf.closed).toBe(true);
 } finally { PdfPreview.prototype.call=call; }
});
test("closing an inactive tab keeps focus on the active file",async()=>{
 add("a.ts");add("b.ts");view.active=key("a.ts");await view.closeFile(key("b.ts"),cx);expect(view.active).toBe(key("a.ts"));
});
test("the close button affects its own tab without selecting it",async()=>{
 add("a.ts");const doc=add("b.ts");view.active=key("a.ts");const tab=view.fileTab(key("b.ts"),doc,new Proxy({},{get:()=>"#111111"}));
 const button=tab.kids[1];expect(button.calls.some(([name,args]:any)=>name==="child"&&args[0]==="×")).toBe(true);
 dispatch(button,"on_click",cx);await Promise.all(pending);expect(view.docs.has(key("b.ts"))).toBe(false);expect(view.active).toBe(key("a.ts"));
});
test("unsaved edits survive closing and reopening, without writing the source file",async()=>{
 const doc=add("draft.md","unsaved edit");view.active=key("draft.md");await view.closeFile(view.active,cx);
 expect(JSON.parse(await readFile(view.draftPath(doc),"utf8")).text).toBe("unsaved edit");
 view.open(doc.path,null,cx);await Promise.all(pending);const reopened=view.docs.get(key("draft.md"));
 expect(reopened.text).toBe("unsaved edit");expect(reopened.saved).toBe("saved");expect(reopened.recovered).toBe(true);expect(reopened.conflict).toBe(false);
});
test("failed draft persistence keeps the file and its editor open",async()=>{
 const doc=add("draft.md","unsaved");view.active=key("draft.md");view.draft=async()=>{throw new Error("disk full")};
 await view.closeFile(view.active,cx);expect(view.docs.get(view.active)).toBe(doc);expect(doc.notice).toContain("disk full");expect(doc.closing).toBe(false);expect(released).toEqual([]);
});
test("a file closed while loading cannot allocate an editor or replace a reopened copy",async()=>{
 let complete:(value:string)=>void=()=>{};disk=()=>new Promise(resolve=>{complete=resolve});view.open("/project/loading.ts",null,cx);
 const old=view.docs.get(key("loading.ts"));await view.closeFile(key("loading.ts"),cx);expect(old.closed).toBe(true);
 disk=async()=>"new contents";view.open("/project/loading.ts",null,cx);complete("stale contents");await Promise.all(pending);
 expect(old.editor).toBeUndefined();expect(view.docs.get(key("loading.ts")).text).toBe("new contents");
});
test("closing during Save waits and a repeat close does not duplicate draft writes",async()=>{
 const doc=add("a.ts");view.active=key("a.ts");doc.saving=true;await view.closeFile(view.active,cx);expect(view.docs.has(view.active)).toBe(true);expect(doc.notice).toContain("saving");
 doc.saving=false;let writes=0,complete:()=>void=()=>{};view.draft=()=>{writes++;return new Promise<void>(resolve=>{complete=resolve})};
 const close=view.closeFile(view.active,cx);await view.closeFile(view.active,cx);expect(writes).toBe(1);complete();await close;expect(released).toEqual(["a.ts"]);
});

test("closing the last document closes only the pane identified by its own slot",async()=>{
 modelPanes=[{pane:'wrong',mod:'workspace-document'},{pane:'own',mod:'workspace-document'}];viewProps={slot:'own-slot'};state.set('workspace.documents',{'own-slot':'own','other-slot':'wrong'});
 view.pane='wrong';add('draft.md','unsaved');view.active=key('draft.md');await view.closeFile(view.active,cx);
 expect(actions).toEqual([['pane.close',{pane:'own'}]]);expect(state.get('workspace.documents')).toEqual({'other-slot':'wrong'});
});
test("a failed final draft and a concurrently opened file both keep the pane",async()=>{
 modelPanes=[{pane:'own',mod:'workspace-document'}];add('draft.md','unsaved');view.active=key('draft.md');view.draft=async()=>{throw Error('disk full')};
 await view.closeFile(view.active,cx);expect(actions).toEqual([]);
 let complete:()=>void=()=>{};view.draft=()=>new Promise<void>(r=>{complete=r});const closing=view.closeFile(view.active,cx);add('new.ts');complete();await closing;expect(actions).toEqual([]);expect(view.docs.size).toBe(1);
});

// These test document state and real scratch-file bytes, not native glyphs.
// The real renderer/font regressions live in patches/herdr-app/0.1.16/.
test("Markdown Source/Preview toggles and drafts preserve all source bytes",async()=>{
 const source="**alpha** __bravo__ *italic* ***both*** **outer *inner***\n\\**escaped\\** **[link](https://example.invalid)** **`code`** café Ελληνικά 日本語\n";
 const path=join(root,"emphasis.md");await writeFile(path,source);
 const doc=add("emphasis.md",source,source);doc.path=path;doc.kind="markdown";doc.preview=true;view.active=key("emphasis.md");
 for(let i=0;i<2;i++) {
  built.length=0;view.render(cx);dispatch(byId("mode-Source"),"on_click",cx);expect(doc.preview).toBe(false);
  built.length=0;view.render(cx);dispatch(byId("mode-Preview"),"on_click",cx);expect(doc.preview).toBe(true);
  expect(doc.text).toBe(source);expect(doc.saved).toBe(source);
 }
 const draft=source.replace("**alpha**","__alpha__");expect(draft.length).toBe(source.length);doc.text=draft;
 await view.draft(doc);const kept=JSON.parse(await readFile(view.draftPath(doc),"utf8"));
 expect(Buffer.from(kept.text)).toEqual(Buffer.from(draft));expect(kept.saved).toBe(source);
 expect(await readFile(path)).toEqual(Buffer.from(source));
 writeDisk=async(p,text,expected)=>{expect(p).toBe(path);expect(await readFile(p,"utf8")).toBe(expected);await writeFile(p,text);};
 view.save(doc,cx);await Promise.all(pending);
 expect(doc.saved).toBe(draft);expect(await readFile(path)).toEqual(Buffer.from(draft));
 await expect(readFile(view.draftPath(doc))).rejects.toThrow();
});
test("same-length Markdown reloads replace clean text and retain a conflicting draft",async()=>{
 const first="**alpha** café 日本語\n",second="__bravo__ café 日本語\n";
 expect(first.length).toBe(second.length);
 const path=join(root,"reload.md");await writeFile(path,first);disk=()=>readFile(path,"utf8");
 const doc=add("reload.md",first,first);doc.path=path;doc.kind="markdown";doc.preview=true;view.active=key("reload.md");
 await writeFile(path,second);view.check(cx);await Promise.all(pending);
 expect(doc.text).toBe(second);expect(doc.saved).toBe(second);expect(doc.conflict).toBe(false);
 doc.text=first;await view.draft(doc);await writeFile(path,second.replace("bravo","delta"));
 view.check(cx);await Promise.all(pending);expect(doc.conflict).toBe(true);expect(doc.text).toBe(first);
 expect(JSON.parse(await readFile(view.draftPath(doc),"utf8")).text).toBe(first);
 view.reload(doc,cx);await Promise.all(pending);
 expect(doc.text).toBe(await readFile(path,"utf8"));expect(doc.saved).toBe(doc.text);expect(doc.conflict).toBe(false);
 expect(doc.preview).toBe(true);
});

for (const [name,eol] of [["LF","\n"],["CRLF","\r\n"],["CR","\r"],["mixed","\r\n"]]) {
 test(`code Preview, drafts and guarded saves preserve ${name} source bytes`,async()=>{
  const source=`Before café${eol}${eol}\`\`\`txt${eol}α${name==="mixed"?"\r":eol}β${eol}\`\`\`${eol}${eol}After 🦀`;
  const path=join(root,"code.md");await writeFile(path,source);
  const doc=add("code.md",source,source);doc.path=path;doc.kind="markdown";doc.preview=true;view.active=key("code.md");
  built.length=0;view.render(cx);dispatch(byId("mode-Source"),"on_click",cx);
  built.length=0;view.render(cx);dispatch(byId("mode-Preview"),"on_click",cx);
  await view.draft(doc);await expect(readFile(view.draftPath(doc))).rejects.toThrow();
  expect(Buffer.from(doc.saved)).toEqual(Buffer.from(source));expect(doc.text).toBe(source);
  const edited=source.replace("β","γ");doc.text=edited;await view.draft(doc);
  const draft=JSON.parse(await readFile(view.draftPath(doc),"utf8"));
  expect(Buffer.from(draft.text)).toEqual(Buffer.from(edited));expect(draft.saved).toBe(source);
  let writes=0;
  writeDisk=async(p,text,expected)=>{
   writes++;expect(expected).toBe(source);expect(Buffer.from(text)).toEqual(Buffer.from(edited));
   if(await readFile(p,"utf8")!==expected)throw Error("File changed outside the editor");
   await writeFile(p,text);
  };
  view.save(doc,cx);await Promise.all(pending);expect(writes).toBe(1);
  expect(await readFile(path)).toEqual(Buffer.from(edited));expect(doc.saved).toBe(edited);
 });
}

test("EOL-only edits stay dirty and EOL-only disk changes trigger the save guard",async()=>{
 const source="```txt\r\na\r\nb\r\n```\r\n",edited=source.replaceAll("\r\n","\n");
 const path=join(root,"eols.md");await writeFile(path,source);disk=()=>readFile(path,"utf8");
 const doc=add("eols.md",edited,source);doc.path=path;doc.kind="markdown";doc.preview=true;view.active=key("eols.md");
 await view.draft(doc);expect(JSON.parse(await readFile(view.draftPath(doc),"utf8")).text).toBe(edited);
 // The external version renders identically but its bytes must still conflict.
 const external=source.replaceAll("\r\n","\r");await writeFile(path,external);
 writeDisk=async(p,text,expected)=>{
  expect(expected).toBe(source);expect(text).toBe(edited);
  if(await readFile(p,"utf8")!==expected)throw Error("File changed outside the editor");
  throw Error("guard unexpectedly permitted a write");
 };
 view.save(doc,cx);await Promise.all(pending);expect(doc.conflict).toBe(true);expect(doc.saved).toBe(source);expect(doc.text).toBe(edited);
 expect(await readFile(path)).toEqual(Buffer.from(external));
 expect(JSON.parse(await readFile(view.draftPath(doc),"utf8")).text).toBe(edited);
 view.check(cx);await Promise.all(pending);expect(doc.conflict).toBe(true);expect(doc.text).toBe(edited);
 view.reload(doc,cx);await Promise.all(pending);expect(doc.text).toBe(external);expect(doc.saved).toBe(external);
 expect(doc.conflict).toBe(false);await expect(readFile(view.draftPath(doc))).rejects.toThrow();
});
