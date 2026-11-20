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
  const order = [], n = rows.length;
  near = Number.isFinite(near) ? near : 0;
  let left = Math.max(-1, Math.min(n - 1, Math.floor(near))), right = Math.max(0, Math.min(n, Math.floor(near) + 1));
  // Walk outward in the same distance/index order as the old full-history sort.
  // Only eight fresh rows can be used; a cold history need visit only those eight.
  while ((left >= 0 || right < n) && order.length < 8) {
    const i = right >= n || left >= 0 && near - left <= right - near ? left-- : right++;
    if (!heights.has(keys[i])) order.push(i);
  }
  // Native Markdown settles over several frames. Once settled, pointer repaint must not
  // continuously recreate its hidden measuring views. Content/width/zoom changes get new keys.
  for (let i = 0; i < n && order.length < 8; i++) {
    if (heights.has(keys[i]) && now - (measuredAt.get(keys[i]) ?? 0) < 4000) order.push(i);
  }
  return order;
}

// External agents can send large context messages, bypassing the composer's
// paste-to-file limit. Bound each native Markdown layout without losing text.
export function messageChunks(value,limit=4000) {
  const text=String(value??''),out=[];
  for(let at=0;at<text.length;){
    let end=Math.min(text.length,at+limit);
    if(end<text.length){
      const newline=text.lastIndexOf('\n',end);
      if(newline>at+limit/2)end=newline+1;
      if(end>at&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
    }
    out.push(text.slice(at,end));at=end;
  }
  return out.length?out:[''];
}

// Rich text first reports its padding/one-line placeholder before native Markdown
// has laid out. Giving that height to the virtual row clips the real content and
// can prevent the final layout from ever completing. Keep the roomy estimate
// (and its measuring view mounted) until meaningful content has been measured.
export function pendingMarkdownHeight(row, height, width) {
  if (row.clip || !['agent', 'user', 'pending'].includes(row.kind) || height >= 42) return false;
  const visible = String(row.text ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*(?:\n|$)/gm, '')
    .replace(/!?\[([^\]\n]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_#>|~]/g, '').replace(/\s+/g, ' ').trim();
  // Three pixels per character is deliberately conservative. Strip invisible
  // markup/URLs first, so a short label with a long URL can still be one line.
  return visible.length * 3 > Math.max(120, width) * 2;
}
