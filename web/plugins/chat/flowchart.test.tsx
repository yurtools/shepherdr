import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FlowchartCard, MermaidMessage } from './flowchart.tsx'

const fence=(source:string)=>'```mermaid\n'+source+'\n```'

test('web renders known SVG nodes and text, with explicit source and copy controls',()=>{
  const html=renderToStaticMarkup(<FlowchartCard code={'flowchart TD\nA[Start] --> B{Ready?}\nB -->|Yes| C[Done]'} closed />)
  expect(html).toContain('aria-label="Mermaid flowchart"')
  expect(html).toContain('Ready?')
  expect(html).toContain('Yes')
  expect(html).toContain('Show source')
  expect(html).toContain('Copy code')
  expect(html).toContain('Expand diagram')
  expect(html).not.toContain('flowchart-viewport')
  expect(html).not.toContain('<dialog')
  expect(html).toContain('fill="var(--fg)"')
  expect(html).toContain('stroke="var(--accent)"')
  expect(html).not.toContain('foreignObject')
  expect(html).not.toContain('flowchart-source')
})

test('web fallbacks preserve original source as escaped text, never active HTML or links',()=>{
  const code='graph LR\n A["<img src=x onerror=alert(1)>"] --> B'
  const html=renderToStaticMarkup(<FlowchartCard code={code} closed />)
  expect(html).toContain('syntax is not supported')
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('Mermaid flowchart"')
  expect(html).not.toContain('Expand diagram')
  expect(html).toContain('Copy code')
  const incomplete=renderToStaticMarkup(<FlowchartCard code="graph LR\nA --> B" closed={false} />)
  expect(incomplete).toContain('Preview waits for a closing fence.')
  expect(incomplete).not.toContain('Show source')
})

test('the same message splitter keeps literal and ordinary Markdown parts intact',()=>{
  const normal='```js\nconst x = 42;\n```'
  const text='before\n'+fence('graph LR; A --> B')+'\n'+normal+'\n'+fence('flowchart TD; X --> Y')+'\nafter'
  const plain=(s:string)=><div data-original="">{s}</div>
  const rendered=renderToStaticMarkup(<MermaidMessage text={text} renderText={plain} />)
  expect(rendered.match(/aria-label="Mermaid flowchart"/g)).toHaveLength(2)
  expect(rendered).toContain(normal)
  expect(rendered).toContain('before')
  expect(rendered).toContain('after')
  expect(renderToStaticMarkup(<MermaidMessage text={normal} renderText={plain} />)).toBe(renderToStaticMarkup(plain(normal)))
})

test('many diagrams in one message keep all sources without laying out unbounded previews',()=>{
  const text=Array.from({length:13},(_,i)=>fence(`graph TD; A${i} --> B${i}`)).join('\n')
  const rendered=renderToStaticMarkup(<MermaidMessage text={text} renderText={s=><div>{s}</div>}/>)
  expect(rendered.match(/aria-label="Mermaid flowchart"/g)).toHaveLength(12)
  expect(rendered).toContain('too many diagrams to preview')
  expect(rendered).toContain('A12 --&gt; B12')
})
