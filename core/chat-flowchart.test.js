import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fencedParts, mermaidParts, isMermaid } from './chat-fences.js';
import { mediaIn } from './chat-view.js';
import { flowchart, FLOW_LIMITS, FLOW_WORDS, fitFlowchart, chartHeight, fitCamera, flowCamera, panFlowchart, zoomFlowchart, FLOW_OPEN_HEIGHT, FLOW_VIEW_HEIGHT, FLOW_MAX_ZOOM, arrowTriangle, sourceForDisplay } from './chat-flowchart.js';

const fence = (s, lang='mermaid', ticks='```') => ticks+lang+'\n'+s+'\n'+ticks;
const branch = 'flowchart TD\nA([Start]) --> B{Ready?}\nB -->|Yes| C[Done]\nB -- No --> D[Revise]\nD -.-> B';

test('top-level closed flowchart and graph blocks are independent; normal code is left to Markdown',()=>{
  const code=fence('const x = 1;', 'js');
  const text='Intro\n\n'+fence(branch)+'\n\n'+code+'\n'+fence('graph LR; A --> B','MERMAID','~~~')+'\nEnd';
  const parts=[...mermaidParts(text)];
  expect(parts.filter(isMermaid).map(p=>p.code)).toEqual([branch,'graph LR; A --> B']);
  expect(parts[2].text).toContain(code);
  const all=[...fencedParts(text)];
  expect(all.filter(p=>p.type==='code').map(p=>p.lang)).toEqual(['mermaid','js','MERMAID']);
});

test('longer ordinary fences, inline code, and unclosed ordinary fences do not create diagrams',()=>{
  const nested=fence(branch);
  for(const text of [fence(nested,'markdown','````'),'`mermaid A --> B`','````text\n'+nested]){
    expect([...mermaidParts(text)]).toEqual([{type:'md',text}]);
  }
  const stream='Before\n```mermaid\n'+branch;
  expect([...mermaidParts(stream)][1]).toMatchObject({code:branch,closed:false});
  expect(flowchart(branch,false)).toEqual({error:FLOW_WORDS.incomplete});
  const complete=[...mermaidParts(stream+'\n```')][1];
  expect(complete.closed).toBe(true);
  expect(flowchart(complete.code,complete.closed).drawing).toBeDefined();
});

test('source and code bytes survive mixed media, CRLF, blank lines and trailing spaces',()=>{
  const code='graph LR\r\n  A --> B  \r\n\r\n  B --> C';
  const raw='Picture: ![example](/tmp/sample.png)\n\n'+fence(code)+'\n\nAfter.';
  const got=mediaIn(raw);
  expect(got.media).toHaveLength(1);
  expect([...mermaidParts(got.text)].find(isMermaid).code).toBe(code);
  expect([...fencedParts('~~~mermaid\r\n'+code+'\r\n~~~~')][0]).toMatchObject({code,closed:true});
});

test('decision branches, loop, edge styles, labels and common node shapes lay out as data',()=>{
  const {drawing}=flowchart(branch);
  expect(drawing.nodes.map(n=>[n.label,n.shape])).toEqual([['Start','pill'],['Ready?','diamond'],['Done','rect'],['Revise','rect']]);
  expect(drawing.edges.map(e=>[e.from,e.to,e.label,e.style])).toEqual([['A','B','','solid'],['B','C','Yes','solid'],['B','D','No','solid'],['D','B','','dotted']]);
  expect(drawing.nodes[0].y).toBeLessThan(drawing.nodes[1].y);
  for(const e of drawing.edges){
    expect(e.points.length).toBeGreaterThan(1);
    expect(arrowTriangle(e.points.at(-1),e.points.at(-2))).toHaveLength(3);
    expect(e.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).toBe(true);
  }
  const shapes=flowchart('graph LR; A((Circle)) === B[[Routine]] ==> C[(Data)] <--> D{{Hexagon}}').drawing;
  expect(shapes.nodes.map(n=>n.shape)).toEqual(['circle','subroutine','database','hexagon']);
  expect(shapes.edges[2].start).toBe(true);
});

test('graph directions, chained links, comments and quoted/wrapped labels',()=>{
  for(const dir of ['TB','TD','BT','LR','RL']){
    const {drawing}=flowchart('graph '+dir+'; A["Read; then write"] --> B(Review<br/>details) --> C\n%% ignored');
    const [a,b]=drawing.nodes;
    expect(a.label).toBe('Read; then write');
    expect(b.lines).toEqual(['Review','details']);
    if(dir==='LR') expect(a.x).toBeLessThan(b.x);
    else if(dir==='RL') expect(a.x).toBeGreaterThan(b.x);
    else if(dir==='BT') expect(a.y).toBeGreaterThan(b.y);
    else expect(a.y).toBeLessThan(b.y);
  }
  expect(flowchart('flowchart\nA --> B').drawing).toBeDefined();
});

test('reject invalid, unsupported, active configuration and oversized inputs without partial drawing',()=>{
  for(const source of [
    'sequenceDiagram\nA->>B: Hello',
    'flowchart TD\nA --> B\nclick A "https://example.invalid"',
    '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA --> B',
    'flowchart LR\nA[<script>alert(1)</script>] --> B',
    'flowchart TD\nsubgraph group\nA --> B\nend',
    'flowchart TD\nA -->',
    'graph TB\nA["broken label]',
  ]) expect(flowchart(source).error).toBeTruthy();
  expect(flowchart('graph LR\n'+ 'x'.repeat(FLOW_LIMITS.source)).error).toBe(FLOW_WORDS.large);
  expect(flowchart('graph TD\n'+Array.from({length:FLOW_LIMITS.nodes+1},(_,i)=>'N'+i).join('\n')).error).toBe(FLOW_WORDS.large);
  expect(flowchart('graph LR\n'+ 'A --> B\n'.repeat(FLOW_LIMITS.edges+1)).error).toBe(FLOW_WORDS.large);
  // A node identifier is never used as an object key inside the layout engine.
  expect(flowchart('graph LR\n__proto__ --> constructor').drawing.nodes.map(n=>n.id)).toEqual(['__proto__','constructor']);
  const huge='A --> B\n'.repeat(4000);
  expect(sourceForDisplay(huge).shortened).toBe(true);
  expect(sourceForDisplay(huge).text.split('\n').length).toBeLessThanOrEqual(FLOW_LIMITS.sourceLines);
  expect(sourceForDisplay(branch)).toEqual({text:branch,shortened:false});
});

const chain = dir => `graph ${dir}; `+Array.from({length:13},(_,i)=>`N${i}[Stage ${i+1}]`).join(' --> ');

test('inline previews fit the entire tall or wide drawing and keep exact bounded row height',()=>{
  for(const dir of ['TD','LR']){
    const source=chain(dir),{drawing}=flowchart(source);
    const original=JSON.stringify(drawing);
    expect(dir==='TD'?drawing.height:drawing.width).toBeGreaterThan(1000);
    for(const width of [180,230.4,540,1800]){
      const fit=fitFlowchart(drawing,width);
      expect(fit.width).toBeLessThanOrEqual(width);
      expect(fit.height).toBeLessThanOrEqual(FLOW_VIEW_HEIGHT);
      expect(fit.scale).toBeGreaterThan(0);
      expect(fit.height).toBeGreaterThanOrEqual(drawing.height*fit.scale-0.0001);
      expect(fit.width).toBeGreaterThanOrEqual(drawing.width*fit.scale-0.0001);
      expect(chartHeight(drawing,width)).toBe(fit.height+FLOW_OPEN_HEIGHT);
    }
    expect(flowchart(source).drawing).toBe(drawing);
    expect(JSON.stringify(drawing)).toBe(original);
  }
});

test('fit, zoom and pan make both ends of the drawing reachable at readable size',()=>{
  for(const source of [chain('TD'),chain('LR'),branch]){
    const {drawing}=flowchart(source),room={width:240,height:250};
    const fit=flowCamera(drawing,room,fitCamera());
    expect(fit.width).toBeLessThanOrEqual(room.width);
    expect(fit.height).toBeLessThanOrEqual(room.height);
    expect(fit.left).toBeGreaterThanOrEqual(0);expect(fit.top).toBeGreaterThanOrEqual(0);
    const scaled=zoomFlowchart(drawing,room,fitCamera(),1);
    expect(scaled.scale).toBe(1);
    const start=flowCamera(drawing,room,panFlowchart(drawing,room,scaled,-Infinity,-Infinity));
    const end=flowCamera(drawing,room,panFlowchart(drawing,room,scaled,Infinity,Infinity));
    for(const [size,viewport,near,far] of [[start.width,room.width,start.left,end.left],[start.height,room.height,start.top,end.top]]){
      if(size>viewport){expect(near).toBeCloseTo(0);expect(far+size).toBeCloseTo(viewport);}
      else{expect(near).toBeCloseTo((viewport-size)/2);expect(far).toBeCloseTo(near);}
    }
    // Max zoom is bounded. At the maximum, every label can be brought into a
    // viewport: pan to its center or clamp at the actual boundary.
    const max=zoomFlowchart(drawing,room,scaled,Infinity);
    expect(max.scale).toBe(FLOW_MAX_ZOOM);
    for(const n of [...drawing.nodes,...drawing.edges.filter(e=>e.lines.length)]){
      const v=flowCamera(drawing,room,{scale:1,x:n.x/drawing.width,y:n.y/drawing.height});
      expect(n.x+v.left).toBeGreaterThanOrEqual(0);expect(n.x+v.left).toBeLessThanOrEqual(room.width);
      expect(n.y+v.top).toBeGreaterThanOrEqual(0);expect(n.y+v.top).toBeLessThanOrEqual(room.height);
    }
    const resized={width:600,height:450};
    expect(flowCamera(drawing,resized,max).scale).toBe(FLOW_MAX_ZOOM);
    expect(flowCamera(drawing,resized,fitCamera()).width).toBeLessThanOrEqual(resized.width);
  }
});

test('zoom keeps the point under the pointer when there is room to pan',()=>{
  const {drawing}=flowchart(chain('LR')),room={width:300,height:160};
  const camera=zoomFlowchart(drawing,room,fitCamera(),1),before=flowCamera(drawing,room,camera),at={x:100,y:80};
  const after=flowCamera(drawing,room,zoomFlowchart(drawing,room,camera,2,at));
  expect((at.x-before.left)/before.width).toBeCloseTo((at.x-after.left)/after.width);
  expect(after.scale).toBe(2);
});

test('the installed layout engine is precisely the pinned upstream browser bundle with its license',()=>{
  const vendor=readFileSync(new URL('./vendor/dagre.js',import.meta.url),'utf8');
  const pkg=new URL('../node_modules/@dagrejs/dagre/',import.meta.url);
  expect(vendor).toContain(readFileSync(new URL('dist/dagre.min.js',pkg),'utf8').trim());
  expect(vendor).toContain(readFileSync(new URL('LICENSE',pkg),'utf8').trim());
  expect(JSON.parse(readFileSync(new URL('package.json',pkg),'utf8')).version).toBe('1.1.5');
});
