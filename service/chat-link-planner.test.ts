import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import * as links from '../core/chat-links.js';
import {literal,initialOf,clock,imagesLine,WORDS} from '../core/chat-view.js';
import * as mentions from '../core/mentions.js';
import {element,built} from './fake-gpui';

// Exercise the actual window methods without Chat.init(), live APIs or a window.
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
function method(name:string){
 let start=source.indexOf(`  ${name}(`);
 if(start<0)start=source.indexOf(`  async ${name}(`);
 return start<0?'':source.slice(start,source.indexOf('\n  }',start)+4);
}
const theme={accent:'#0088ff',raised:'#222222',foreground:'#eeeeee',dim:'#888888',muted:'#aaaaaa',hover:'#333333'};
const md=(id='one',text='[doc](/repo/a.md)',kind='agent'):any=>({id,text,kind});
function host(){
 const stats={chars:0,scans:0,collects:0,notifies:0,reads:0};
 const div=()=>element('div');
 const dependencies:any={...links,literal,initialOf,clock,imagesLine,WORDS,mentions,div,h_flex:div,v_flex:div,svg:div,
  LINE_H:21,QUIET_PY:1,BgJobs:class {},LinkedMarkdown:class {},zoomOf:()=>v.zoom,
  taskRef:(x:any)=>x?.ref??String(x?.id),TextView:{markdown:(id:string,text:string)=>{const el=element('markdown');el.id(id).child(text);return el;}},
  scanChatLink:(scan:any,limit:number)=>{stats.scans++;const n=links.scanChatLink(scan,limit);stats.chars+=n;return n;},
 };
 const helpers=source.slice(source.indexOf('const wrapLines ='),source.indexOf('const ICONS ='))+'\n'+source.match(/^const typed = .*$/m)![0];
 const methods=['key','findMark','mentionsIn','mentionableTasks','rowBare','reset','close','linkedMarkdownStamp','linkedMarkdownInputs','linkedMarkdownCurrent','retireLinkedMarkdown','clearLinkedMarkdown','prepareLinkedMarkdown','scheduleLinkedMarkdown','stepLinkedMarkdown','linkedMarkdownView'].map(method).join('\n');
 const C=new Function(...Object.keys(dependencies),`${helpers};return class {${methods}}`)(...Object.values(dependencies));
 const v:any=new C();
 Object.assign(v,{measureGen:1,width:1200,zoom:1,columnWidth:1000,opened:new Set(),unfolded:new Set(),rowRevisions:new Map(),results:new Map(),views:{},query:'',route:'pane',end:0,pending:[],replied:[]});
 v.column=()=>v.columnWidth;v.pickKey=()=>v.route;v.areaKey=()=> 'area';v.findQuery=()=>v.query;
 v.clipped=(_bg:any,_h:any,el:any)=>el;v.sender=()=> 'Another agent';
 const bare=v.rowBare.bind(v);
 v.rowBare=(...args:any[])=>{if(v.collectMarkdown)stats.collects++;return bare(...args);};
 const jobs:any[]=[],views:any[]=[],steps:any[]=[];
 let duringCreate:(()=>void)|undefined;
 const cx:any={timer:{after:(_ms:number,fn:any)=>{const job={fn,cancelled:false,cancel(){this.cancelled=true;}};jobs.push(job);return job;}},
  notify(){stats.notifies++;},new:(_C:any,p:any)=>{const view=element('retained');let released=0;
   const entity=new Proxy(view,{get(target,key){if(key==='release')return ()=>{released++;};if(key==='released')return released;if(key==='props')return p;return target[key];}});
   views.push(entity);duringCreate?.();return entity;
  }};
 function one(){
  const job=jobs.shift();if(!job||job.cancelled)return;
  const before={...stats},released=views.reduce((n,p)=>n+p.released,0);
  const work=v.linkMarkdownWork;let visits=0;
  const pending=work?.pending,del=pending?.delete;
  if(pending)pending.delete=function(e:any){visits++;return del.call(this,e);};
  try{job.fn(cx);}finally{if(pending)pending.delete=del;}
  const step={chars:stats.chars-before.chars,collects:stats.collects-before.collects,visits,releases:views.reduce((n,p)=>n+p.released,0)-released};
  steps.push(step);expect(step.chars).toBeLessThanOrEqual(4096);expect(step.collects).toBeLessThanOrEqual(1);expect(step.visits+step.releases).toBeLessThanOrEqual(32);
  built.length=0;
 }
 function drain(){let n=0;while(jobs.length){if(++n>10000)throw Error('planner did not settle');one();}}
 function prepare(rows:any[],keys=true){if(keys)rows.forEach(r=>v.key(r));v.prepareLinkedMarkdown(rows,theme,cx);}
 const entry=(id='one')=>v.linkMarkdownWork.rows.get(id);
 const lookup=(row:any)=>{const p=entry(row.id)?.views.values().next().value;return p?v.linkedMarkdownView(row,p.id,p.text):null;};
 return {v,stats,jobs,views,steps,cx,one,drain,prepare,entry,lookup,onCreate(fn:()=>void){duringCreate=fn;}};
}

test('planning reads no row text and collects no Markdown on first, unchanged or edited render',()=>{
 const h=host();let text='[doc](/repo/a.md)';
 const row={id:'one',kind:'agent',get text(){h.stats.reads++;return text;}};
 h.v.key(row);h.stats.reads=0;h.prepare([row],false);
 expect(h.stats.reads).toBe(0);expect(h.stats.chars).toBe(0);expect(h.stats.collects).toBe(0);
 h.drain();const before={...h.stats};
 h.prepare([{...row}]);h.stats.reads=0;h.prepare([row],false);
 expect(h.stats.reads).toBe(0);expect(h.jobs.length).toBe(0);expect(h.stats.scans).toBe(before.scans);
 text='[doc](/repo/b.md)';h.v.key(row);h.stats.reads=0;h.prepare([row],false);
 expect(h.stats.reads).toBe(0);expect(h.stats.chars).toBe(before.chars);expect(h.stats.collects).toBe(before.collects);
 h.drain();expect(h.lookup(row).props.text).toBe(text);
});

test('fresh arrays and rebuilt Conversation objects reuse positive and negative revisions',()=>{
 const h=host(),rows=[md(),md('plain','plain words')];h.prepare(rows);h.drain();
 const before={...h.stats},view=h.lookup(rows[0]);
 for(let i=0;i<50;i++){h.v.conv={items:[]};h.prepare(rows.map(r=>({...r})));}
 expect(h.jobs.length).toBe(0);expect(h.stats).toEqual(before);expect(h.lookup(rows[0])).toBe(view);
});

test('same-length href edits and linked/plain transitions replace only the affected row',()=>{
 const h=host(),fixed=md('fixed');let row=md();h.prepare([row,fixed]);h.drain();const stable=h.lookup(fixed),old=h.lookup(row);
 row=md('one','[doc](/repo/b.md)');h.prepare([row,fixed]);expect(h.lookup(row)).toBeNull();h.drain();
 expect(h.lookup(row).props.text).toBe(row.text);expect(old.released).toBe(1);expect(h.lookup(fixed)).toBe(stable);
 row=md('one','plain words');h.prepare([row,fixed]);h.drain();expect(h.lookup(row)).toBeNull();
 row=md();h.prepare([row,fixed]);h.drain();expect(h.lookup(row)).not.toBeNull();
});

test('collapsed briefs and non-Markdown kinds skip scanning; expansion and who replan',()=>{
 const h=host(),brief={...md('one','[doc](/repo/a.md)','brief'),label:'Brief'};
 h.prepare([brief,md('code','[doc](/repo/a.md)','code')]);h.drain();expect(h.stats.chars).toBe(0);
 h.v.opened.add('one');h.prepare([brief]);h.drain();expect(h.lookup(brief)).not.toBeNull();
 const chars=h.stats.chars;h.prepare([{...brief,who:'Assistant'}]);h.drain();expect(h.stats.chars).toBe(chars);
 h.v.opened.delete('one');h.prepare([brief]);h.drain();expect(h.views.every(p=>p.released===1)).toBe(true);
 h.v.opened.add('one');h.prepare([brief]);h.drain();expect(h.stats.chars).toBe(chars);
});

test('layout, search, route and mention changes replan without rescanning unchanged text',()=>{
 const h=host(),row=md('one','[doc](/repo/a.md) #space');h.prepare([row]);h.drain();const chars=h.stats.chars;
 for(const mutate of [()=>h.v.measureGen++,()=>h.v.width--,()=>h.v.columnWidth--,()=>h.v.zoom=1.2,()=>h.v.query='doc',()=>h.v.route='other',()=>h.v.reach={spaces:[]},()=>h.v.tasks=[],()=>h.v.spaceTasks=[]]){
  mutate();h.prepare([{...row}]);expect(h.lookup(row)).toBeNull();h.drain();expect(h.lookup(row)).not.toBeNull();
 }
 expect(h.stats.chars).toBe(chars);expect(h.lookup(row).props.key).toBe('other');expect(h.lookup(row).props.text).toContain('**doc**');
});

test('fold revisions, clipping and unfolding replan while preserving content classification',()=>{
 const h=host();let row={...md(),blk:'message'};h.prepare([row]);h.drain();const chars=h.stats.chars,old=h.lookup(row);
 // toggleFold bumps the native view revision, retaining the content revision.
 const previous=h.v.rowRevisions.get(row.id);h.v.rowRevisions.set(row.id,{...previous,revision:previous.revision+1});
 h.v.unfolded.add('message');row={...row,clip:42};h.prepare([row]);expect(h.lookup(row)).toBeNull();h.drain();
 expect(h.stats.chars).toBe(chars);expect(old.released).toBe(1);
});

test('one long row yields and cannot starve a small row; progress alone does not notify',()=>{
 const h=host(),rows=[md('long','['.repeat(100000)+'x'),md('small')];h.prepare(rows);h.one();
 expect(h.stats.chars).toBe(4096);expect(h.stats.notifies).toBe(0);expect(h.stats.collects).toBe(0);
 h.one();expect(h.lookup(rows[1])).not.toBeNull();h.drain();expect(h.entry('long').linked).toBe(false);
 const notified=h.stats.notifies;h.prepare([md('long','x'.repeat(12000)+'[doc](/repo/a.md)')]);h.one();expect(h.stats.notifies).toBe(notified);h.drain();
 expect(h.entry('long').linked).toBe(true);
});

test('stream revisions coalesce and leave stable rows and partial scans alone',()=>{
 const h=host(),fixed=md('fixed'),long=md('long','x'.repeat(20000));let row=md('stream','['.repeat(20000));
 for(let i=0;i<50;i++){
  row={...row,text:row.text+'x'};h.prepare([row,fixed,long]);expect(h.jobs.length).toBeLessThanOrEqual(1);h.one();
 }
 h.drain();expect(h.lookup(fixed)).not.toBeNull();expect(h.views.length).toBe(1);expect(h.entry('long').linked).toBe(false);
 expect(h.entry('stream').linked).toBe(false);expect(h.stats.collects).toBe(1);
});

test('changes before the next draw cannot collect or publish stale work',()=>{
 for(const mutate of [(h:any)=>h.v.query='doc',(h:any)=>h.v.width--,(h:any)=>h.v.zoom++, (h:any)=>h.v.route='other',
  (h:any)=>h.v.spaceTasks=[],(h:any)=>h.v.end++,(h:any)=>h.v.conv={items:[]},(h:any)=>h.v.pending.push(md('new')),
  (h:any)=>h.v.opened.add('one'),(h:any)=>h.v.unfolded.add('one'),(h:any)=>h.v.rowRevisions.set('one',{revision:99,contentRevision:99})]){
  const h=host(),row=md();h.prepare([row]);mutate(h);h.one();expect(h.stats.collects).toBe(0);expect(h.views.length).toBe(0);
  h.prepare([row]);h.drain();expect(h.lookup(row)).not.toBeNull();
 }
});

test('reset separates reused IDs and cancels scans, including reset before the first callback',()=>{
 const h=host(),row=md();h.prepare([row]);h.v.reset();h.drain();expect(h.views.length).toBe(0);
 h.prepare([row]);h.drain();const old=h.lookup(row);h.v.reset();h.drain();expect(old.released).toBe(1);
 h.prepare([row]);expect(h.lookup(row)).toBeNull();h.drain();expect(h.lookup(row)).not.toBe(old);
});

test('removed and superseded children detach immediately and release exactly once in bounded callbacks',()=>{
 const h=host(),rows=Array.from({length:100},(_,i)=>md(String(i)));h.prepare(rows);h.drain();
 h.prepare([]);expect(h.v.linkMarkdownWork.rows.size).toBe(0);h.one();expect(h.views.filter(p=>p.released===1).length).toBe(32);
 h.drain();expect(h.views.every(p=>p.released===1)).toBe(true);
 h.prepare(rows);h.drain();h.v.reset();h.drain();expect(h.views.every(p=>p.released===1)).toBe(true);
 h.v.clearLinkedMarkdown(true);h.drain();expect(h.views.every(p=>p.released===1)).toBe(true);
});

test('close cancels pending callbacks and releases every retained child once',async()=>{
 const h=host(),rows=[md(),md('two')];h.prepare(rows);h.one();
 h.v.box=h.v.findBox=h.v.scroll={release(){}};h.v.dict={cancel(){}};await h.v.close(h.cx);h.drain();
 expect(h.stats.collects).toBe(1);expect(h.views.every(p=>p.released===1)).toBe(true);
 h.prepare(rows);expect(h.jobs.length).toBe(0);
});

test('collection restores its state on error and rechecks context before and after child construction',()=>{
 const h=host(),row=md();h.prepare([row]);const bare=h.v.rowBare;
 h.v.rowBare=()=>{throw Error('collection failed');};expect(()=>h.one()).toThrow('collection failed');expect(h.v.collectMarkdown).toBeNull();
 for(const action of ['context','reset','close']){
  const h=host();h.prepare([row]);h.onCreate(()=>{if(action==='context')h.v.query='doc';else if(action==='reset')h.v.reset();else h.v.clearLinkedMarkdown(true);});
  h.one();h.drain();expect(h.lookup(row)).toBeNull();expect(h.views.every(p=>p.released===1)).toBe(true);
 }
 const disposed=host();disposed.prepare([row]);const beforeClose=disposed.stats.notifies,disposeBare=disposed.v.rowBare;
 disposed.v.rowBare=(...args:any[])=>{const result=disposeBare(...args);disposed.v.clearLinkedMarkdown(true);return result;};
 disposed.one();disposed.drain();expect(disposed.stats.notifies).toBe(beforeClose);expect(disposed.views.length).toBe(0);
 const c=host();c.prepare([row]);const collect=c.v.rowBare;c.v.rowBare=(...args:any[])=>{const result=collect(...args);c.v.query='doc';return result;};
 c.one();expect(c.views.length).toBe(0);expect(c.v.collectMarkdown).toBeNull();
 h.v.rowBare=bare;
});

test('a source update during collection pauses work until draw without losing unchanged pending rows',()=>{
 const h=host(),rows=[md(),md('two')];h.prepare(rows);const bare=h.v.rowBare;
 h.v.rowBare=(...args:any[])=>{const result=bare(...args);h.v.end++;return result;};
 h.one();expect(h.views.length).toBe(0);expect(h.jobs.length).toBe(0);
 h.v.rowBare=bare;h.prepare(rows);h.drain();expect(h.lookup(rows[0])).not.toBeNull();expect(h.lookup(rows[1])).not.toBeNull();
});

test('child reuse requires the exact ID, transformed text, route, epoch and current token',()=>{
 const h=host(),row=md();h.prepare([row]);h.drain();const p=h.entry().views.values().next().value;
 expect(h.v.linkedMarkdownView(row,p.id,p.text)).toBe(p.view);
 for(const [id,text] of [['wrong',p.text],[p.id,'different']])expect(h.v.linkedMarkdownView(row,id,text)).toBeNull();
 for(const field of ['epoch','token']){const value=p[field];p[field]++;expect(h.lookup(row)).toBeNull();p[field]=value;}
 h.v.route='other';expect(h.lookup(row)).toBeNull();h.v.route='pane';h.entry().ready=false;expect(h.lookup(row)).toBeNull();
});

test('pending fallback preserves text and uses the same native Markdown ID',()=>{
 const h=host(),row=md();h.prepare([row]);const id=`v1-0-chat-md-${row.id}`;
 built.length=0;h.v.rowBare(row,theme,'v1-0-');
 const fallback=built.find(el=>el.kind==='markdown');expect(fallback.kids).toContain(row.text);expect(fallback.calls).toContainEqual(['id',[id]]);
 h.drain();built.length=0;h.v.rowBare(row,theme,'v1-0-');expect(built.some(el=>el.kind==='markdown')).toBe(false);
 expect(built.some(el=>el.kids.includes(h.lookup(row)))).toBe(true);
});

test('resumable detector preserves hasChatLink semantics across every boundary',()=>{
 function check(text:string,limit:number){const scan=links.chatLinkScan(text);while(scan.result===null){const at=scan.at,n=links.scanChatLink(scan,limit);expect(n).toBeLessThanOrEqual(limit);expect(scan.at-at).toBe(n);}expect(scan.result).toBe(links.hasChatLink(text));}
 const alphabet='[]()\na';function walk(text:string,depth:number){check(text,2);if(depth)for(const c of alphabet)walk(text+c,depth-1);}walk('',6);
 for(const text of ['http://x','https://x','hhttp://x','htthttp://','HTTPS://x','[a](b)','[]()','[a]()','[a]())','[a\nb](c)','[x](\n)','[[]((x)','😀[x](y)'])for(let size=1;size<9;size++)check(text,size);
 let seed=183206;const chars='[]()http:/sabcXYZ\n\r \\😀';
 for(let n=0;n<12000;n++){let text='';seed=(Math.imul(seed,1664525)+1013904223)>>>0;const length=seed%257;for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=chars[seed%chars.length];}check(text,1+n%31);}
});
