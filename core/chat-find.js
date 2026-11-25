// Chat Find works on literal, non-overlapping occurrences, not regular
// expressions supplied by the person. RegExp's Unicode case folding retains
// the UTF-16 offsets of the original string (unlike lowercasing the haystack).
// These limits bound the work/retained ranges of a single search, independently
// of how many records the reader has loaded. Callers label incomplete results.
export const FIND_LIMITS = Object.freeze({ chars: 256 * 1024, queryChars: 4096, matches: 20000, pageRecords: 10000 });
export const FIND_BLOCK = /^(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul)$/i;
export const findQuery = value => String(value ?? '').trim();
/** @param {number} [limit] */
export function literalRanges(value, query, limit = FIND_LIMITS.matches) {
  const text = String(value ?? ''), q = findQuery(query);
  const ranges = [];
  if (!q) return { ranges, limited: false };
  if(q.length>FIND_LIMITS.queryChars)return {ranges,limited:true};
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  // Don't cut a surrogate pair in half at the scan boundary.
  const end = Math.min(text.length, FIND_LIMITS.chars);
  const scanned = text.slice(0, end).replace(/[\uD800-\uDBFF]$/, m => end < text.length ? '' : m);
  let match;
  while ((match = re.exec(scanned))) {
    if (ranges.length >= limit) return { ranges, limited: true };
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return { ranges, limited: end < text.length };
}
export const containsFind = (text, q) => literalRanges(text, q, 1).ranges.length > 0;

// The selected occurrence is an ID plus a position, not an index into the
// current page. Prepending pages/streaming other rows must not change it.
export function findPosition(hits, selected) {
  if (!hits.length) return -1;
  if (selected) {
    const at = hits.findIndex(h => h.id === selected.id && h.part === selected.part && h.start === selected.start);
    if (at >= 0) return at;
  }
  return 0;
}
export function findStep(pos, total, direction) {
  return total ? (Math.max(0, pos) + direction + total) % total : -1;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
// Break text into render spans. Only the intersecting part of a match belongs
// to a text node: e.g. "hel**lo**" spans two nodes, with the same match identity.
export function findSpans(text, ranges, offset = 0) {
  const out = []; let at = 0;
  // Ordered non-overlapping ranges: skip earlier matches when painting a
  // line or inline token deep in a long code/Markdown row.
  let lo=0, hi=ranges.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(ranges[mid].end<=offset)lo=mid+1;else hi=mid;}
  for (let i=lo;i<ranges.length;i++) {
    const r=ranges[i];
    if(r.start>=offset+text.length)break;
    const start = Math.max(0, r.start - offset), end = Math.min(text.length, r.end - offset);
    if (end <= at || start >= text.length) continue;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: text.slice(Math.max(at, start), end), match: r }); at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

// An exact location readout, bounded even for a multi-megabyte single line.
// The match itself is never replaced with ellipses unless the query is huge.
export function findContext(text, match, room = 60) {
  let start = Math.max(0, match.start - room), end = Math.min(text.length, match.end + room);
  if(start && /[\uDC00-\uDFFF]/.test(text[start]))start--;
  if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]))end++;
  return { before: (start ? '…' : '') + text.slice(start, match.start),
    match: text.slice(match.start, match.end), after: text.slice(match.end, end) + (end < text.length ? '…' : '') };
}

// A preview label can contain a visual line break (Mermaid <br>) that is
// not a literal space in the source. Only use labels when source has no hit;
// never count the same diagram word in both views.
export function diagramLabelTexts(drawing) {
  return [...(drawing?.nodes??[]),...(drawing?.edges??[])]
    .map(item=>String(item.label??item.lines?.join(' ')??'').replace(/\r?\n/g,' ')).filter(Boolean);
}
