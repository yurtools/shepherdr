import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {element,byId,handler,built} from './fake-gpui';
const reset=()=>{built.length=0};
const source=readFileSync(new URL('../mods/workspace-changes/main.js',import.meta.url),'utf8')
 .replace(/^import[^\n]+\n/gm,'').replace('export default class WorkspaceChanges','class WorkspaceChanges');
const deferred=()=>{let resolve:any;const promise=new Promise<any>(r=>resolve=r);return {resolve,promise}};
const repo=(root:string,path='same.txt')=>({root,name:root.split('/').pop(),branch:'main',count:1,files:[{path,status:'M',add:1,del:1}]});
function harness(){
 let space:any={active:true,id:'space-a',folder:'/projects',machine:null},roots:any={},value='',storage=new Map<string,string>(),changed:any;
 const tasks:Promise<any>[]=[];const calls:any[]=[];let backend:any=async()=>({repos:[repo('/projects/a'),repo('/projects/b')],roots:['/projects/a','/projects/b'],warnings:[]});
 const cx:any={notify(){},focus_handle:()=>({}),spawn:(f:any)=>{const p=Promise.resolve(f(cx));tasks.push(p);return p},timer:{every(){}}};
 const factory=()=>element('div');
 const Class=new Function('api',`const {View,div,v_flex,h_flex,InputState,Input,Scrollbar,v_virtual_list,spaces,shared,exec,readTextFile,appHome,theme,settings,projectFolder,localStorage}=api;${source};return WorkspaceChanges;`)({
  View:class{},div:factory,v_flex:factory,h_flex:factory,v_virtual_list:factory,Input:{new:factory},Scrollbar:{vertical:factory},
  InputState:{new:()=>({value:()=>value,set_value:(s:string)=>{value=s;changed?.({},cx)},on:(event:string,f:any)=>{if(event==='change')changed=f}})},
  spaces:()=>[space],shared:()=>roots,exec:async(...args:any[])=>{calls.push(args);const payload=JSON.parse(args[1][2]);return {code:0,stdout:JSON.stringify(await backend(payload,args[2]))}},
  readTextFile:async()=> '# Python source',appHome:()=>'/app',theme:()=>({}),settings:()=>({}),projectFolder:async()=>roots[space.id]||space.folder,
  localStorage:{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)}});
 const view=new Class();view.init({},cx);
 const settle=async()=>{for(let n=0;n<tasks.length;n++)await tasks[n]};
 return {view,cx,calls,settle,setSpace:(s:any)=>space={active:true,...s},setRoots:(r:any)=>roots=r,setBackend:(f:any)=>backend=f,type:(s:string)=>{value=s;changed({},cx)},get value(){return value},storage};
}
test('the Changes panel uses space roots rather than focused terminal cwd and preserves machine in backend calls',async()=>{
 const h=harness();await h.settle();expect(h.calls[0][2].on).toBe(null);expect(JSON.parse(h.calls[0][1][2]).folder).toBe('/projects');
 h.setSpace({id:'remote/space-b',folder:'/remote-projects',machine:'remote'});h.view.refresh(h.cx);await h.settle();
 expect(h.calls.at(-1)[2].on).toBe('remote');expect(JSON.parse(h.calls.at(-1)[1][2]).folder).toBe('/remote-projects');
 expect(h.calls.at(-1)[0]).toBe('python3');expect(h.calls.at(-1)[1][0]).toBe('-c');
});
test('identical paths stay in distinct repo groups and selection and drafts survive switching spaces',async()=>{
 const h=harness();await h.settle();expect(h.view.listRows().filter((r:any)=>r.file).map((r:any)=>r.repo.root)).toEqual(['/projects/a','/projects/b']);
 h.view.select('/projects/a',h.cx);h.type('Commit A');h.view.select('/projects/b',h.cx);h.type('Commit B');
 h.view.select('/projects/a',h.cx);expect(h.value).toBe('Commit A');
 h.setSpace({id:'space-b',folder:'/projects',machine:null});h.view.refresh(h.cx);await h.settle();expect(h.view.filter).toBe('');expect(h.value).toBe('');
 h.setSpace({id:'space-a',folder:'/projects',machine:null});h.view.refresh(h.cx);await h.settle();expect(h.view.filter).toBe('/projects/a');expect(h.value).toBe('Commit A');
});
test('out of order diff replies never replace the currently selected file',async()=>{
 const h=harness();await h.settle();const a=deferred(),b=deferred();h.setBackend((p:any)=>p.root.endsWith('/a')?a.promise:b.promise);
 h.view.pick('/projects/a','same.txt',h.cx);h.view.pick('/projects/b','same.txt',h.cx);
 b.resolve({lines:['+new preview']});await new Promise(r=>setTimeout(r,0));a.resolve({lines:['+old preview']});await h.settle();
 expect(h.view.rows.map((r:any)=>r.text)).toEqual(['new preview']);
});
test('a space switch discards an old snapshot without clearing the new loading state',async()=>{
 const h=harness();await h.settle();const old=deferred(),next=deferred();h.setBackend((p:any)=>p.folder==='/projects'?old.promise:next.promise);
 h.view.refresh(h.cx,true);h.setSpace({id:'space-b',folder:'/second',machine:null});h.view.refresh(h.cx,true);
 old.resolve({repos:[repo('/wrong')],roots:['/wrong'],warnings:[]});await new Promise(r=>setTimeout(r,0));expect(h.view.loading).toBe(true);
 next.resolve({repos:[repo('/second/right')],roots:['/second/right'],warnings:[]});await h.settle();expect(h.view.repos[0].root).toBe('/second/right');expect(h.view.loading).toBe(false);
});
test('commit is unavailable in All repositories and runs for the captured selected repo only',async()=>{
 const h=harness();await h.settle();h.type('No global commit');h.view.commit(h.cx);expect(h.calls.length).toBe(1);
 const commit=deferred();h.setBackend((p:any)=>p.command==='commit'?commit.promise:{repos:[repo('/projects/a')],roots:['/projects/a'],warnings:[]});
 h.view.select('/projects/a',h.cx);h.type('Selected A');h.view.commit(h.cx);h.type('New draft during commit');
 commit.resolve({committed:'/projects/a'});await h.settle();
 const p=JSON.parse(h.calls.find((c:any)=>JSON.parse(c[1][2]).command==='commit')[1][2]);expect(p.root).toBe('/projects/a');expect(p.message).toBe('Selected A');expect(h.value).toBe('New draft during commit');
});
test('failed commits keep drafts and expose the backend error',async()=>{
 const h=harness();await h.settle();h.view.select('/projects/a',h.cx);h.type('Retain me');
 h.setBackend((p:any)=>p.command==='commit'?{error:'Hook rejected commit'}:{repos:[repo('/projects/a')],roots:['/projects/a'],warnings:[]});
 h.view.commit(h.cx);await h.settle();expect(h.value).toBe('Retain me');expect(h.view.note).toContain('Hook rejected');
});
test('a persisted folder change between editing and committing cancels the old commit',async()=>{
 const h=harness();await h.settle();h.view.select('/projects/a',h.cx);h.type('Keep my message');
 h.setRoots({'space-a':'/replacement'});h.view.commit(h.cx);await h.settle();
 expect(h.calls.some((c:any)=>JSON.parse(c[1][2]).command==='commit')).toBe(false);
});
test('discovery limit notices remain visible during cached status refreshes',async()=>{
 const h=harness();await h.settle();h.setBackend((p:any)=>({repos:[repo('/projects/a')],roots:['/projects/a'],warnings:p.known?[]:['Discovery limited'],discoveryWarnings:p.known?[]:['Discovery limited']}));
 h.view.refresh(h.cx,true);await h.settle();h.view.refresh(h.cx);await h.settle();expect(h.view.warnings).toEqual(['Discovery limited']);
});
test('changed repositories appear before clean groups',async()=>{
 const h=harness();await h.settle();h.setBackend(()=>({repos:[{...repo('/projects/clean'),count:0,files:[]},repo('/projects/changed')],roots:[],warnings:[]}));
 h.view.refresh(h.cx,true);await h.settle();expect(h.view.repos.map((r:any)=>r.name)).toEqual(['changed','clean']);
});
test('render provides repository picker, grouped rows, explicit commit destination and collapse controls',async()=>{
 const h=harness();await h.settle();reset();h.view.render(h.cx);expect(byId('changes-refresh')).toBeDefined();expect(byId('changes-commit')).toBeUndefined();
 h.view.select('/projects/a',h.cx);h.type('Message');reset();h.view.render(h.cx);expect(byId('changes-commit')).toBeDefined();
 expect(built.some((e:any)=>e.calls.some(([n,a]:any)=>n==='child'&&a[0]==='Commit all changes in: /projects/a'))).toBe(true);
 h.view.picker=true;reset();h.view.render(h.cx);expect(byId('changes-all')).toBeDefined();expect(byId('repository-/projects/a')).toBeDefined();
 reset();const row={repo:repo('/projects/a')},header=h.view.listRow(row,{},h.cx);h.view.activate(h.view.rowKey(row),h.cx);
 expect(h.view.listRows().filter((r:any)=>r.file).length).toBe(0);expect(header).toBeDefined();
});
test('deferred virtual rows never register handlers, and file names cannot collide with group keys',async()=>{
 const h=harness();await h.settle();reset();const r=repo('/projects/a',':repo');
 h.view.listRow({repo:r},{},h.cx);h.view.listRow({repo:r,file:r.files[0]},{},h.cx);
 expect(built.flatMap(e=>e.calls.filter(([n]:any)=>String(n).startsWith('on_')))).toEqual([]);
 expect(h.view.rowKey({repo:r})).not.toBe(h.view.rowKey({repo:r,file:r.files[0]}));
 reset();h.view.render(h.cx);expect(built.some(e=>handler(e,'on_item_click'))).toBe(true);
});
