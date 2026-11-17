import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {element} from './fake-gpui';
const body=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');
const source=body('../lib/project-folder.js');
function folderApi(options:any={}){
 let cache=options.cache,call:any=null;const writes:any[]=[];
 const api=new Function('api',`const {appHome,exec,readTextFile,shared,setShared}=api;${source};return {projectFolder,loadProjectRoots,saveProjectFolder};`)({
  appHome:()=>'/app',shared:()=>cache,setShared:(_k:string,v:any)=>{cache=v;writes.push(v)},readTextFile:async()=>options.text??null,
  exec:async(...args:any[])=>{call=args;return options.result??{code:0,stdout:JSON.stringify({folder:'/new project',roots:{sp1:'/new project',sp2:'/other'}})}}});
 return {api,writes,get call(){return call},get cache(){return cache}};
}
test('fresh launches load the saved Files root even when shared roots are absent or stale',async()=>{
 for(const cache of [undefined,{}, {sp1:'/stale'}]){
  const h=folderApi({cache,text:'{"sp1":"/saved/project"}'});expect(await h.api.projectFolder({id:'sp1',folder:'/native/fallback'})).toBe('/saved/project');expect(h.cache.sp1).toBe('/saved/project');
 }
});
test('a missing root uses the native space folder; malformed data never silently overwrites cached roots',async()=>{
 const h=folderApi();expect(await h.api.projectFolder({id:'sp1',folder:'/native'})).toBe('/native');
 for(const text of ['{bad','[]','null']){const bad=folderApi({cache:{sp1:'/valid'},text});await expect(bad.api.loadProjectRoots()).rejects.toThrow();expect(bad.writes).toEqual([]);}
});
test('saving passes an exact argv payload and publishes only the persisted roots after success',async()=>{
 const h=folderApi();expect(await h.api.saveProjectFolder({id:'sp1'},'/new project','/old')).toBe('/new project');
 expect(h.call[0]).toBe('python3');expect(h.call[1][0]).toBe('/app/mods/shepherdr-settings/space-folder.py');expect(JSON.parse(h.call[1][1])).toEqual({space:'sp1',folder:'/new project',expected:'/old'});expect(h.cache).toEqual({sp1:'/new project',sp2:'/other'});
});
test('failed saves and remote spaces leave the shared root unchanged',async()=>{
 const h=folderApi({cache:{sp1:'/old'},result:{code:1,stdout:'{"error":"folder changed elsewhere"}'}});
 await expect(h.api.saveProjectFolder({id:'sp1'},'/new','/old')).rejects.toThrow('changed elsewhere');expect(h.writes).toEqual([]);
 const remote=folderApi();await expect(remote.api.saveProjectFolder({id:'remote/sp1',machine:'remote'},'/new','/old')).rejects.toThrow('local spaces');expect(remote.call).toBe(null);
});
const editorBody=body('../mods/shepherdr-settings/project-folder-editor.js');
const deferred=()=>{let resolve:any;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve}};
function editor(options:any={}){
 let value='',change:any,saveArgs:any;const tasks:Promise<any>[]=[];const rows:any[]=[];
 const v:any={scope:'sp1',folders:{sp1:'/old'},cfg:{spaces:{sp1:{folder:'/old',name:'Preserve name',feature:{profile:'second'}},sp2:{folder:'/other'}}},
  folderOf:async(id:string)=>{v.folders[id]='/new'},apply:async(fn:any)=>{fn(v.cfg);return options.metadataOk!==false}};
 const cx:any={notify(){},spawn(fn:any){const t=Promise.resolve(fn(cx));tasks.push(t);return t;}};
 const api=new Function('api',`const {div,InputState,Input,v_flex,h_flex,pickFolder,spaces,projectFolder,saveProjectFolder,button}=api;${editorBody};return {initFolderEditor,resetFolderEditor,saveFolderEditor,projectFolderEditor};`)({
  div:()=>element('div'),v_flex:()=>element('v_flex'),h_flex:()=>element('h_flex'),Input:{new:()=>element('Input')},
  InputState:{new:()=>({value:()=>value,set_value:(s:string)=>{value=s;change?.({},cx)},on:(_e:string,f:any)=>change=f})},
  spaces:()=>[{id:'sp1',folder:'/old'},{id:'sp2',folder:'/other'}],pickFolder:options.pickFolder??(async()=>'/picked'),
  projectFolder:options.read??(async(s:any)=>s.folder),saveProjectFolder:async(...a:any[])=>{saveArgs=a;if(options.save)return options.save(...a);return '/new'},
  button:(id:string,label:string,opts:any)=>{rows.push({id,label,...opts});return element('button')}});
 api.initFolderEditor(v,cx);
 return {v,cx,api,rows,tasks,set:(s:string)=>v.projectFolderBox.set_value(s),get value(){return value},get saveArgs(){return saveArgs},settle:async()=>{await Promise.all(tasks)}};
}
test('late folder loads and Browse results cannot overwrite another space or a typed draft',async()=>{
 const old=deferred(),h=editor({read:(s:any)=>s.id==='sp1'?old.promise:Promise.resolve('/other')});h.set('/typed before load');old.resolve('/old');await h.settle();expect(h.value).toBe('/typed before load');
 const pick=deferred(),b=editor({pickFolder:()=>pick.promise});await b.settle();b.api.projectFolderEditor(b.v,{});b.rows.find(r=>r.id==='space-folder-browse').onClick({},b.cx);
 b.v.scope='sp2';b.api.resetFolderEditor(b.v,b.cx);pick.resolve('/wrong-for-sp2');await b.settle();expect(b.value).toBe('/other');
});
test('explicit Save preserves role settings and updates only its original space while the scope changes',async()=>{
 const saving=deferred(),h=editor({save:()=>saving.promise});await h.settle();h.set('/new');const p=h.api.saveFolderEditor(h.v,h.cx);
 h.v.scope='sp2';h.api.resetFolderEditor(h.v,h.cx);saving.resolve('/new');await p;await h.settle();
 expect(h.saveArgs).toEqual([{id:'sp1',folder:'/old'},'/new','/old']);expect(h.v.cfg.spaces.sp1).toEqual({folder:'/new',name:'Preserve name',feature:{profile:'second'}});expect(h.v.cfg.spaces.sp2.folder).toBe('/other');expect(h.value).toBe('/other');
});
test('errors retain the entered path, and edits made during a save are not discarded',async()=>{
 const bad=editor({save:async()=>{throw Error('folder does not exist')}});await bad.settle();bad.set('/missing');await bad.api.saveFolderEditor(bad.v,bad.cx);expect(bad.value).toBe('/missing');expect(bad.v.projectFolderEditor.saved).toBe('/old');expect(bad.v.projectFolderEditor.error).toContain('does not exist');
 const saving=deferred(),h=editor({save:()=>saving.promise});await h.settle();h.set('/new');const p=h.api.saveFolderEditor(h.v,h.cx);h.set('/another edit');saving.resolve('/new');await p;expect(h.value).toBe('/another edit');expect(h.v.projectFolderEditor.saved).toBe('/new');expect(h.v.folderWrites.size).toBe(0);
});
test('the editor has named Browse and explicit Save controls, never autosaves while typing',async()=>{
 const h=editor();await h.settle();h.set('/new');expect(h.saveArgs).toBeUndefined();h.api.projectFolderEditor(h.v,{});
 expect(h.rows.find(r=>r.id==='space-folder-browse').label).toBe('Browse…');const save=h.rows.find(r=>r.id==='space-folder-save');expect(save.label).toBe('Save folder');expect(save.disabled).toBe(false);
});

test('Feature creation resolves its folder from saved project roots instead of a stale request snapshot',async()=>{
 const source=readFileSync(new URL('../lib/features.js',import.meta.url),'utf8'),a=source.indexOf('export function watchFeatures('),b=source.indexOf('\n}',a)+2;
 const fn=source.slice(a,b).replace(/^export /,'');let request:any=null,created:any;const timers=new Map<number,any>(),pending:Promise<any>[]=[];
 const cx:any={notify(){},spawn(f:any){const p=Promise.resolve(f(cx));pending.push(p);return p},timer:{every:(ms:number,f:any)=>timers.set(ms,f)}};
 const watch=new Function('shared','setShared','featureRecords','workspaceCall','spaces','run','shepherdrFor','readShepherdr','featureSettings','projectFolder','openFeature',`return ${fn}`)(
  ()=>request,()=>{},()=>[],async(command:string,payload:any)=>{if(command==='feature-create'){created=payload;return {id:'feature',...payload}}return {features:[]}},()=>[{id:'sp1',folder:'/native/fallback'}],()=>{},()=>({}),async()=>({}),()=>({agent:'codex'}),async()=>'/saved/project',async()=>{});
 watch(cx,(e:any)=>{throw e});await Promise.all(pending);request={nonce:1,at:Date.now(),create:{space:'sp1',folder:'/stale/request'}};
 timers.get(150)(cx);await Promise.all(pending);expect(created.folder).toBe('/saved/project');
});
