// Geometry used by the native timeline. Hover is paint state, never a content revision.
export function measuredHeight(previous, raw) {
  if (!Number.isFinite(raw) || raw <= 0) return previous;
  const next = Math.round(raw * 2) / 2;
  return previous !== undefined && Math.abs(previous - next) <= 0.5 ? previous : next;
}
export function viewportScroll(top, delta, total, viewport) {
  const max = Math.max(0, total - viewport);
  const offset = Math.min(max, Math.max(0, (top || 0) - delta));
  return { offset, bottom: max - offset <= 3 };
}
export function hoverMessage(y, top, rows, sizes) {
  let at = top + y;
  for (let i = 0; i < rows.length; i++) {
    if (at < sizes[i]) return rows[i].bar?.of ?? rows[i].blk ?? rows[i].of ?? rows[i].id;
    at -= sizes[i];
  }
  return null;
}
export function measureOrder(rows, keys, heights, measuredAt, near, now) {
  const fresh = rows.map((_, i) => i).filter(i => !heights.has(keys[i]))
    .sort((a, b) => Math.abs(a - near) - Math.abs(b - near)).slice(0, 30);
  // Native Markdown settles over several frames. Once settled, pointer repaint must not
  // continuously recreate its hidden measuring views. Content/width/zoom changes get new keys.
  const settling = rows.map((_, i) => i).filter(i => heights.has(keys[i]) && now - (measuredAt.get(keys[i]) ?? 0) < 4000);
  return [...new Set([...fresh, ...settling])].slice(0, 60);
}
