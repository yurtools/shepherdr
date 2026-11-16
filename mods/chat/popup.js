// Popup coordinates must come from the pressed control, never Herdr's remembered context-menu pointer.
// Mouse positions/bounds are window-relative and already include the UI zoom.
export function popupBounds(e) {
  const b = e?.bounds;
  if (b && [b.x, b.y, b.width, b.height].every(Number.isFinite)) return { ...b };
  const p = e?.position, l = e?.local_position;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { x: p.x - (l?.x ?? 0), y: p.y - (l?.y ?? 0), width: b?.width ?? 0, height: b?.height ?? 28 } : null;
}
export function popupAt(b, width, height, above = false) {
  if (!b) return undefined; // keyboard-only opening; the native host chooses its fallback
  const top = b.y - height - 6;
  return { x: Math.max(8, b.x + b.width - width), y: above && top >= 8 ? top : b.y + b.height + 6 };
}
