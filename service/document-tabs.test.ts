import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, built, dispatch } from "./fake-gpui";
let root:string, disk:()=>Promise<string|null>, modelPanes:any[], viewProps:any, state:Map<string,any>, actions:any[];
mock.module("herdr",()=>fakeHerdr({appHome:()=>root,theme:()=>new Proxy({},{get:()=>"#111111"}),settings:()=>({}),readTextFile:()=>disk(),panes:()=>modelPanes,props:()=>viewProps,shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),run:(name:string,args:any)=>actions.push([name,args])}));
mock.module("gpui-kit",()=>fakeGpuiKit());mock.module("gpui-base",()=>fakeGpuiBase());
const { default: Document }=await import("../mods/workspace-document/main.js");
let view:any, pending:Promise<any>[], released:string[], cx:any;
const key=(name:string)=>`:/project/${name}`;
function add(name:string,text="saved",saved="saved") {
 const doc:any={path:`/project/${name}`,on:null,text,saved,kind:"text",editor:{release(){released.push(name)}}};
 view.docs.set(key(name),doc);return doc;
}
beforeEach(async()=>{
 modelPanes=[];viewProps={};state=new Map();actions=[];(globalThis as any).localStorage={getItem:()=>null,setItem(){},removeItem(){}};
 root=await mkdtemp(join(tmpdir(),"shepherdr-document-tabs-"));disk=async()=>"saved";released=[];pending=[];built.length=0;
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
