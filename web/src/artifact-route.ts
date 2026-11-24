import type { Snapshot } from '@shared/types.ts'
import { artifactKey, findArtifact } from '@core/artifact-owner.js'

/** Resolve before navigating. A missing owner never borrows the screen's current place. */
export function artifactRoute(snap: Snapshot, id: string, machine?: string | null, origin?: string): { artifact?: string; place?: string; origin?: string; error?: string } {
  if (origin) {
    const source = snap.machines.find((m) => m.coreId === origin)
    if (!source) return { error: 'The artifact’s original machine is unavailable.' }
    machine = source.here ? null : source.machine
    id = id.split('/').pop()!
  }
  const a = findArtifact(snap.artifacts, id, machine)
  if (!a) return { error: 'This artifact is unavailable or its machine is ambiguous.' }
  if (!a.place || !snap.places.some((p) => p.id === a.place && p.id !== 'all' && p.id !== 'needs' && !p.id.startsWith('m:')))
    return { error: 'The artifact’s owning space is unavailable or was not recorded.' }
  const source = snap.machines?.find((m) => a.machine ? m.machine === a.machine : m.here)
  return { artifact: artifactKey(a), place: a.place, ...(source?.coreId ? { origin: source.coreId } : {}) }
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

/** A remembered sidebar selection is visible only inside its actual owner. */
export function artifactInPlace(snap: Snapshot | null, id: string | undefined, place: string) {
  const art = id ? findArtifact(snap?.artifacts, id) : null
  return art?.place === place && snap?.places.some((p) => p.id === place) ? art : null
}
