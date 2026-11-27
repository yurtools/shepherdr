// Literal, case-insensitive, non-overlapping matches. Offsets are UTF-16,
// never offsets into a lowercased copy (which can change string length).
export const FIND = Object.freeze({ queryChars: 256, hits: 5000, batchBytes: 4 * 1024 * 1024, batchRows: 65536, timeMs: 60000 });

export function findPattern(query) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

export function findRanges(text, query, limit = FIND.hits) {
  if (!query) return { hits: [], limited: false };
  const hits = [];
  for (const match of text.matchAll(findPattern(query))) {
    if (hits.length >= limit) return { hits, limited: true };
    hits.push({ start: match.index, end: match.index + match[0].length });
  }
  return { hits, limited: false };
}

// Splits a match across visual rows/tokens without changing the source.
export function markedParts(text, hits, current, offset = 0) {
  const parts = [];
  let at = 0;
  for (const hit of hits) {
    const start = Math.max(0, hit.start - offset), end = Math.min(text.length, hit.end - offset);
    if (start >= end || end <= at) continue;
    if (start > at) parts.push({ text: text.slice(at, start), tone: 0 });
    parts.push({ text: text.slice(Math.max(at, start), end), tone: current && (hit === current || hit.index !== undefined && hit.index === current.index) ? 2 : 1 });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), tone: 0 });
  return parts;
}

// Convert on-disk UTF-8 offsets to the exact UTF-16 offsets in this page.
// Matches spanning a page boundary mark both pages, not the adjacent character.
export function pageRanges(page, hits) {
  const relevant = hits.filter(h => h.start < page.end && h.end > page.start);
  if (!relevant.length) return [];
  const bounds = new Map([[page.start, 0]]);
  let byte = page.start, unit = 0;
  for (const ch of page.text) {
    const code = ch.codePointAt(0);
    byte += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    unit += ch.length; bounds.set(byte, unit);
  }
  return relevant.map(h => ({ ...h, start: bounds.get(Math.max(h.start, page.start)), end: bounds.get(Math.min(h.end, page.end)) }))
    .filter(h => h.start !== undefined && h.end !== undefined);
}

export function cellExcerpt(value, start, end, limit = 160) {
  if (start < 12 && end <= limit && value.length <= limit) return {};
  let left = Math.max(0, start - 2), right = Math.min(value.length,left+limit);
  if (/[\uDC00-\uDFFF]/.test(value[left] ?? '')) left--;
  if (right<value.length && /[\uD800-\uDBFF]/.test(value[right-1])) right--;
  return { excerpt: (left ? '…' : '') + value.slice(left, right) + (right < value.length ? '…' : ''),
    excerptOffset: start - left + (left ? 1 : 0) };
}

export function findCount(state) {
  if (!state.query) return '';
  if (state.error) return state.error;
  if (state.busy) return 'Searching…';
  if (state.noText) return 'No searchable text';
  const n = state.hits.length;
  return n ? `${state.index + 1} of ${n}${state.limited ? '+' : ''}` : state.limited ? 'No matches in searched content' : 'No matches';
}
