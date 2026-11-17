import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {chatLink,sourceOffset,hasChatLink} from '../core/chat-links.js';
import {element} from './fake-gpui';
test('the reported local brief and Java source-line hrefs resolve as documents, not URLs',()=>{
 expect(chatLink('/tmp/research-brief.txt','/repo')).toEqual({kind:'file',file:'/tmp/research-brief.txt',line:null,column:1});
 expect(chatLink('/repo/service/Foo.java:269','/other')).toEqual({kind:'file',file:'/repo/service/Foo.java',line:269,column:1});
});
test('relative paths, file URIs, encoded spaces and source anchors retain their locations',()=>{
 expect(chatLink('../other/Foo.java#L19C4-L22','/repo/src')).toEqual({kind:'file',file:'/repo/other/Foo.java',line:19,column:4});
 expect(chatLink('Foo.java:19:4','/repo')).toMatchObject({file:'/repo/Foo.java',line:19,column:4});
 expect(chatLink('file:///repo/My%20file.md','/repo')).toMatchObject({file:'/repo/My file.md'});
 expect(chatLink('README.md#setup','/repo')).toMatchObject({file:'/repo/README.md'});
 expect(chatLink('file://localhost/repo/Foo.java:12','/repo')).toMatchObject({file:'/repo/Foo.java',line:12});
});
test('website query strings remain intact and command-like URI schemes never execute',()=>{
 expect(chatLink('https://example.org/path?q=a#L1','/repo')).toEqual({kind:'web',url:'https://example.org/path?q=a#L1'});
 for(const href of ['javascript:alert(1)','data:text/html,hi','file://remote-host/private','file:///repo/%00secret','bad%zz.md'])expect(chatLink(href,'/repo').kind).toBe('unsupported');
 expect(hasChatLink('[file](/repo/file.txt)')).toBe(true);expect(hasChatLink('plain words')).toBe(false);
});
test('source offsets use the actual line lengths, UTF-16 and CRLF boundaries',()=>{
 expect(sourceOffset('first\r\n😀abc\r\nthird',2,3)).toBe(9);
 expect(sourceOffset('a\nb',2,99)).toBe(3);expect(sourceOffset('abc',1,-2)).toBe(0);
});
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
function method(text:string,name:string){const a=text.indexOf(`  ${name}(`);return text.slice(a,text.indexOf('\n  }',a)+4);}
function host(withDocument=true){
 const calls:any[]=[];let task=Promise.resolve();
 const all:any[]=[{pane:'chat-pane',tab:'feature-tab',mod:'chat'},...(withDocument?[{pane:'document-pane',tab:'feature-tab',mod:'workspace-document'}]:[])];
 const C=new Function('panes','focused','spaces','props','chatLink','run','setShared','shared','exec','toast',`return class { ${method(source,'openChatLink')} }`)(()=>all,()=>({tab:'other-tab'}),()=>[{id:'space',folder:'/fallback',tabs:[{id:'feature-tab'}]}],()=>({}),chatLink,(...a:any[])=>calls.push(['run',...a]),(...a:any[])=>calls.push(['shared',...a]),()=>({}),async(...a:any[])=>{calls.push(['exec',...a]);return {code:0,stdout:'{"pane":"new-document-pane"}'}},(...a:any[])=>calls.push(['toast',...a]));
 const v:any=new C();v.myPane=()=> 'chat-pane';v.t={cwd:'/repo'};
 const cx={spawn:(fn:any)=>{task=fn({notify(){}})},open_url:(url:string)=>calls.push(['url',url])};
 return {v,calls,cx,wait:()=>task};
}
test('clicking a source link reuses the document pane in its own Feature tab and preserves line/column',()=>{
 const {v,calls,cx}=host();v.openChatLink('src/Foo.java:269:4',cx);
 expect(calls).toContainEqual(['shared','workspace.document.open',expect.objectContaining({pane:'document-pane',file:'/repo/src/Foo.java',line:269,column:4})]);
 expect(calls).toContainEqual(['run','pane.focus',{pane:'document-pane'}]);
});
test('a file link creates a pane beside the originating chat and retains the source machine',async()=>{
 const {v,calls,cx,wait}=host(false);v.machine='remote';v.openChatLink('/repo/readme.md',cx);await wait();
 const args=JSON.parse(calls.find(c=>c[0]==='exec')[2][2]);expect(args).toMatchObject({pane:'chat-pane',direction:'right',mod:'workspace-document',props:{file:'/repo/readme.md',on:'remote'}});
});
test('web links use the system opener, never the agent input',()=>{
 const {v,calls,cx}=host();v.openChatLink('https://example.org/docs',cx);expect(calls).toEqual([['url','https://example.org/docs']]);
});
test('the message action layer is confined to the band and does not cover clickable reply text',()=>{
 const Row=new Function('div',`return class { ${method(source,'row')} }`)(()=>element('div'));
 const v:any=new Row();v.rowBare=()=>element('TextView');v.bar=()=>element('bar');
 const row=v.row({kind:'agent',bar:{of:'message',box:{top:4,h:26}}},{},'v');
 expect(row.kids[0].kind).toBe('TextView');expect(row.kids[1].kind).toBe('bar');expect(row.kids[1].calls.some((c:any)=>c[0]==='inset_0')).toBe(false);
});
const document=readFileSync(new URL('../mods/workspace-document/main.js',import.meta.url),'utf8');
test('source navigation switches from highlighted/preview content to the editor at the requested line',()=>{
 const C=new Function('sourceOffset',`return class { ${method(document,'jump')} }`)(sourceOffset);let selected:any,focused=false;
 const doc:any={text:'first\nsecond\nthird',highlight:true,preview:true,location:{line:2,column:2},editor:{set_selected_range:(r:any)=>{selected=r},focus:()=>{focused=true}}};
 new C().jump(doc);expect(selected).toEqual({start:7,end:7});expect(doc.highlight).toBe(false);expect(doc.preview).toBe(false);expect(focused).toBe(true);expect(doc.location).toBeUndefined();
});
const prepare=new Function('hasChatLink','LinkedMarkdown',`return class { ${method(source,'prepareLinkedMarkdown')} }`)(hasChatLink,class {});
test('linked Markdown creates retained child views after render and reuses or releases them as content changes',()=>{
 const v:any=new prepare();v.measureGen=1;v.pickKey=()=> 'pane';
 v.rowBare=(row:any,_t:any,pre:string)=>v.collectMarkdown.set(pre+row.id,{id:pre+row.id,text:row.text,key:'pane'});
 const queued:any[]=[],updates:any[]=[],released:any[]=[];let creates=0;
 const cx:any={timer:{after:(_n:number,fn:any)=>queued.push(fn)},new:(_C:any,p:any)=>{creates++;return {set_props:(p:any)=>updates.push(p),release:()=>released.push(p.id)}},notify(){}};
 const rows=[{id:'one',text:'[file](/repo/file.txt)'}];v.prepareLinkedMarkdown(rows,{},cx);expect(creates).toBe(0);queued.shift()(cx);expect(creates).toBe(1);
 v.prepareLinkedMarkdown(rows,{},cx);expect(queued).toHaveLength(0);
 v.prepareLinkedMarkdown([{id:'one',text:'[different](/repo/other.txt)'}],{},cx);queued.shift()(cx);expect(creates).toBe(1);expect(updates).toHaveLength(1);
 v.prepareLinkedMarkdown([],{},cx);queued.shift()(cx);expect(released).toHaveLength(1);
});
const childSource=readFileSync(new URL('../mods/chat/linked-markdown.js',import.meta.url),'utf8');
test('the retained Markdown callback routes the clicked href back to its own chat',()=>{
 const calls:any[]=[];const native=element('TextView');
 const C=new Function('TextView','setShared',`return class { ${childSource.slice(childSource.indexOf(' render(){'),childSource.lastIndexOf('\n}'))} }`)({markdown:()=>native},(...a:any[])=>calls.push(a));
 const child:any=new C();child.value={id:'message-id',text:'[brief](/tmp/brief.txt)',key:'feature-pane'};child.render();
 const handler=native.calls.find((c:any)=>c[0]==='on_link_click')[1][0];handler('/tmp/brief.txt');
 expect(calls[0][0]).toBe('workspace.chat-link');expect(calls[0][1]).toMatchObject({key:'feature-pane',href:'/tmp/brief.txt'});
});
