import { expect, test } from 'bun:test'
import { artifactRoute } from './artifact-route.ts'
import { decide, screenOfUrl, stepsTo, urlOf } from './nav.ts'
import type { Snapshot } from '@shared/types.ts'
const a = { id: 'proof-1234', place: 'A', machine: undefined }
const snap = { places: [{ id: 'A', cwd: '/a' }, { id: 'B', cwd: '/b' }, { id: 'vm/A', cwd: '/a' }], artifacts: [a] } as unknown as Snapshot

test('proof from A resolves A while B is selected; a missing owner never falls back', () => {
  expect(artifactRoute(snap, a.id)).toEqual({ artifact: '/proof-1234', place: 'A' })
  expect(artifactRoute({ ...snap, places: snap.places.filter((p) => p.id !== 'A') }, a.id).error).toContain('owning space')
  expect(artifactRoute({ ...snap, artifacts: [{ ...a, place: '' } as any] }, a.id).error).toContain('owning space')
})
test('identical remote and local IDs retain the requested machine', () => {
  const s = { ...snap, artifacts: [a, { ...a, machine: 'vm', place: 'vm/A' }] } as Snapshot
  expect(artifactRoute(s, a.id).error).toContain('ambiguous')
  expect(artifactRoute(s, a.id, 'vm')).toEqual({ artifact: 'vm/proof-1234', place: 'vm/A' })
  expect(artifactRoute(s, a.id, null)).toEqual({ artifact: '/proof-1234', place: 'A' })
})
test('artifact history retains machine and explicit version; close/back have coherent places', () => {
  const b = screenOfUrl('?place=B', false, () => 'chat') as any
  const opened = { ...b, place: 'vm/A', viewer: { artifact: 'vm/proof-1234', v: 2 } }
  const url = urlOf(opened, true, '/')
  expect(screenOfUrl(url.slice(url.indexOf('?')), false, () => 'chat').viewer).toEqual(opened.viewer)
  expect(stepsTo(opened).map((s) => [s.place, s.viewer?.artifact])).toEqual([['vm/A', undefined], ['vm/A', 'vm/proof-1234']])
  expect(decide({ shep: 1, key: '', prev: null, screen: b }, opened)).toBe('push')
  expect(decide({ shep: 1, key: '', prev: null, screen: opened }, { ...opened, viewer: null })).toBe('replace')
})
