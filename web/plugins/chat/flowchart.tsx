import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type MouseEvent } from 'react'
import { copyText } from '@client/copy.ts'
import { CheckIcon, DocumentDuplicateIcon as CopyIcon } from '@heroicons/react/16/solid'
import { useFindQuery } from './find-scope.ts'
import { containsFind, FIND_LIMITS, diagramLabelTexts } from '@core/chat-find.js'
import { mermaidParts, isMermaid } from '@core/chat-fences.js'
import { arrowTriangle, flowchart, sourceForDisplay, nodePolygon, FLOW_FONT, FLOW_LIMITS, FLOW_LINE, FLOW_WORDS, fitFlowchart, fitCamera, flowCamera, zoomFlowchart, FLOW_ZOOM_STEP } from '@core/chat-flowchart.js'

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

/** One SVG drawing path for both the overview and the expanded viewer. */
function DrawingSvg({ drawing, width, height, overview = false }: { drawing: Drawing; width: number; height: number; overview?: boolean }) {
  return <svg role="img" aria-label="Mermaid flowchart" viewBox={`0 0 ${drawing.width} ${drawing.height}`}
    width={width} height={height} style={overview?{maxWidth:'100%',height:'auto'}:undefined}>
    {drawing.edges.map((e,i)=><g key={i}>
      <polyline points={points(e.points)} fill="none" stroke="var(--fg2)" strokeWidth={e.style==='thick'?2.7:1.5} strokeDasharray={e.style==='dotted'?'4 4':undefined} strokeLinejoin="round" />
      {e.end && <polygon points={points(arrowTriangle(e.points.at(-1)!,e.points.at(-2)!))} fill="var(--fg2)" />}
      {e.start && <polygon points={points(arrowTriangle(e.points[0],e.points[1]))} fill="var(--fg2)" />}
    </g>)}
    {drawing.nodes.map(n=><Shape key={n.id} n={n} />)}
    {drawing.edges.map((e,i)=>e.lines.length?<Labels key={i} item={e} background />:null)}
  </svg>
}

function Preview({ drawing, expand }: { drawing: Drawing; expand: (button:HTMLButtonElement) => void }) {
  const fit = fitFlowchart(drawing,drawing.width)
  return <div className="flowchart-overview" aria-label="Flowchart preview">
    <button type="button" className="flowchart-expand" aria-haspopup="dialog" onClick={e=>{e.stopPropagation();expand(e.currentTarget)}}>{FLOW_WORDS.expand} ↗</button>
    <DrawingSvg drawing={drawing} {...fit} overview />
  </div>
}

type CopyAction = (e: MouseEvent<HTMLButtonElement>) => void
function useFlowCopy(code:string) {
  const [copied,setCopied]=useState(false)
  const timer=useRef<ReturnType<typeof setTimeout>>(undefined),epoch=useRef(0)
  useLayoutEffect(()=>{
    setCopied(false)
    return ()=>{epoch.current++;clearTimeout(timer.current)}
  },[code])
  const copy:CopyAction=e=>{
    e.stopPropagation()
    const generation=epoch.current
    void copyText(code,e.currentTarget).then(ok=>{
      if(!ok||generation!==epoch.current)return
      clearTimeout(timer.current);setCopied(true)
      timer.current=setTimeout(()=>setCopied(false),1400)
    })
  }
  return {copied,copy}
}

// The plugin's single overlay lives above the device-specific Chat layouts.
// A phone/desktop reparent must not destroy the viewer or its zoom. Retain
// only the chosen bounded drawing, exact source and a return target until close.
type Origin = { button:HTMLButtonElement; chat?:string; message?:string; index:number }
type OpenDiagram = { drawing:Drawing; code:string; origin:Origin }
let opened:OpenDiagram|null=null
const listeners=new Set<()=>void>()
const subscribe=(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn)}}
const getOpened=()=>opened
function setOpened(next:OpenDiagram|null) {opened=next;for(const fn of listeners)fn()}
function openDiagram(drawing:Drawing,code:string,button:HTMLButtonElement) {
  const message=button.closest<HTMLElement>('[data-whole][data-chat]')
  const cards=message?[...message.querySelectorAll('[data-flowchart]')]:[]
  setOpened({drawing,code,origin:{button,chat:message?.dataset.chat,message:message?.dataset.whole,index:cards.indexOf(button.closest('[data-flowchart]')!)}})
}
function returnTo(origin:Origin) {
  let button:HTMLElement|null=origin.button
  if(!button.isConnected) {
    // The original DOM may have been reparented while the viewer was open.
    const message=[...document.querySelectorAll<HTMLElement>('[data-whole][data-chat]')]
      .find(el=>el.dataset.chat===origin.chat&&el.dataset.whole===origin.message)
    button=message?.querySelectorAll('[data-flowchart]')[origin.index]?.querySelector<HTMLElement>('.flowchart-expand')??null
    button?.scrollIntoView({block:'center'})
  } else {
    const rect=button.getBoundingClientRect()
    let scroller=button.parentElement
    while(scroller&&getComputedStyle(scroller).overflowY!=='auto')scroller=scroller.parentElement
    const visible=scroller?.getBoundingClientRect()
    if(rect.top<(visible?.top??0)||rect.bottom>(visible?.bottom??innerHeight))button.scrollIntoView({block:'center'})
  }
  button?.focus({preventScroll:true})
}

export function FlowchartOverlay() {
  const active=useSyncExternalStore(subscribe,getOpened,()=>null)
  return active?<Expanded key={active.code} drawing={active.drawing} code={active.code} origin={active.origin} close={()=>setOpened(null)}/>:null
}

/** A top-layer dialog leaves the original message, scroll position and focus
 * in place. Native browser scrolling owns touch/trackpad/scrollbars here, not
 * the surrounding conversation. The fitted overview never captures a wheel. */
function Expanded({drawing, code, close, origin}: {drawing:Drawing;code:string;close:()=>void;origin:Origin}) {
  const {copied,copy}=useFlowCopy(code)
  const dialog=useRef<HTMLDialogElement>(null), viewport=useRef<HTMLDivElement>(null)
  const center=useRef<{scale:number|null;x:number;y:number}>(fitCamera())
  const [scale,setScale]=useState<number|null>(null)
  const [room,setRoom]=useState({width:1,height:1})
  const view=flowCamera(drawing,room,{...center.current,scale})
  useLayoutEffect(()=>{
    const d=dialog.current!, el=viewport.current!
    d.showModal()
    const measure=()=>setRoom(r=>r.width===el.clientWidth&&r.height===el.clientHeight?r:{width:Math.max(1,el.clientWidth),height:Math.max(1,el.clientHeight)})
    const observer=new ResizeObserver(measure);observer.observe(el);measure()
    el.focus({preventScroll:true})
    return ()=>{observer.disconnect();d.close();returnTo(origin)}
  },[])
  // Resize/zoom keeps the point in the middle; scroll events only update the
  // normalized center in a ref, avoiding React work for every touch pixel.
  useLayoutEffect(()=>{
    const el=viewport.current!
    el.scrollLeft=Math.max(0,-view.left);el.scrollTop=Math.max(0,-view.top)
  },[room,scale,drawing])
  const remember=()=>{
    const el=viewport.current!
    center.current={scale,x:view.width>el.clientWidth?(el.scrollLeft+el.clientWidth/2)/view.width:0.5,
      y:view.height>el.clientHeight?(el.scrollTop+el.clientHeight/2)/view.height:0.5}
  }
  const zoom=(to:number)=>{remember();const next=zoomFlowchart(drawing,room,center.current,to);center.current=next;setScale(next.scale)}
  const fit=()=>{center.current=fitCamera();setScale(null)}
  const pan=(x:number,y:number)=>viewport.current?.scrollBy(x*room.width*0.8,y*room.height*0.8)
  return <dialog ref={dialog} className="flowchart-dialog" aria-label="Expanded Mermaid flowchart" onCancel={e=>{e.preventDefault();close()}}
    onPointerDown={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()}
    onWheel={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onKeyDown={e=>{
      e.stopPropagation()
      switch(e.key){
        case '0':fit();break;case '1':zoom(1);break;case '+':case '=':zoom(view.scale*FLOW_ZOOM_STEP);break;case '-':zoom(view.scale/FLOW_ZOOM_STEP);break;
        case 'ArrowLeft':pan(-1,0);break;case 'ArrowRight':pan(1,0);break;case 'ArrowUp':case 'PageUp':pan(0,-1);break;case 'ArrowDown':case 'PageDown':pan(0,1);break;
        case 'Home':viewport.current?.scrollTo(0,0);break;case 'End':viewport.current?.scrollTo(view.width,view.height);break;
        default:return
      }
      e.preventDefault()
    }}>
    <div className="flowchart-dialog-head"><strong>Mermaid flowchart</strong>
      <button type="button" aria-label={copied?'Copied':'Copy code'} onClick={copy}>{copied?'Copied':'Copy'}</button>
      <button type="button" onClick={close}>{FLOW_WORDS.close}</button>
    </div>
    <div className="flowchart-tools">
      <button type="button" onClick={fit}>{FLOW_WORDS.fit}</button>
      <button type="button" onClick={()=>zoom(1)}>{FLOW_WORDS.actual}</button>
      <button type="button" aria-label={FLOW_WORDS.zoomOut} onClick={()=>zoom(view.scale/FLOW_ZOOM_STEP)}>−</button>
      <button type="button" aria-label={FLOW_WORDS.zoomIn} onClick={()=>zoom(view.scale*FLOW_ZOOM_STEP)}>+</button>
      <span className="flowchart-pct">{Math.round(view.scale*100)}%</span>
    </div>
    <div className="flowchart-tools">
      <button type="button" aria-label={FLOW_WORDS.panLeft} onClick={()=>pan(-1,0)}>←</button>
      <button type="button" aria-label={FLOW_WORDS.panUp} onClick={()=>pan(0,-1)}>↑</button>
      <button type="button" aria-label={FLOW_WORDS.panDown} onClick={()=>pan(0,1)}>↓</button>
      <button type="button" aria-label={FLOW_WORDS.panRight} onClick={()=>pan(1,0)}>→</button>
      <span className="flowchart-hint">Scroll or swipe to pan</span>
    </div>
    <div ref={viewport} className="flowchart-full-viewport" tabIndex={0} aria-label="Scrollable diagram" onScroll={remember}>
      <div className="flowchart-full-canvas" style={{width:view.width,height:view.height}}><DrawingSvg drawing={drawing} {...view}/></div>
    </div>
  </dialog>
}

type Fence = { code: string; closed: boolean; allowed?: boolean }

export const FlowchartCard = memo(function FlowchartCard({ code, closed, allowed = true }: Fence) {
  const { drawing, error } = useMemo(() => allowed?flowchart(code,closed):{error:FLOW_WORDS.many}, [code,closed,allowed]) as { drawing?: Drawing; error?: string }
  const display = useMemo(()=>sourceForDisplay(code),[code])
  const [source,setSource] = useState(false)
  const {copied,copy}=useFlowCopy(code)
  const query = useFindQuery()
  const searchSource = !!query && containsFind(code, query)
  const shown = query ? code.slice(0, FIND_LIMITS.chars) : display.text
  const labels = query && !searchSource && drawing ? diagramLabelTexts(drawing).filter((label:string)=>containsFind(label,query)) : []
  const preview = !!drawing && !source && !searchSource
  return <div className="flowchart-card" data-flowchart="" style={{width:Math.max(260,Math.min(drawing?.width??360,720))}}
    onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <div className="flowchart-head">
      <span className="flowchart-lang">mermaid</span>
      {drawing && <button type="button" aria-expanded={!preview} disabled={searchSource}
        onClick={e=>{e.stopPropagation();setSource(!source)}}>{searchSource?"Search source":preview?FLOW_WORDS.source:FLOW_WORDS.preview}</button>}
      <button type="button" aria-label={copied?'Copied':'Copy code'} onClick={copy}>{copied?<CheckIcon className="size-3 text-ready"/>:<CopyIcon className="size-3"/>}{copied?'Copied':'Copy'}</button>
    </div>
    {preview ? <Preview drawing={drawing!} expand={button=>openDiagram(drawing!,code,button)} /> : <>
      {error && <p className="flowchart-error" role="status">{error}</p>}
      {(shown.length < code.length) && <p className="flowchart-error">{FLOW_WORDS.shortened}</p>}
      <pre data-find-limited={query && shown.length < code.length ? "" : undefined} className="flowchart-source" aria-label="Mermaid source" tabIndex={0} onPointerDown={e=>e.stopPropagation()}><code>{shown}</code></pre>
    </>}
    {labels.length>0 ? <div className="px-3 pb-2 text-sm">
      <div data-find-ignore className="text-xs text-fg3">Matching diagram labels</div>
      {labels.map((label:string,i:number)=><div data-find-field key={i}>{label}</div>)}
    </div> : null}
  </div>
})

/** Used by the agent's existing Markdown and the person's literal text. The
 * text segments still use their original renderers (including task chips).
 * Closed diagrams don't change identity when later words stream in. */
export function MermaidMessage({ text, renderText }: { text:string; renderText:(text:string)=>ReactNode }) {
  const parts=useMemo(()=>[...mermaidParts(text)], [text])
  if(!parts.some(isMermaid))return <>{renderText(text)}</>
  let count=0
  return <>{parts.map((p,i)=>isMermaid(p)
    ? <FlowchartCard key={i} code={p.code!} closed={p.closed!} allowed={++count<=FLOW_LIMITS.perMessage}/>
    : <Fragment key={i}>{renderText(p.text!)}</Fragment>)}</>
}
