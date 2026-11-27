import { expect, test } from 'bun:test'
import { Compat } from './compat'
const nested = '/fixture/project/ui'
const a = { id: 'owner', machine: null, folder: '/fixture/project', name: 'Owner', tabs: [] }
const b = { id: 'other', machine: null, folder: nested, name: 'Other', tabs: [] }
const remote = { ...a, id: 'vm/owner', machine: 'vm' }
const row = { id: 5, slug: 'nested', ref: 'APP-5', machine: null, folder: nested, worktree: '/fixture/worktrees/feature', space: a.id, feature: 'feature-a',
  title: 'Integration', list: 'UI', section: 'working', worker: 't1' }
const twin = { ...row, folder: '/fixture/other/ui', slug: 'twin', worker: 't2', space: b.id, feature: 'feature-b' }
const away = { ...row, machine: 'vm', space: 'vm/owner', worker: 'vm/t1' }
test('web snapshot preserves machine, canonical folder, Feature, and exact owner; no folder fallback for a lost owner', () => {
  const c = new Compat()
  const data = { host: 'local', user: 'Person', machines: [], sections: [], rows: [row, twin, away] }
  const snap = c.snapshot({ ...data, spaces: [b, a, remote] })
  expect(snap.tasks.map(t => [t.place, t.listName, t.feature, t.agent?.chat])).toEqual([
    [a.id, a.name, row.feature, encodeURIComponent(nested) + ':APP-5/worker'],
    [b.id, b.name, twin.feature, encodeURIComponent(twin.folder) + ':APP-5/worker'],
    [remote.id, remote.name, away.feature, 'vm:APP-5/worker'],
  ])
  expect(snap.tasks.map(t => c.taskOf(t.id)?.folder)).toEqual([nested, twin.folder, nested])
  expect(c.snapshot({ ...data, spaces: [b, remote] }).tasks[0].place).toBe('')
})
