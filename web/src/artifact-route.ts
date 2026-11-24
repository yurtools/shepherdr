import type { Snapshot } from '@shared/types.ts'
import { artifactKey, findArtifact } from '@core/artifact-owner.js'

/** Resolve before navigating. A missing owner never borrows the screen's current place. */
export function artifactRoute(snap: Snapshot, id: string, machine?: string | null) {
  const a = findArtifact(snap.artifacts, id, machine)
  if (!a) return { error: 'This artifact is unavailable or its machine is ambiguous.' }
  if (!a.place || !snap.places.some((p) => p.id === a.place && p.id !== 'all' && p.id !== 'needs' && !p.id.startsWith('m:')))
    return { error: 'The artifact’s owning space is unavailable or was not recorded.' }
  return { artifact: artifactKey(a), place: a.place }
}

/** Machine identity from the message's own chat, never the selected space. */
export function artifactChatMachine(snap: Snapshot, key: string): string | null | undefined {
  if (key.startsWith('t:')) return key.slice(2).includes('/') ? key.slice(2).split('/')[0] : null
  const task = snap.tasks.find((t) => key === t.agent?.chat || key.startsWith(`${t.id}/`))
  if (task) return task.reviewMachine ?? (task.on === snap.host ? null : task.on)
  const place = snap.places.find((p) => p.chat === key)
  if (place) return place.reviewScope?.machine ?? (place.machine === snap.host ? null : place.machine)
  return undefined
}
