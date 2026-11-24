import { expect, test } from 'bun:test';
import { artifactOwner, artifactKey, findArtifact } from './artifact-owner.js';
const art = { id: 'proof-1234', task: 'SHOP-4', folder: '/repo', machine: null };
const task = { ref: 'SHOP-4', key: 'repo#4', folder: '/repo', space: 'A', machine: null };

test('old proof resolves its recorded task owner, never an equal folder or title', () => {
  expect(artifactOwner(art, [task])).toBe('A');
  expect(artifactOwner({ ...art, task: null }, [{ ...task, proof: art.id }])).toBe('A');
  expect(artifactOwner({ ...art, task: null }, [task])).toBeNull();
  expect(artifactOwner(art, [{ ...task, folder: '/other', space: 'B' }])).toBeNull();
  expect(artifactOwner({ ...art, space: 'deleted' }, [])).toBe('deleted');
});
test('task list key survives worktree folders; conflicting owners are refused', () => {
  expect(artifactOwner({ ...art, taskKey: 'repo#4', folder: '/worktree' }, [task])).toBe('A');
  expect(artifactOwner(art, [task, { ...task, space: 'B' }])).toBeNull();
  expect(artifactOwner({ ...art, space: 'B' }, [{ ...task, space: null }])).toBeNull();
});
test('machine is part of both artifact and owner identity', () => {
  const remote = { ...art, machine: 'vm' };
  expect(artifactOwner(remote, [task, { ...task, machine: 'vm', space: 'A' }])).toBe('vm/A');
  expect(artifactOwner(remote, [task])).toBeNull();
  expect(findArtifact([art, remote], art.id)).toBeNull();
  expect(findArtifact([art, remote], art.id, null)).toBe(art);
  expect(findArtifact([art, remote], artifactKey(remote))).toBe(remote);
  expect(findArtifact([art, remote], artifactKey(art))).toBe(art);
});
