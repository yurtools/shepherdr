import { expect, test } from 'bun:test'
import { taskRoute } from './task-route'
import type { Snapshot } from '@shared/types.ts'

const local = { id: 'sp-owner', machine: 'here', cwd: '/root/project' }
const other = { id: 'sp-other', machine: 'here', cwd: '/root/project/ui' }
const remote = { id: 'vm/sp-owner', machine: 'vm', cwd: '/root/project' }
const task = { id: '%2Froot%2Fproject%2Fui:APP-5', ref: 'APP-5', taskFolder: '/root/project/ui', place: local.id, reviewSpace: local.id, feature: 'feature-a' }
const twin = { ...task, id: '%2Fother%2Fui:APP-5', taskFolder: '/other/ui', place: other.id, reviewSpace: other.id, feature: 'feature-b' }
const away = { ...task, id: 'vm:APP-5', place: remote.id, reviewSpace: remote.id }

const snap = { places: [other, local, remote], tasks: [task, twin, away] } as unknown as Snapshot
test('a task route is independent of focus and the exact-folder space, including colliding refs and remote IDs', () => {
  expect(taskRoute(snap, task.id)).toEqual({ place: local.id })
  expect(taskRoute(snap, twin.id)).toEqual({ place: other.id })
  expect(taskRoute(snap, away.id)).toEqual({ place: remote.id })
  expect(taskRoute(snap, 'APP-5').error).toContain('exact task')
})
test('a deleted recorded space does not fall back to the space with the matching folder', () => {
  expect(taskRoute({ ...snap, places: snap.places.filter(p => p.id !== local.id) }, task.id).error).toContain('owning space')
  expect(taskRoute({ ...snap, tasks: [{ ...task, place: other.id }] as any }, task.id).error).toContain('owning space')
})
