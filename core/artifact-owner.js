// Artifact ownership is a durable space ID, never a selected pane, title or folder match.
// Old task artifacts can recover it from the task's exact list/ref or proof ID.
export const artifactKey = (a) => a.machine ? `${a.machine}/${a.id}` : `/${a.id}`;
export const spaceKey = (space, machine = null) => !space ? null : machine && !space.startsWith(`${machine}/`) ? `${machine}/${space}` : space;

export function artifactOwner(a, tasks = []) {
  if (!a?.id) return null;
  const machine = a.machine ?? null;
  const candidates = tasks.filter((t) => (t.machine ?? null) === machine && (
    (t.proof?.id ?? t.proof) === a.id ||
    (a.taskKey ? (t.key === a.taskKey || `${t.slug}#${t.id}` === a.taskKey) : a.task && t.folder === a.folder && String(t.ref).toUpperCase() === String(a.task).toUpperCase())
  ));
  const owners = new Set(candidates.map((t) => spaceKey(t.space, machine)));
  if (owners.size > 1) return null;
  // A recorded task without an owner must not fall back to a similarly named space.
  if (candidates.length) return [...owners][0];
  return spaceKey(a.space, machine);
}

// A qualified ID is portable through history, async replies and split panes. Old bare links
// work only when unambiguous; an explicit local request uses machine=null.
/** @template T
 * @param {T[] | undefined} arts
 * @param {string} id
 * @param {string | null | undefined} [machine]
 * @returns {T | null}
 */
export function findArtifact(arts = [], id, machine = undefined) {
  if (!id) return null;
  const matches = arts.filter((a) => machine !== undefined
    ? a.id === id && (a.machine ?? null) === machine
    : id.includes('/') ? artifactKey(a) === id : a.id === id);
  return matches.length === 1 ? matches[0] : null;
}
