// Attention is independent of the workflow state: a deferred task is still Ready.
export const deferred = (t) => t?.state === 'ready' && t.deferred_ready_at != null && t.deferred_ready_at === (t.ready_at ?? 0);
const machine = (x) => x?.machine ?? null;
const bare = (s) => String(s ?? '').split('/').pop();
// A saved space identity wins over folder fallback; two spaces may share one repository.
export function inReviewScope(scope, t) {
  if (!scope || machine(scope) !== machine(t)) return false;
  const sameSpace = t.space ? bare(t.space) === bare(scope.space) : !!scope.folder && t.folder === scope.folder;
  if (!sameSpace) return false;
  return scope.kind === 'feature' ? !!scope.feature && t.feature === scope.feature : scope.kind === 'space';
}
export const reviewKey = (t) => JSON.stringify([machine(t), t.folder, t.ref]);
export const reviewLabel = (items) => {
  const merges = items.filter(x => x.evidence?.merges).length, completes = items.length - merges;
  return merges && completes ? `Merge ${merges} and complete ${completes}` : merges ? `Merge ${merges} ${merges === 1 ? 'task' : 'tasks'}` : `Complete ${completes} ${completes === 1 ? 'task' : 'tasks'}`;
};
// Freeze exactly the inspected identities and evidence, then check/accept each through the protected command.
// Results stay visible and a refusal never prevents the remaining selected items being inspected.
/** @param {any[]} selected @param {(item: any, preceding: string[]) => Promise<any>} accept @param {(results: any[]) => void} report */
export async function reviewBatch(selected, accept, report = (_results) => {}) {
  const results = [];
  for (const item of selected.map(x => ({ ...x, evidence: { ...x.evidence } }))) {
    let result;
    try {
      if (!item.evidence?.decision_token) throw new Error('Refresh and review this task first.');
      const out = await accept(item, results.filter(r => r.state === "success").map(r => r.out?.accept_receipt?.token).filter(Boolean));
      result = { key: reviewKey(item), ref: item.ref, state: out.state === 'done' ? 'success' : 'waiting', text: out.state === 'done' ? 'Completed' : 'Accepted; waiting for merge', out };
    } catch (e) { result = { key: reviewKey(item), ref: item.ref, state: 'refused', text: String(e?.message ?? e) }; }
    results.push(result); report([...results]);
  }
  return results;
}

// Both clients offer the same checked selections; deferred rows are never selected by Select all.
export const reviewEligible = (x) => ['ready', 'deferred'].includes(x.status) && !x.error && !!x.evidence?.decision_token && !x.evidence.decision_error && !['failed', 'unknown'].includes(x.evidence?.checks?.state);
export const activeReviewSelection = (items) => new Set(items.filter(x => !x.deferred && reviewEligible(x)).map(reviewKey));
