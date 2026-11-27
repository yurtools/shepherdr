import { literalRanges, FIND_LIMITS, FIND_BLOCK } from '@core/chat-find.js'

export type FindHit = { id: string; part: number; start: number; end: number; range: Range }
const FIELD = '[data-text],[data-find-field],[data-card-title]'
const IGNORE = 'svg,script,style,[hidden],.sr-only,[data-find-ignore],.code-head,.flowchart-head,.flowchart-error,button:not([data-mention]),[aria-hidden="true"]'

type Run = { text: string; nodes: { node: Text; offset: number }[] }

/** Join adjacent inline text runs (including emphasis/code/link spans), but
 * never manufacture a match across unrelated paragraphs, cells, or controls.
 * Folded message bodies are mounted, so their words are indexed too. */
function runs(root: Element) {
  const out: Run[] = []
  let current: Run | null = null
  const end = () => { current = null }
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? ''
      if (!text) return
      if (!current) { current = { text: '', nodes: [] }; out.push(current) }
      current.nodes.push({ node: node as Text, offset: current.text.length })
      current.text += text
    } else if (node instanceof Element) {
      if (node.matches(IGNORE)) { end(); return }
      const block = FIND_BLOCK.test(node.localName)
      if (block) end()
      for (const child of node.childNodes) visit(child)
      if (block) end()
    }
  }
  visit(root)
  return out
}

export function scanFindRow(row: HTMLElement, q: string, limit: number) {
  const hits: FindHit[] = []
  let part = 0, limited = !!row.querySelector('[data-find-limited]')
  const id = row.dataset.findRow ?? row.dataset.msg ?? row.dataset.whole ?? ''
  for (const field of row.querySelectorAll(FIELD)) {
    const own=field.closest("[data-find-row]");if(own&&own!==row)continue
    if (field.parentElement?.closest(FIELD) && row.contains(field.parentElement.closest(FIELD))) continue
    for (const run of runs(field)) {
      const current = part++
      const got = literalRanges(run.text, q, Math.max(0, limit - hits.length))
      limited ||= got.limited
      let i = 0, j = 0
      for (const hit of got.ranges) {
        while (i + 1 < run.nodes.length && run.nodes[i + 1].offset <= hit.start) i++
        j = Math.max(i, j)
        while (j + 1 < run.nodes.length && run.nodes[j + 1].offset < hit.end) j++
        const a = run.nodes[i], b = run.nodes[j]
        const range = document.createRange()
        range.setStart(a.node, hit.start - a.offset)
        range.setEnd(b.node, hit.end - b.offset)
        hits.push({ id, part: current, ...hit, range })
      }
    }
  }
  return { hits, limited }
}

export function findRows(root: HTMLElement, chat: string) {
  // data-whole encompasses a bubble, file and its card; legacy quiet rows
  // have just data-msg. Avoid counting duplicate rendered parts of a message.
  return Array.from(root.querySelectorAll<HTMLElement>('[data-messages] [data-whole], [data-messages] [data-msg], [data-messages] [data-find-row]'))
    .filter(el => el.dataset.chat === chat && !el.closest('[data-find-ignore]') && el.closest('[data-drop]') === root && (el.hasAttribute('data-find-row') || !el.parentElement?.closest('[data-whole]')))
}

export function scrollToRange(range: Range, root: HTMLElement) {
  const start = range.startContainer.parentElement
  if (!start?.isConnected || !root.contains(start)) return false
  // Release the bottom pin before positioning. Scroll a nested source/code
  // viewport first, then the conversation, using this occurrence's rect, not
  // the (possibly much taller) message's center.
  start.dispatchEvent(new Event('chat-jump', { bubbles: true }))
  for (let el = start; el && el !== root; el = el.parentElement!) {
    const style = getComputedStyle(el)
    const sy = /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
    const sx = /auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1
    if (!sy && !sx) continue
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect(), box = el.getBoundingClientRect()
    if (sy && (rect.top < box.top + 12 || rect.bottom > box.bottom - 12)) el.scrollTop += rect.top + rect.height / 2 - box.top - el.clientHeight / 2
    if (sx && (rect.left < box.left + 8 || rect.right > box.right - 8)) el.scrollLeft += rect.left - box.left - el.clientWidth / 3
  }
  return true
}

// CSS Highlights don't modify the DOM or the selection/clipboard. A registry
// entry belongs to the current search owner; an unmounted companion may not
// clear a later owner's marks.
type Registry = Map<string, unknown>
const registry = () => (globalThis.CSS as typeof CSS & { highlights?: Registry } | undefined)?.highlights
let owner: object | null = null
export function paintFind(token: object, hits: FindHit[], active: FindHit | undefined) {
  const reg = registry()
  const H = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!reg || !H) return
  owner = token
  reg.set('find', new H(...hits.filter(h => h !== active && h.range.startContainer.isConnected).map(h => h.range)))
  if (active?.range.startContainer.isConnected) reg.set('find-active', new H(active.range))
  else reg.delete('find-active')
}
export function clearFind(token: object) {
  if (owner !== token) return
  registry()?.delete('find'); registry()?.delete('find-active'); owner = null
}
export { FIND_LIMITS }
