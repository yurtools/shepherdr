import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {mediaIn} from '../core/chat-view.js';
import {messageChunks} from '../core/chat-layout.js';
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
const method=(name:string)=>{const at=source.indexOf(`  ${name}(`);return source.slice(at,source.indexOf('\n  }',at)+4);};
function host(){
 const stats={media:0,parts:0,wraps:0};let root='/home/test';
 const parse=new Function(source.slice(source.indexOf('function parts(text)'),source.indexOf('\nlet bound'))+';return parts;')();
 const C=new Function('mediaIn','parts','home','wrapLines','LINE_H','FOLD_TALL','FOLD','KEEP',`return class {${method('rowContent')}\n${method('foldOf')}}`)(
  (...a:any[])=>{stats.media++;return (mediaIn as any)(...a);},(text:string)=>{stats.parts++;return parse(text);},()=>root,
  (text:string,width:number)=>{stats.wraps++;return String(text??'').split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length*7/Math.max(120,width))),0);},21,28,20,2000);
 const v:any=new C();Object.assign(v,{t:{cwd:'/repo'},width:1000,unfolded:new Set(),query:'',column:()=>1000,findQuery:()=>v.query});
 return {v,stats,home(value:string){root=value;}};
}

test('paint and streaming reuse stable media/parts/estimates but in-place text edits invalidate',()=>{
 const h=host(),stable={id:'stable',kind:'agent',text:'A reply\n'.repeat(100)},stream={id:'stream',kind:'agent',text:'First'};
 const a=h.v.rowContent(stable);h.v.foldOf(stable,a.ps);
 const before={...h.stats};
 for(let i=0;i<50;i++){
  const b=h.v.rowContent(stable);expect(b).toBe(a);h.v.foldOf(stable,b.ps);
  stream.text+='!';h.v.rowContent(stream);
 }
 expect(h.stats.wraps).toBe(before.wraps);expect(h.stats.media-before.media).toBe(50);expect(h.stats.parts-before.parts).toBe(50);
 stable.text='A changed reply';const b=h.v.rowContent(stable);expect(b).not.toBe(a);expect(b.ps[0].text).toBe(stable.text);
 const rebuilt=h.v.rowContent({...stable});expect(rebuilt).toBe(b);expect(rebuilt.ps).toEqual(b.ps);
});

test('media resolution, kind, fold width, search and expansion retain their actual inputs',()=>{
 const h=host(),row={id:'row',kind:'agent',text:'![picture](./shot.png)\n'+'long words '.repeat(2000)};
 let a=h.v.rowContent(row);expect(a.md.media[0].path).toBe('/repo/shot.png');
 h.v.t.foreground={cwd:'/other'};a=h.v.rowContent(row);expect(a.md.media[0].path).toBe('/other/shot.png');
 h.home('/different');const b=h.v.rowContent(row);expect(b).not.toBe(a);
 h.v.machine='remote';const c=h.v.rowContent(row);expect(c.root).toBeNull();
 const folded=h.v.foldOf(row,c.ps);expect(folded.open).toBe(false);
 h.v.unfolded.add('row');expect(h.v.foldOf(row,c.ps).open).toBe(true);
 h.v.unfolded.delete('row');h.v.query='long words';expect(h.v.foldOf(row,c.ps)).toBeNull();
 h.v.query='';const wraps=h.stats.wraps;h.v.width=500;h.v.foldOf(row,c.ps);expect(h.stats.wraps).toBeGreaterThan(wraps);
 row.kind='user';const user=h.v.rowContent(row);expect(user.md).toBeNull();expect(user.ps).toEqual([{type:'md',text:row.text}]);
 expect(messageChunks(user.text).join('')).toBe(row.text);
});

test('row ownership keeps source items and reused news immutable across spacing and rebuild',()=>{
 const view=require('../core/chat-view.js');
 const dependencies:any={...view,messageChunks,home:()=>'/test-home',cardsOf:()=>[],pilotLine:()=> 'Wake'};
 const parse=source.slice(source.indexOf('function parts(text)'),source.indexOf('\nlet bound'));
 const helpers=source.slice(source.indexOf('const wrapLines ='),source.indexOf('const ICONS ='));
 const C=new Function(...Object.keys(dependencies),`const KEEP=2000,ACT=22,BAND_IN=4,ACT_ROW=26,GAP=16,QUIET_IN={top:5,bottom:6},FOLD=20,FOLD_TALL=28,LINE_H=21;
 const norm=s=>String(s??'').replace(/\\s+/g,' ').trim(),taskRef=x=>x.ref;
 ${helpers}\n${parse}\nreturn class {${['rowContent','rows','spaced','foldOf'].map(method).join('\n')}}`)(...Object.values(dependencies));
 const at=new Date(2026,2,8,1,30).getTime();
 const items=[{kind:'user',id:'user',text:'Hello',at},{kind:'agent',id:'agent',text:'Reply',at:at+1000},{kind:'tools',id:'tools',steps:[],at:at+2000},{kind:'news',id:'news',at:at+3000}].map(Object.freeze);
 const news=Object.freeze({kind:'tasknews',id:'news',text:'Task started'});
 const v:any=new C();Object.assign(v,{conv:{items},start:0,kind:'codex',width:1000,opened:new Set(),unfolded:new Set(),pending:[],replied:[],askEnds:[],t:{cwd:'/repo'},status:()=> 'blocked',resolveArts:()=>new Map(),newsLines:()=>({inline:new Map([['news',news]]),extra:[]}),loadAskEnds(){},workerTasks:()=>new Map(),timelineCards:()=>[],brief:()=>null,pills:()=>[],mentioned:()=>[],column:()=>1000,findQuery:()=>''});
 const before=JSON.stringify(items),first=v.rows();
 expect(first.find((r:any)=>r.id==='agent')).toMatchObject({blk:'agent',top0:true,bot0:true});
 expect(first.find((r:any)=>r.id==='ab:agent')).toMatchObject({blk:'agent',h:26});
 expect(first.find((r:any)=>r.id==='g:ab:agent')).toMatchObject({h:11});
 expect(first.filter((r:any)=>r.kind==='day')).toHaveLength(1);
 expect(v.rows()).toEqual(first);expect(JSON.stringify(items)).toBe(before);expect(news).not.toHaveProperty('top0');
 v.conv={items:items.map(x=>({...x}))};expect(v.rows()).toEqual(first);
});

test('content cache eviction is bounded and changes neither rebuilt text nor fold inputs',()=>{
 const h=host();for(let i=0;i<2100;i++)h.v.rowContent({id:String(i),kind:'agent',text:`Row ${i}`});
 expect(h.v.rowContentCache.size).toBe(2000);
 const restored=h.v.rowContent({id:'0',kind:'agent',text:'Row 0'});expect(restored.ps[0].text).toBe('Row 0');
 expect(h.v.rowContentCache.size).toBe(2000);
});
