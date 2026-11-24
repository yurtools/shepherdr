/// <reference types="vite/client" />
// PDF.js, worker and font/CMap/decoder data are bundled locally, never loaded from a CDN.
import { getDocument, PDFWorker, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.mjs?url'

const maps = import.meta.glob('../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const fonts = import.meta.glob('../../node_modules/pdfjs-dist/standard_fonts/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const wasm = import.meta.glob('../../node_modules/pdfjs-dist/wasm/*.wasm', { query: '?url', import: 'default', eager: true }) as Record<string, string>
async function resource(files: Record<string, string>, name: string) {
  const url = Object.entries(files).find(([path]) => path.endsWith('/' + name))?.[1]
  if (!url) throw new Error('This PDF needs unavailable font data. Open the original in a PDF app.')
  const response = await fetch(url)
  if (!response.ok) throw new Error('PDF font data could not be read.')
  return new Uint8Array(await response.arrayBuffer())
}
class BinaryData {
  fetch({ kind, filename }: { kind: string; filename: string }) {
    return resource(kind === 'cMapUrl' ? maps : kind === 'standardFontDataUrl' ? fonts : wasm, filename)
  }
}

export function canvasSize(width: number, height: number, scale: number, dpr: number) {
  const ratio = Math.min(Math.max(1, dpr), 2, Math.sqrt(4_000_000 / (width * height * scale * scale)))
  return { width: Math.max(1, Math.floor(width * scale * ratio)), height: Math.max(1, Math.floor(height * scale * ratio)) }
}

export class PdfSession {
  task: PDFDocumentLoadingTask
  doc?: PDFDocumentProxy
  renderTask?: RenderTask
  closed = false
  generation = 0
  port: Worker
  worker: PDFWorker
  workerUrl: string
  constructor(url: string) {
    // Supplying a real port prevents PDF.js from falling back to parsing on the UI thread.
    // A blob wrapper also works in the self-contained artifact preview HTML.
    this.workerUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(new URL(worker, document.baseURI).href)};`], { type: 'text/javascript' }))
    try { this.port = new Worker(this.workerUrl, { type: 'module' }); this.worker = PDFWorker.create({ port: this.port }) }
    catch (e) { URL.revokeObjectURL(this.workerUrl); throw e }
    this.task = getDocument({ url, worker: this.worker, disableAutoFetch: true, disableStream: true,
      useWorkerFetch: false, BinaryDataFactory: BinaryData,
      enableXfa: false, stopAtErrors: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 16_000_000 })
  }
  async open() {
    const timer = setTimeout(() => void this.destroy(), 20000)
    try { this.doc = await this.task.promise; return this.doc.numPages }
    catch (error) {
      await this.destroy()
      if ((error as Error).name === 'PasswordException') throw new Error('Password-protected PDFs cannot be previewed here. Open the original in a PDF app.')
      throw new Error('PDF could not be loaded. It may be corrupt, unsupported or unavailable. Open the original in a PDF app.')
    } finally { clearTimeout(timer) }
  }
  cancel() { this.generation++; this.renderTask?.cancel(); this.renderTask = undefined }
  async render(pageNumber: number, width: number, zoom: number | null) {
    this.cancel()
    const generation = this.generation
    const timer = setTimeout(() => void this.destroy(), 15000)
    let page
    try {
      page = await this.doc!.getPage(pageNumber)
      if (this.closed || generation !== this.generation) return null
      const original = page.getViewport({ scale: 1 })
      const scale = zoom ?? Math.min(2, Math.max(100, width - 24) / original.width, Math.max(200, innerHeight * .65) / original.height)
      const size = canvasSize(original.width, original.height, scale, devicePixelRatio || 1)
      const canvas = document.createElement('canvas')
      canvas.width = size.width; canvas.height = size.height
      canvas.style.width = `${original.width * scale}px`; canvas.style.height = `${original.height * scale}px`
      canvas.style.margin = '0 auto'
      canvas.setAttribute('aria-label', `PDF page ${pageNumber}`); canvas.setAttribute('role', 'img')
      const viewport = page.getViewport({ scale: size.width / original.width })
      this.renderTask = page.render({ canvas, viewport })
      await this.renderTask.promise
      if (this.closed || generation !== this.generation) { canvas.width = canvas.height = 0; return null }
      return canvas
    } catch (error) {
      if (generation !== this.generation && !this.closed) return null
      throw error
    } finally { clearTimeout(timer); page?.cleanup() }
  }
  async destroy() {
    if (this.closed) return
    this.closed = true; this.cancel()
    try { await this.task.destroy().catch(() => {}) }
    finally { this.worker.destroy(); this.port.terminate(); URL.revokeObjectURL(this.workerUrl) }
  }
}
