import { expect, test } from 'bun:test'
import { artifactRoute, artifactInPlace } from './artifact-route.ts'
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

test('a CLI link identifies its original core even when machine aliases or serving host change', () => {
  const s = { ...snap, machines: [{ machine: 'renamed-vm', coreId: 'core-remote' }],
    artifacts: [a, { ...a, machine: 'renamed-vm', place: 'vm/A' }] } as Snapshot
  expect(artifactRoute(s, 'old-name/proof-1234', undefined, 'core-remote')).toEqual({ artifact: 'renamed-vm/proof-1234', place: 'vm/A', origin: 'core-remote' })
  expect(artifactRoute(s, a.id, undefined, 'deleted-core').error).toContain('original machine')
  expect(artifactRoute({ ...s, machines: [{ coreId: 'core-local', here: true }] as any }, a.id, undefined, 'core-local').artifact).toBe('/proof-1234')
});

test('a cached sidebar proof cannot follow a later selection of B or a deleted owner', () => {
 expect(artifactInPlace(snap, '/proof-1234', 'A')).toBe(a as any)
 expect(artifactInPlace(snap, '/proof-1234', 'B')).toBeNull()
 expect(artifactInPlace(snap, undefined, 'A')).toBeNull()
 expect(artifactInPlace({ ...snap, places: [] }, '/proof-1234', 'A')).toBeNull()
});
