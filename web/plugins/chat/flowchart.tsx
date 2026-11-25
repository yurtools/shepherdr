import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { copyText } from '@client/copy.ts'
import { CheckIcon, DocumentDuplicateIcon as CopyIcon } from '@heroicons/react/16/solid'
import { mermaidParts, isMermaid } from '@core/chat-fences.js'
import { arrowTriangle, flowchart, sourceForDisplay, nodePolygon, FLOW_FONT, FLOW_LINE, FLOW_VIEW_HEIGHT, FLOW_WORDS } from '@core/chat-flowchart.js'

type Point = { x: number; y: number }
type Node = Point & { id: string; shape: string; width: number; height: number; lines: string[] }
type Edge = Point & { from: string; to: string; width: number; height: number; lines: string[]; points: Point[]; style: string; start: boolean; end: boolean }
type Drawing = { width: number; height: number; nodes: Node[]; edges: Edge[] }
const points = (ps: Point[]) => ps.map(p => `${p.x},${p.y}`).join(' ')

// React only creates these known SVG elements. Source never becomes markup,
// an SVG URL, CSS, a script, a tooltip, or an event handler.
function Labels({ item, background = false }: { item: Node | Edge; background?: boolean }) {
  return <g>
    {background && <rect x={item.x-item.width/2} y={item.y-item.height/2} width={item.width} height={item.height} rx={4} fill="var(--well)" />}
    <text x={item.x} y={item.y} fill="var(--fg)" fontSize={FLOW_FONT} textAnchor="middle" dominantBaseline="central">
      {item.lines.map((line,i) => <tspan key={i} x={item.x} y={item.y+(i-(item.lines.length-1)/2)*FLOW_LINE}>{line}</tspan>)}
    </text>
  </g>
}

function Shape({ n }: { n: Node }) {
  const [x,y] = [n.x-n.width/2,n.y-n.height/2]
  const polygon = nodePolygon(n)
  const color = { fill:'var(--bubble)', stroke:'var(--accent)', strokeWidth:1.5 }
  const rx = n.shape==='circle'||n.shape==='pill' ? n.height/2 : n.shape==='round'||n.shape==='database' ? 10 : 5
  return <g>
    {polygon.length ? <polygon points={points(polygon)} {...color} /> : <rect x={x} y={y} width={n.width} height={n.height} rx={rx} {...color} />}
    {n.shape==='subroutine' && <path d={`M${x+8} ${y}v${n.height} M${x+n.width-8} ${y}v${n.height}`} fill="none" stroke={color.stroke} />}
    {n.shape==='database' && <ellipse cx={n.x} cy={y+6} rx={n.width/2} ry={6} fill="none" stroke={color.stroke} />}
    <Labels item={n} />
  </g>
}

function Preview({ drawing }: { drawing: Drawing }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(false)
  useLayoutEffect(() => {
    const el = viewport.current!
    const measure = () => setScroll(el.scrollWidth > el.clientWidth+1 || el.scrollHeight > el.clientHeight+1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [drawing])
  return <>
    <div ref={viewport} className="flowchart-viewport" style={{maxHeight:FLOW_VIEW_HEIGHT}} tabIndex={0} aria-label="Flowchart preview" onPointerDown={e=>e.stopPropagation()}>
      <svg role="img" aria-label="Mermaid flowchart" viewBox={`0 0 ${drawing.width} ${drawing.height}`}
        style={{ width:`clamp(${Math.ceil(drawing.width*0.85)}px, 100%, ${Math.ceil(drawing.width)}px)`, height:'auto' }}>
        {drawing.edges.map((e,i)=><g key={i}>
          <polyline points={points(e.points)} fill="none" stroke="var(--fg2)" strokeWidth={e.style==='thick'?2.7:1.5} strokeDasharray={e.style==='dotted'?'4 4':undefined} strokeLinejoin="round" />
          {e.end && <polygon points={points(arrowTriangle(e.points.at(-1)!,e.points.at(-2)!))} fill="var(--fg2)" />}
          {e.start && <polygon points={points(arrowTriangle(e.points[0],e.points[1]))} fill="var(--fg2)" />}
        </g>)}
        {drawing.nodes.map(n=><Shape key={n.id} n={n} />)}
        {drawing.edges.map((e,i)=>e.lines.length?<Labels key={i} item={e} background />:null)}
      </svg>
    </div>
    {scroll && <p className="flowchart-scroll-hint">{FLOW_WORDS.scroll}</p>}
  </>
}

type Fence = { code: string; closed: boolean }

export function FlowchartCard({ code, closed }: Fence) {
  const { drawing, error } = useMemo(() => flowchart(code,closed), [code,closed]) as { drawing?: Drawing; error?: string }
  const display = useMemo(()=>sourceForDisplay(code),[code])
  const [source,setSource] = useState(false)
  const [copied,setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const epoch = useRef(0)
  useLayoutEffect(()=>{
    setCopied(false)
    return ()=>{epoch.current++; clearTimeout(copyTimer.current)}
  },[code])
  const preview = !!drawing && !source
  return <div className="flowchart-card" data-flowchart="" style={{width:Math.max(260,Math.min(drawing?.width??360,720))}}>
    <div className="flowchart-head">
      <span className="flowchart-lang">mermaid</span>
      {drawing && <button type="button" aria-expanded={!preview} onPointerDown={e=>e.stopPropagation()}
        onClick={e=>{e.stopPropagation();setSource(!source)}}>{preview?FLOW_WORDS.source:FLOW_WORDS.preview}</button>}
      <button type="button" aria-label={copied?'Copied':'Copy code'} onPointerDown={e=>e.stopPropagation()} onClick={e=>{
        e.stopPropagation()
        const generation=epoch.current
        void copyText(code,e.currentTarget).then(ok=>{
          if(!ok||generation!==epoch.current)return
          clearTimeout(copyTimer.current);setCopied(true)
          copyTimer.current=setTimeout(()=>setCopied(false),1400)
        })
      }}>{copied?<CheckIcon className="size-3 text-ready"/>:<CopyIcon className="size-3"/>}{copied?'Copied':'Copy'}</button>
    </div>
    {preview ? <Preview drawing={drawing!} /> : <>
      {error && <p className="flowchart-error" role="status">{error}</p>}
      {display.shortened && <p className="flowchart-error">{FLOW_WORDS.shortened}</p>}
      <pre className="flowchart-source" aria-label="Mermaid source" tabIndex={0} onPointerDown={e=>e.stopPropagation()}><code>{display.text}</code></pre>
    </>}
  </div>
}

/** Used by the agent's existing Markdown and the person's literal text. The
 * text segments still use their original renderers (including task chips).
 * Closed diagrams don't change identity when later words stream in. */
export function MermaidMessage({ text, renderText }: { text:string; renderText:(text:string)=>ReactNode }) {
  const parts=useMemo(()=>[...mermaidParts(text)], [text])
  if(!parts.some(isMermaid))return <>{renderText(text)}</>
  return <>{parts.map((p,i)=>isMermaid(p)
    ? <FlowchartCard key={i} code={p.code!} closed={p.closed!}/>
    : <Fragment key={i}>{renderText(p.text!)}</Fragment>)}</>
}
