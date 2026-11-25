import {expect,test} from 'bun:test';
import {findRanges,markedParts,pageRanges,cellExcerpt,FIND} from './document-find.js';

test('literal non-overlapping Unicode offsets and distinct marks',()=>{
 const text='İ 🦀 [needle] [NEEDLE]';
 const {hits}=findRanges(text,'[needle]');
 expect(hits.map(h=>text.slice(h.start,h.end))).toEqual(['[needle]','[NEEDLE]']);
 expect(markedParts(text,hits,hits[1]).map(p=>p.tone)).toEqual([0,1,0,2]);
 expect(markedParts(text,hits,null).map(p=>p.tone)).toEqual([0,1,0,1]);
 expect(findRanges('aaa','aa').hits).toEqual([{start:0,end:2}]);
 expect(findRanges('x'.repeat(FIND.hits+1),'x').limited).toBe(true);
});

test('byte ranges spanning source pages map to actual UTF-16 characters',()=>{
 const hits=[{start:101,end:109,index:0}];
 expect(pageRanges({start:100,end:105,text:'x🦀'},hits)).toEqual([{start:1,end:3,index:0}]);
 expect(pageRanges({start:105,end:110,text:'stop!'},hits)).toEqual([{start:0,end:4,index:0}]);
 expect(cellExcerpt('x'.repeat(300)+'needle',300,306).excerpt).toContain('needle');
});
