import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit, built, dispatch, element, byId } from "./fake-gpui";
import { makeDelimited } from "../test/document-preview-fixtures.ts";
let execute:(command:string,args:string[],opts:any)=>Promise<any>;
let root:string, disk:()=>Promise<string|null>, modelPanes:any[], viewProps:any, state:Map<string,any>, actions:any[], writeDisk:(path:string,text:string,expected:string)=>Promise<void>;
mock.module("herdr",()=>fakeHerdr({appHome:()=>root,theme:()=>new Proxy({},{get:()=>"#111111"}),settings:()=>({}),readTextFile:()=>disk(),exec:(command:string,args:string[],opts:any)=>execute(command,args,opts),writeTextFile:(path:string,text:string,expected:string)=>writeDisk(path,text,expected),panes:()=>modelPanes,props:()=>viewProps,shared:(k:string)=>state.get(k),setShared:(k:string,v:any)=>state.set(k,v),run:(name:string,args:any)=>actions.push([name,args])}));
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
 root=await mkdtemp(join(tmpdir(),"shepherdr-document-tabs-"));execute=async()=>{throw Error("unexpected helper execution")};disk=async()=>"saved";writeDisk=async()=>{throw Error("unexpected source write")};released=[];pending=[];built.length=0;
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
 let complete:(value:string)=>void=()=>{}, started:()=>void=()=>{};const waiting=new Promise<void>(r=>{started=r});disk=()=>new Promise(resolve=>{complete=resolve;started()});view.open("/project/loading.ts",null,cx);await waiting;
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

// Real helper / file bytes, with the host exec and render descriptions as the
// only stand-ins. No app window, task service or actual other machine is used.
async function settle() { for (let at=0;at<pending.length;) { const jobs=pending.slice(at); at=pending.length; await Promise.all(jobs); } }
async function enableReader() {
 const dir=join(root,'mods','workspace-document');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'preview-read.py'),await readFile(new URL('../mods/workspace-document/preview-read.py',import.meta.url)));
 execute=async(command,args)=>{
  const child=Bun.spawn([command,...args],{stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  return {stdout,stderr,code};
 };
}

test('large CSV opens beyond the native 1 MiB read cap, browses the last page and cannot save a prefix',async()=>{
 await enableReader(); const fixture=makeDelimited(join(root,'orders.csv'),2*1024*1024);
 disk=async()=>{throw Error('File exceeds the native 1 MiB read limit')};
 const original=await readFile(fixture.path);view.open(fixture.path,null,cx);await settle();
 const doc=view.docs.get(`:${fixture.path}`);
 expect(doc.error).toBeNull();expect(doc.text).toBeNull();expect(doc.saved).toBeNull();
 expect(doc.table.total).toBe(fixture.rows);expect(doc.table.rows[0][0]).toBe('record');
 expect(doc.rowInput).toBeDefined();expect(doc.sourceInput).toBeDefined();
 built.length=0;view.render(cx);expect(byId('save')).toBeUndefined();expect(byId('csv-last')).toBeDefined();
 expect(built.length).toBeLessThan(1000); // 40 rows × at most 16 cells, not a whole table tree.
 dispatch(byId('csv-next'),'on_click',cx);await settle();expect(doc.table.row).toBe(40);expect(doc.table.rows[0][0]).toBe('40');
 built.length=0;view.render(cx);dispatch(byId('csv-last'),'on_click',cx);await settle();
 expect(doc.table.row%40).toBe(0);expect(doc.table.rows.at(-1)[0]).toBe(String(fixture.rows-1));
 built.length=0;view.render(cx);dispatch(byId('csv-first'),'on_click',cx);await settle();expect(doc.table.row).toBe(0);
 view.tablePage(doc,10003,0,cx);await settle();expect(doc.table.row).toBe(10000);
 built.length=0;view.render(cx);dispatch(byId('mode-Source'),'on_click',cx);built.length=0;view.render(cx);
 expect(byId('source-next')).toBeDefined();expect(byId('save')).toBeUndefined();
 dispatch(byId('source-next'),'on_click',cx);await settle();expect(doc.source.page).toBe(1);
 view.save(doc,cx);await view.draft(doc);expect(await readFile(fixture.path)).toEqual(original);
 await expect(readFile(view.draftPath(doc))).rejects.toThrow();
 built.length=0;view.render(cx);dispatch(byId('mode-Preview'),'on_click',cx);expect(doc.table.row).toBe(10000);
 built.length=0;view.render(cx);dispatch(byId('delimiter-Comma'),'on_click',cx);await settle();expect(doc.table.row).toBe(0);
},10000);

test('small editable TSV still previews unsaved quoted content and saves the entire original buffer',async()=>{
 await enableReader();const path=join(root,'small.tsv'),before='id\tnote\r\n1\t"hello\r\nworld"\r\n';await writeFile(path,before);
 view.open(path,null,cx);await settle();const doc=view.docs.get(`:${path}`);expect(doc.source).toBeNull();expect(doc.text).toBe(before);
 expect(view.csvData(doc).rows[1][1]).toBe('hello\r\nworld');
 doc.text=before.replace('hello','goodbye');expect(view.csvData(doc).rows[1][1]).toBe('goodbye\r\nworld');
 let writes=0;writeDisk=async(p,text,expected)=>{writes++;expect(p).toBe(path);expect(expected).toBe(before);expect(text).toBe(doc.text);await writeFile(p,text);};
 view.save(doc,cx);await settle();expect(writes).toBe(1);expect(await readFile(path,'utf8')).toBe(doc.text);
});

test('growing disk file keeps a dirty draft, reopens it in conflict, and only explicit discard becomes read only',async()=>{
 await enableReader();const path=join(root,'growing.md'),before='# old\n';await writeFile(path,before);
 view.open(path,null,cx);await settle();let doc=view.docs.get(`:${path}`);doc.text='# unsaved\n';await view.draft(doc);
 const large='# new\n'+'large markdown line\n'.repeat(30000);await writeFile(path,large);
 view.check(cx);await settle();expect(doc.conflict).toBe(true);expect(doc.text).toBe('# unsaved\n');expect(doc.source).toBeNull();
 view.save(doc,cx);await settle();await view.closeFile(view.active,cx);
 view.open(path,null,cx);await settle();doc=view.docs.get(`:${path}`);expect(doc.recovered).toBe(true);expect(doc.conflict).toBe(true);expect(doc.text).toBe('# unsaved\n');
 expect(JSON.parse(await readFile(view.draftPath(doc),'utf8')).text).toBe('# unsaved\n');
 view.reload(doc,cx);await settle();expect(doc.source).toBeTruthy();expect(doc.saved).toBeNull();expect(doc.text).toBeNull();
 await expect(readFile(view.draftPath(doc))).rejects.toThrow();
 built.length=0;view.render(cx);expect(byId('save')).toBeUndefined();expect(byId('mode-Source')).toBeDefined();
 view.mode(doc,false,cx);view.sourcePage(doc,1,cx);await settle();expect(doc.source.page).toBe(1);view.save(doc,cx);await settle();
 expect(await readFile(path,'utf8')).toBe(large);
 await writeFile(path,large.replace('# new','# NEW'));view.check(cx);await settle();expect(doc.stale).toBe(true);view.sourcePage(doc,2,cx);await settle();expect(doc.source.page).toBe(1);
 await writeFile(path,before);view.reload(doc,cx);await settle();expect(doc.source).toBeNull();expect(doc.text).toBe(before);expect(doc.conflict).toBe(false);
});

test('large clean source transitions without editing or creating a draft, and oversized edits cannot save',async()=>{
 await enableReader();const path=join(root,'grow.txt');await writeFile(path,'short');view.open(path,null,cx);await settle();const doc=view.docs.get(`:${path}`);
 doc.text='x'.repeat(400001);view.save(doc,cx);await settle();expect(doc.notice).toContain('editing is limited');expect(await readFile(path,'utf8')).toBe('short');
 expect(JSON.parse(await readFile(view.draftPath(doc),'utf8')).text.length).toBe(400001);
 doc.text=doc.saved;await view.draft(doc);await writeFile(path,'y'.repeat(400001));view.check(cx);await settle();
 expect(doc.source).toBeTruthy();expect(doc.saved).toBeNull();expect(doc.text).toBeNull();expect(doc.stale).toBe(false);
 await expect(readFile(view.draftPath(doc))).rejects.toThrow();
});

test('remote preview runs the same bounded reader on the selected machine; source and table requests ignore late closed results',async()=>{
 await enableReader();const path=join(root,'remote.tsv');const fixture=makeDelimited(path,2*1024*1024,'\t');
 const real=execute;let started:()=>void=()=>{},release:()=>void=()=>{};const began=new Promise<void>(r=>{started=r}),wait=new Promise<void>(r=>{release=r});
 let hold=true, scans=0;const calls:any[]=[];
 execute=async(command,args,opts)=>{const request=JSON.parse(args[2]);calls.push([request.op,opts.on,opts.timeout]);
  if(request.op==='scan'){scans++;if(hold){hold=false;started();await wait;}}return real(command,args,opts);
 };
 view.open(path,'remote-one',cx);await began;const old=view.docs.get(`remote-one:${path}`);await view.closeFile(view.active,cx);
 view.open(path,'remote-two',cx);release();await settle();const doc=view.docs.get(`remote-two:${path}`);
 expect(scans).toBe(2);expect(old.closed).toBe(true);expect(old.table).toBeNull();expect(doc.table.total).toBe(fixture.rows);expect(doc.table.delimiter).toBe('\t');
 expect(calls).toContainEqual(['scan','remote-one',20000]);expect(calls).toContainEqual(['scan','remote-two',20000]);
 let sourceStarted:()=>void=()=>{},sourceRelease:()=>void=()=>{};const sourceBegan=new Promise<void>(r=>{sourceStarted=r}),sourceWait=new Promise<void>(r=>{sourceRelease=r});
 execute=async(command,args,opts)=>{if(JSON.parse(args[2]).op==='source'){sourceStarted();await sourceWait;}return real(command,args,opts);};
 view.sourcePage(doc,1,cx);await sourceBegan;await view.closeFile(view.active,cx);sourceRelease();await settle();expect(doc.closed).toBe(true);expect(doc.source.page).toBe(0);
},10000);

test('Office and raster-image panes never become text editors or Save targets',async()=>{
 let reads=0;disk=async()=>{reads++;throw Error('unexpected text read')};
 execute=async()=>({code:0,stdout:JSON.stringify({kind:'docx',markdown:'# Report',notice:'Read only'}),stderr:''});
 view.open('/project/report.docx',null,cx);await settle();let doc=view.docs.get(key('report.docx'));expect(doc.office.markdown).toBe('# Report');
 view.save(doc,cx);view.editor(doc);await view.draft(doc);expect(doc.editor).toBeUndefined();built.length=0;view.render(cx);expect(byId('save')).toBeUndefined();
 view.open('/project/picture.png',null,cx);await settle();doc=view.docs.get(key('picture.png'));expect(doc.error).toContain('Image preview');expect(reads).toBe(0);
 built.length=0;view.render(cx);expect(byId('save')).toBeUndefined();expect(byId('document-original')).toBeDefined();
});

// Find tests operate the real per-tab controller, with host Input/scroll APIs
// substituted. Even the scratch file/draft is checked for unintended writes.
async function findQuery(doc:any, query:string) {
  cx.timer.after=(_ms:number,fn:any)=>fn(cx);
  view.openFind(doc,cx);
  doc.find.input={value:()=>query,release(){},focus(){}};
  view.refreshFind(doc,cx);await settle();
}
test('literal, Unicode source Find, wrap navigation, and close leave draft and source unchanged',async()=>{
 const saved='const 🦀 = "saved";\n';
 const draft='const 🦀 = "Needle";\n// needle [literal]\nconst later = "NEEDLE";';
 const doc=add('find.ts',draft,saved);view.active=key('find.ts');
 let selected:any;doc.editor.set_selected_range=(r:any)=>selected=r;doc.editor.focus=()=>{};
 await findQuery(doc,'needle');
 expect(doc.find.hits.map((hit:any)=>draft.slice(hit.start,hit.end))).toEqual(['Needle','needle','NEEDLE']);
 expect(doc.find.index).toBe(0);
 view.stepFind(doc,-1,cx);expect(doc.find.index).toBe(2);
 view.stepFind(doc,1,cx);expect(doc.find.index).toBe(0);
 view.closeFind(doc,cx);expect(doc.find).toBeNull();expect(draft.slice(selected.start,selected.end)).toBe('Needle');
 expect(doc.text).toBe(draft);expect(doc.saved).toBe(saved);
 await expect(readFile(view.draftPath(doc))).rejects.toThrow();
});

test('Markdown rendered Find sees emphasis, link labels, table cells and code, not link targets or markup',async()=>{
 const md='# **Need**le &eacute; &NotEqualTilde;\n\n[Needle](https://hidden.invalid)\n\n| A | B |\n|---|---|\n| a | needle |\n\n\`\`\`js\nNEEDLE\n\`\`\`';
 const doc=add('find.md',md,md);doc.kind='markdown';doc.preview=true;view.active=key('find.md');
 await findQuery(doc,'needle');
 expect(doc.find.hits).toHaveLength(4);
 expect(doc.find.rendered.text).not.toContain('https://');
 expect(doc.find.rendered.text).toContain('Needle é ≂̸');
 await findQuery(doc,'é');expect(doc.find.hits).toHaveLength(1);
 await findQuery(doc,'hidden.invalid');expect(doc.find.hits).toHaveLength(0);
 view.mode(doc,false,cx);await settle();
 expect(doc.find.hits).toHaveLength(1);expect(doc.text).toBe(md);expect(doc.saved).toBe(md);
});

test('buffer CSV Find includes unsaved long cells beyond visible row and column pages',async()=>{
 const line=Array.from({length:21},(_,i)=>i===20?'x'.repeat(190)+'needle':'cell').join(',');
 const doc=add('wide.csv',('plain\n').repeat(73)+line,'saved');doc.kind='csv';doc.preview=true;view.active=key('wide.csv');
 await findQuery(doc,'needle');expect(doc.find.hits).toHaveLength(1);
 expect([doc.page,doc.col]).toEqual([73,20]);
 expect(doc.find.current.excerpt).toContain('needle');
 built.length=0;view.render(cx);expect(built.some(el=>el.calls.some(([name,args]:any)=>name==='accessibility_label'&&String(args[0]).startsWith('Current match')))).toBe(true);
 expect(doc.text.endsWith(line)).toBe(true);expect(doc.saved).toBe('saved');
});

test('Office Find navigates later sheet and row/column, labels partial, Word searches rendered table values',async()=>{
 const doc=add('wide.xlsx');doc.kind='excel';doc.text=doc.saved=null;
 const rows=Array.from({length:89},()=>[] as string[]);rows[88]=Array(82).fill('');rows[88][81]='needle';
 doc.office={sheets:[{name:'first',rows:[['needle']]},{name:'second',rows,limited:true}],limited:false};
 view.active=key('wide.xlsx');await findQuery(doc,'needle');expect(doc.find.hits).toHaveLength(2);expect(doc.find.limited).toBe(true);
 view.stepFind(doc,1,cx);expect([doc.sheet,doc.page,doc.col]).toEqual([1,88,81]);
 built.length=0;view.render(cx);expect(built.some(el=>el.calls.some(([n,a]:any)=>n==='accessibility_label'&&a[0]==='Current match · needle'))).toBe(true);
 const word=add('table.docx');word.kind='docx';word.text=word.saved=null;word.office={markdown:'# Heading\n\n| A | B |\n| --- | --- |\n| **Needle** | two |',limited:true};
 view.active=key('table.docx');await findQuery(word,'needle');expect(word.find.hits).toHaveLength(1);expect(word.find.limited).toBe(true);
 expect(word.find.rendered.text).toContain('Needle');
 expect(doc.find.hits).toHaveLength(2); // per-tab state
});

test('a large table Find uses the real helper and lands on its later wide cell',async()=>{
 await enableReader();
 const path=join(root,'late.csv'),line=Array(19).fill('x').join(',')+',needle\n';
 await writeFile(path,'x'.repeat(100)+'\n'+('x'.repeat(100)+'\n').repeat(12000)+line);
 view.open(path,null,cx);await settle();
 const doc=view.docs.get(`:${path}`);expect(doc.source).toBeTruthy();
 await findQuery(doc,'needle');expect(doc.find.hits).toHaveLength(1);
 expect(doc.table.row).toBe(12001);expect(doc.table.col).toBe(19);expect(doc.table.rows[0][0]).toBe('needle');
 expect(doc.text).toBeNull();expect(doc.saved).toBeNull();
},30000);

test('obsolete async Find and closed/reopened files cannot receive old highlights',async()=>{
 const doc=add('large.txt');doc.text=doc.saved=null;doc.source={page:0,start:0,end:10,text:'old needle'};doc.sourceVersion='one';doc.sourceSize=100000;view.active=key('large.txt');
 let start:()=>void=()=>{},release:(r:any)=>void=()=>{};
 const began=new Promise<void>(r=>start=r), held=new Promise<any>(r=>release=r);
 doc.reader={call:async(op:string,args:any)=>{if(op==='find-source'&&args.query==='needle'){start();return held;}return{hits:[{start:0,end:3,page:0}],done:true};}};
 cx.timer.after=(_ms:number,fn:any)=>fn(cx);
 view.openFind(doc,cx);
 doc.find.input={value:()=>'needle',release(){},focus(){}};
 view.refreshFind(doc,cx);await began;
 const old=doc.find;
 doc.find.input={value:()=>'new',release(){},focus(){}};view.refreshFind(doc,cx);
 expect(doc.find.hits).toEqual([]);
 release({hits:[{start:4,end:10,page:0}],done:true});await settle();
 expect(doc.find.query).toBe('new');expect(doc.find.hits[0].start).toBe(0);
 let beganAgain:()=>void=()=>{},releaseAgain:(r:any)=>void=()=>{};
 const waiting=new Promise<void>(r=>beganAgain=r),late=new Promise<any>(r=>releaseAgain=r);
 doc.reader={call:async()=>{beganAgain();return late;}};
 doc.find.input={value:()=>'again',release(){},focus(){}};view.refreshFind(doc,cx);await waiting;
 await view.closeFile(view.active,cx);add('large.txt','replacement','replacement');view.active=key('large.txt');
 releaseAgain({hits:[{start:4,end:10,page:0}],done:true});await settle();
 expect(old.closed).toBe(true);expect(view.docs.get(view.active).find).toBeUndefined();expect(old.hits).toEqual([]);
});

test('native PDF Find navigates the matched page and hides obsolete-version boxes',async()=>{
 const doc=add('report.pdf');doc.kind='pdf';doc.text=doc.saved=null;
 let loaded=0;
 doc.pdf={page:1,pages:2,result:{version:'v',page:1,image:'/tmp/page.png',width:1546,height:2000},size:{width:500,height:500},fit:true,
   call:async()=>({hits:[{page:2,boxes:[[.1,.2,.3,.25]]}],hasText:true,done:true}),load(){loaded++}};
 view.active=key('report.pdf');await findQuery(doc,'needle');
 expect(doc.pdf.page).toBe(2);expect(loaded).toBe(1);
 doc.pdf.result.page=2;built.length=0;view.render(cx);
 expect(built.some(el=>el.calls.some(([n,a]:any)=>n==='bg'&&a[0]==='#f59e0b66'))).toBe(true);
 doc.pdf.result.version='changed';built.length=0;view.render(cx);
 expect(built.some(el=>el.calls.some(([n,a]:any)=>n==='bg'&&a[0]==='#f59e0b66'))).toBe(false);
});

test('paged source Find loads its actual page and closes without a draft or save',async()=>{
 await enableReader();
 const path=join(root,'paged.txt'),content='a'.repeat(400000)+'🦀Needle\n';
 await writeFile(path,content);view.open(path,null,cx);await settle();
 const doc=view.docs.get(`:${path}`);expect(doc.source.page).toBe(0);
 await findQuery(doc,'needle');
 expect(doc.find.hits).toHaveLength(1);expect(doc.source.page).toBe(Math.floor(400004/32768));
 expect(doc.source.text.endsWith('🦀Needle\n')).toBe(true);
 expect(doc.text).toBeNull();expect(doc.saved).toBeNull();
 view.closeFind(doc,cx);
 expect(await readFile(path,'utf8')).toBe(content);
 await expect(readFile(view.draftPath(doc))).rejects.toThrow();
},30000);

test('switching documents pauses a running Find, reselecting resumes only its query',async()=>{
 const a=add('a.txt'),b=add('b.txt','second file');a.text=a.saved=null;a.source={page:0,start:0,end:6,text:'needle'};a.sourceVersion='v';a.sourceSize=6;
 view.active=key('a.txt');
 let started:()=>void=()=>{},release:(r:any)=>void=()=>{};const began=new Promise<void>(r=>started=r),first=new Promise<any>(r=>release=r);
 let scans=0;a.reader={call:async()=>{scans++;if(scans===1){started();return first;}return{hits:[{start:0,end:6,page:0}],done:true};}};
 cx.timer.after=(_ms:number,fn:any)=>fn(cx);view.openFind(a,cx);
 a.find.input={value:()=>'needle',release(){},focus(){}};view.refreshFind(a,cx);await began;
 view.selectFile(key('b.txt'),cx);release({hits:[{start:0,end:6,page:0}],done:true});await settle();
 expect(a.find.paused).toBe(true);expect(a.find.hits).toEqual([]);expect(b.find).toBeUndefined();
 view.selectFile(key('a.txt'),cx);await settle();expect(a.find.hits).toHaveLength(1);expect(scans).toBe(2);
});
