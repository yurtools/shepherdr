// Shared status vocabulary and filter selection for the native and web Tasks panels.
export const STATUS = { needs: "Needs you", working: "Working", merging: "Merging", ready: "Ready · active", deferred: "Deferred", queued: "Queued", scheduled: "Scheduled", todo: "To do", done: "Done" };
// Automations are a list category, not a task status. They only join a filtered list when explicitly selected.
export const ORDER = ["needs", "ready", "deferred", "merging", "working", "queued", "scheduled", "todo", "done", "automations"];
export const filterLabel = (key) => key === "automations" ? "Automations" : STATUS[key];

// The web's snapshot uses shorter names for two statuses. Keep the selection in canonical native keys.
export const filterKey = (key) => key === "need" ? "needs" : key === "work" ? "working" : key;

/** Empty means All statuses. Accept legacy scalars, discard unknown keys and duplicates, and keep canonical order.
 * @param {unknown} value @returns {string[]} */
export function normalizeFilters(value) {
  const keys = (Array.isArray(value) ? value : [value]).map(filterKey);
  return ORDER.filter((key) => keys.includes(key));
}

/** @param {string} key @param {Pick<Storage, 'getItem'>} [storage] */
export function loadFilters(key, storage) {
  try {
    const saved = (storage ?? globalThis.localStorage).getItem(key);
    try { return normalizeFilters(JSON.parse(saved ?? "null")); }
    catch { return normalizeFilters(saved); } // native's old plain-string filter
  } catch { return []; }
}

/** @param {string} key @param {string[]} selected @param {Pick<Storage, 'setItem'>} [storage] */
export function saveFilters(key, selected, storage) {
  try { (storage ?? globalThis.localStorage).setItem(key, JSON.stringify(normalizeFilters(selected))); } catch {}
}

/** @param {string[]} selected @param {string} key */
export function toggleFilter(selected, key) {
  if (key === "all") return [];
  if (!ORDER.includes(key)) return selected;
  return normalizeFilters(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
}

/** The selection is independent of counts, scope, search, width and status transitions.
 * @param {string[]} selected @param {(key: string) => number} count */
export function filterChoices(selected, count) {
  return ORDER.map((key) => ({ key, label: filterLabel(key), count: count(key), on: selected.includes(key) }))
    .filter((item) => item.on || item.count > 0);
}

/** Lay out the most useful chips first, leaving space for More whenever any choice is hidden.
 * Widths come from the calling UI's typography. Secondary choices always live in More.
 * @template {{key: string, on: boolean}} T
 * @param {T[]} choices @param {number} room @param {(item: T) => number} widthOf @param {number} moreWidth */
export function splitFilterChoices(choices, room, widthOf, moreWidth) {
  const primary = ["needs", "working", "ready"].flatMap((key) => choices.filter((item) => item.key === key));
  const shown = [];
  for (const item of primary) {
    const reserve = shown.length + 1 < choices.length ? moreWidth : 0;
    const width = widthOf(item);
    if (width + reserve > room) break;
    shown.push(item);
    room -= width;
  }
  const hidden = choices.filter((item) => !shown.includes(item));
  return { shown, hidden, hiddenSelected: hidden.filter((item) => item.on).length };
}
