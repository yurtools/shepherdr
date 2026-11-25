import { expect, test } from 'bun:test';
import { ChatReader, KEEP } from './chat-reader.js';
import { FIND_LIMITS } from './chat-find.js';
import { records } from './chat-log.js';

const record=(off,text)=>`${off}\tJ\t${JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text}]}})}\n`;
const decoded=(n)=>records('P 0 999\n'+Array.from({length:n},(_,i)=>record(1000+i,`Message ${i}`)).join('')).records;

test('explicit earlier page remains retained when the next streamed record arrives',async()=>{
  const replies=[{code:0,stdout:'P 0 999\n'+record(1,'Earlier retained needle')},{code:0,stdout:'T 9000 8000 9000\n'+record(8001,'New streamed needle')}];
  const reader=new ChatReader({sh:async()=>replies.shift()},'synthetic').fixed('/synthetic','codex');
  reader.records=decoded(KEEP);reader.start=1000;reader.end=8000;reader.rebuild();
  const historyKey=reader.historyKey;
  expect(await reader.earlier()).toBe(true);expect(reader.records).toHaveLength(KEEP+1);expect(reader.start).toBe(0);
  expect(await reader.pull()).toBe(true);expect(reader.records).toHaveLength(KEEP+2);expect(reader.start).toBe(0);
  expect(reader.conv.items.some(i=>i.text==='Earlier retained needle')).toBe(true);expect(reader.historyKey).toBe(historyKey);
});

test('earlier reads have a hard record cap and cannot publish into a replacement session',async()=>{
  let resolve,called=0;
  const reader=new ChatReader({sh:async()=>{called++;return await new Promise(r=>{resolve=r;});}},'synthetic').fixed('/synthetic','codex');
  reader.start=100;reader.end=200;reader.records=Array.from({length:FIND_LIMITS.pageRecords},(_,off)=>({off}));
  expect(await reader.earlier()).toBe(false);expect(called).toBe(0);
  reader.records=[];const before=reader.historyKey,pending=reader.earlier();
  await Promise.resolve();reader.fixed('/replacement','claude');reader.start=100;reader.end=200;
  resolve({code:0,stdout:'P 0 200\n'+record(1,'old session')});
  expect(await pending).toBe(false);expect(reader.records).toEqual([]);expect(reader.historyKey).not.toBe(before);
});
