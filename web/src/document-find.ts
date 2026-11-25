// Mark already-escaped syntax-highlighter HTML without changing its tokens.
// This also works in browsers without the CSS Custom Highlight API.
export type TextHit = { start: number; end: number; index: number }
export function markLine(html: string, start: number, hits: TextHit[], current: number) {
  if (!hits.length) return html
  const fragment = document.createElement('template')
  fragment.innerHTML = html
  const walk = document.createTreeWalker(fragment.content, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walk.nextNode(); node; node = walk.nextNode()) nodes.push(node as Text)
  let offset = start, first = 0
  for (const node of nodes) {
    const value = node.data, end = offset + value.length
    while (first < hits.length && hits[first].end <= offset) first++
    let last = first
    while (last < hits.length && hits[last].start < end) last++
    const selected = hits.slice(first,last)
    if (selected.length) {
      const replacement = document.createDocumentFragment()
      let cursor = 0
      for (const hit of selected) {
        const a = Math.max(0, hit.start - offset), b = Math.min(value.length, hit.end - offset)
        if (a > cursor) replacement.append(value.slice(cursor, a))
        const mark = document.createElement('mark')
        mark.className = 'document-match' + (hit.index === current ? ' document-match-current' : '')
        mark.dataset.findIndex = String(hit.index)
        mark.textContent = value.slice(a, b)
        replacement.append(mark)
        cursor = b
      }
      if (cursor < value.length) replacement.append(value.slice(cursor))
      node.replaceWith(replacement)
    }
    offset = end
  }
  return fragment.innerHTML
}
