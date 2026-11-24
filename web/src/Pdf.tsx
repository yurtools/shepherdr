import { useEffect, useRef, useState } from 'react'
import { PdfSession } from './pdf-loader'

/** One page/canvas at a time. Off-screen evidence releases its worker and canvas. */
export function Pdf({ src, caption }: { src: string; caption?: string }) {
  const frame = useRef<HTMLElement>(null), stage = useRef<HTMLDivElement>(null)
  const session = useRef<PdfSession | null>(null)
  const [visible, setVisible] = useState(false), [width, setWidth] = useState(600)
  const [page, setPage] = useState(1), [pages, setPages] = useState(0), [zoom, setZoom] = useState<number | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' })
    observer.observe(frame.current!)
    const sizes = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    sizes.observe(stage.current!)
    return () => { observer.disconnect(); sizes.disconnect() }
  }, [])
  useEffect(() => {
    if (!visible) return
    let live = true
    setError(''); setPages(0); setPage(1); setBusy(true)
    let current: PdfSession
    try { current = session.current = new PdfSession(src) }
    catch { setError('This browser cannot start the PDF worker. Open the original in a PDF app.'); setBusy(false); return }
    void current.open().then(count => { if (live) { setPages(count); setBusy(false) } }, e => { if (live) { setError(e.message); setBusy(false) } })
    return () => { live = false; session.current = null; void current.destroy(); stage.current?.replaceChildren() }
  }, [src, visible, reload])
  useEffect(() => {
    const current = session.current
    if (!current?.doc || !pages) return
    let live = true
    setBusy(true); setError(''); stage.current?.replaceChildren()
    void current.render(page, width, zoom).then(canvas => {
      if (live && canvas) { stage.current?.replaceChildren(canvas); setBusy(false) }
    }, e => { if (live) { setError(`This PDF page could not be rendered. ${e.message || 'Open the original in a PDF app.'}`); setBusy(false) } })
    return () => { live = false; current.cancel() }
  }, [page, pages, width, zoom, visible, reload])
  const button = 'rounded px-2 py-1 bg-well disabled:opacity-40'
  return <figure ref={frame} className="min-w-0 space-y-2 rounded-box bg-well p-2" aria-label={caption || 'PDF preview'}>
    <div className="flex flex-wrap items-center gap-2 text-sm" role="toolbar" aria-label="PDF controls">
      <button className={button} aria-label="Previous PDF page" disabled={page <= 1 || !pages} onClick={() => setPage(p => p - 1)}>←</button>
      <span>Page {page} / {pages || '…'}</span>
      <button className={button} aria-label="Next PDF page" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>→</button>
      <button className={button} aria-label="Zoom out PDF" onClick={() => setZoom(z => Math.max(.25, (z ?? 1) / 1.25))}>−</button>
      <button className={button} aria-label="Zoom in PDF" onClick={() => setZoom(z => Math.min(4, (z ?? 1) * 1.25))}>+</button>
      <button className={button} onClick={() => setZoom(null)}>{zoom === null ? 'Fit' : `${Math.round(zoom * 100)}% · Fit`}</button>
      <button className={button} onClick={() => setReload(v => v + 1)}>Reload PDF</button>
      <a className="underline" href={src} target="_blank" rel="noopener noreferrer">Open original</a>
    </div>
    <p className="text-xs text-fg2">PDF · read only</p>
    {busy && <p role="status" className="text-sm text-fg2">Rendering PDF page…</p>}
    {error && <p role="alert" className="p-2 text-sm text-fg2">{error}</p>}
    <div ref={stage} className="max-h-[70vh] min-h-40 overflow-auto p-2" />
    {caption && <figcaption className="text-sm text-fg2">{caption}</figcaption>}
  </figure>
}
