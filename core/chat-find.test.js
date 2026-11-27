import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FIND_LIMITS, literalRanges, findSpans, findPosition, findStep, findContext, diagramLabelTexts } from './chat-find.js';
import { markdownProjection, markdownRanges, markedHtml, markdownChunks } from './chat-find-markdown.js';
import { messageChunks } from './chat-layout.js';
import { flowchart } from './chat-flowchart.js';

const values=(text,q)=>literalRanges(text,q).ranges.map(r=>text.slice(r.start,r.end));
test('literal occurrences preserve UTF-16 offsets and punctuation, not regex syntax',()=>{
  const text='İ before café CAFÉ 😀 Café 𐐀 𐐨 [a+b] [A+B] \\ * _ ` (x) ...';
  expect(values(text,'café')).toEqual(['café','CAFÉ','Café']);
  expect(values(text,'𐐨')).toEqual(['𐐀','𐐨']);
  expect(values(text,'[a+b]')).toEqual(['[a+b]','[A+B]']);
  for(const q of ['\\','*','_','`','(x)','...'])expect(values(text,q)).toEqual([q]);
  expect(values('aaaaa','aa')).toEqual(['aa','aa']);
  expect(literalRanges('abc','no match')).toEqual({ranges:[],limited:false});
  expect(literalRanges('abc','  ')).toEqual({ranges:[],limited:false});
});

test('search is bounded and reports a partial result rather than a false total',()=>{
  expect(literalRanges('a'.repeat(50000),'a',3)).toEqual({ranges:[{start:0,end:1},{start:1,end:2},{start:2,end:3}],limited:true});
  const text='x'.repeat(FIND_LIMITS.chars-1)+'😀needle';
  expect(literalRanges(text,'needle')).toEqual({ranges:[],limited:true});
  expect(literalRanges(text,'😀')).toEqual({ranges:[],limited:true});
});

test('highlight rendered inline text across styles, escaped punctuation and code',()=>{
  const source='**nee**dle, `NEEDLE`, [needle](docs/file.md), literal \\* and `a+b`, caf&eacute;, &amp; and &#x1F600;.';
  const p=markdownProjection(source),got=markdownRanges(p,'needle');
  expect(got.hits.map(h=>h.text.slice(h.start,h.end))).toEqual(['needle','NEEDLE','needle']);
  const html=markedHtml(p,got.hits,{match:'#12345655',active:'#12345699'},got.hits[1]);
  expect(html).toContain('<strong><mark color="#12345655">nee</mark></strong><mark color="#12345655">dle</mark>');
  expect(html).toContain('<code><mark color="#12345699">NEEDLE</mark></code>');
  expect(html).toContain('<a href="docs/file.md"><mark color="#12345655">needle</mark></a>');
  expect(html.replace(/<\/?mark(?: [^>]+)?>/g,'')).toBe(p.html);
  for(const q of ['*','a+b','café','&','😀'])expect(markdownRanges(p,q).hits.length).toBe(1);
  expect(markdownRanges(p,'docs/file.md').hits).toHaveLength(0); // source-only, not a rendered link label
  expect(source).toContain('**nee**dle');
  const separated=markdownProjection('first\n\nsecond');
  expect(markdownRanges(separated,'firstsecond').hits).toHaveLength(0);
});

test('render spans intersect a shared occurrence without changing its text',()=>{
  const text='before 😀 KEY after key';const hit=literalRanges(text,'key').ranges;
  expect(findSpans(text.slice(12,18),hit,12).map(x=>x.text).join('')).toBe(text.slice(12,18));
  expect(findSpans(text,hit).filter(x=>x.match).map(x=>x.text)).toEqual(['KEY','key']);
  expect(findContext(text,hit[1]).match).toBe('key');
});

test('navigation identity survives prepend and wraps in either direction',()=>{
  const hits=[{id:'a',part:0,start:5},{id:'b',part:0,start:1},{id:'b',part:0,start:9}];
  const selected=hits[2], earlier={id:'older',part:0,start:0};
  expect(findPosition([earlier,...hits],selected)).toBe(3);
  expect(findStep(3,4,1)).toBe(0);expect(findStep(0,4,-1)).toBe(3);
  expect(findPosition([],selected)).toBe(-1);expect(findStep(-1,0,1)).toBe(-1);
});

test('native virtual chunks keep complete hits, code and resolved links',()=>{
  const raw='a'.repeat(3997)+' hit across a boundary and end.';
  const q='hit across';const ranges=literalRanges(raw,q).ranges,chunks=messageChunks(raw,4000,ranges);
  expect(chunks.join('')).toBe(raw);expect(chunks.some(s=>s.includes(q))).toBe(true);
  const md='[first hit][ref]\n\n'+('A complete paragraph.\n\n'.repeat(70))+'**last hit**\n\n[ref]: ./doc.md';
  const parts=markdownChunks(md,450,'hit');expect(parts.length).toBeGreaterThan(2);
  expect(parts[0].projection.html).toContain('href="./doc.md"');
  expect(parts.flatMap(p=>markdownRanges(p.projection,'hit').hits).length).toBe(2);
  const plain='before hit '+('middle '.repeat(250))+'last hit';
  const long=markdownChunks(plain,320,'hit');expect(long.length).toBeGreaterThan(2);
  expect(long.map(p=>p.source).join('')).toBe(plain);
  expect(long.flatMap(p=>markdownRanges(p.projection,'hit').hits).length).toBe(2);
});

test('diagram labels can have a display-only space, while code remains exact',()=>{
  const source='graph LR\nA[Review<br>Done] --> B[Publish]  ';
  const drawing=flowchart(source).drawing;
  expect(drawing).toBeDefined();expect(diagramLabelTexts(drawing)).toContain('Review Done');
  expect(values(source,'Review Done')).toEqual([]);expect(values(source,'A[Review')).toEqual(['A[Review']);
});

test('native vendored Markdown is the pinned web parser with license',()=>{
  const vendor=readFileSync(new URL('./vendor/marked.js',import.meta.url),'utf8');
  const installed=readFileSync(new URL('../node_modules/marked/lib/marked.esm.js',import.meta.url),'utf8').split('\n//# sourceMappingURL=')[0].trim();
  const license=readFileSync(new URL('./vendor/marked.LICENSE',import.meta.url),'utf8');
  expect(vendor).toContain(installed);expect(license).toContain('Permission is hereby granted');
});


test('native rich blocks that would lose formatting keep their original renderer',()=>{
  for(const md of ['| A | B |\n|---|---|\n| hit | |','- [x] hit','3. hit','---\n\nhit','```js\n  hit\n```']){
    const p=markdownProjection(md);expect(markdownRanges(p,'hit').hits.length).toBe(1);expect(p.compatible).toBe(false);
  }
  expect(markdownProjection('**hit** and `hit`').compatible).toBe(true);
});
