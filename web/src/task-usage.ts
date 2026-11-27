import { useEffect, useState } from 'react'
import type { Task, TaskUsage } from '@shared/types.ts'
import * as TK from '@core/tasks.js'

export const usageText = (task: Task, now = Date.now()) => task.status === 'work'
  ? (TK.usageLabel as (u: TaskUsage, now: number) => string)(task.usage ?? { state: 'unavailable', at: null, cpu_pct: null, rss_bytes: null }, now)
  : null

export const usageHelp = (task: Task) => TK.USAGE_HELP + (task.usage?.coverage === 'tree'
  ? ' This sample uses process trees only.' : '')

// One expiry timeout per visible list/header, not a timer per task or a new sampler.
// A disconnected browser still changes a frozen number to “Usage stale”.
export function useUsageExpiry(tasks: Task[]) {
  const [, update] = useState(0)
  const now = Date.now()
  const due = tasks.reduce((next, t) => {
    const at = t.usage?.at
    if (t.status !== 'work' || t.usage?.state !== 'current' || at == null) return next
    const end = at + TK.USAGE_MAX_AGE + 1
    return end > now ? Math.min(next, end) : next
  }, Infinity)
  useEffect(() => {
    if (!Number.isFinite(due)) return
    const timer = setTimeout(() => update((n) => n + 1), Math.max(0, due - Date.now()))
    return () => clearTimeout(timer)
  }, [due])
  return now
}
