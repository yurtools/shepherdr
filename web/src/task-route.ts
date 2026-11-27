import type { Snapshot } from '@shared/types.ts'

// Exact task IDs already encode machine/folder when visible refs collide.
// Neither a URL's place nor the current pane is ownership evidence.
export function taskRoute(snap: Snapshot, id: string): { place: string; error?: never } | { place?: never; error: string } {
  const task = snap.tasks.find(t => t.id === id)
  if (!task) return { error: 'The exact task is unavailable. Open it from its task list.' }
  const owner = snap.places.find(p => p.id === task.place)
  if (!task.place || !owner || (task.reviewMachine !== undefined && owner.machine !== (task.reviewMachine ?? snap.host)) ||
      (task.reviewSpace && task.reviewSpace !== task.place)) {
    return { error: `${task.ref ?? id}’s recorded owning space is unavailable or was not recorded.` }
  }
  return { place: task.place }
}
