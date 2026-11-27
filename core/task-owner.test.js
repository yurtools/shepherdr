import { expect, test } from 'bun:test';
import { taskOwner, liveTaskTerminal } from './task-owner.js';
import { inSpace } from './tasks.js';
const local = { id: 'a', folder: '/p', machine: null };
const remote = { id: 'vm/a', folder: '/p', machine: 'vm' };
const other = { id: 'b', folder: '/p/nested', machine: null };
test('recorded space outranks the nested repository, worktree and a same-id remote space', () => {
  const spaces = [other, local, remote];
  expect(taskOwner(spaces, null, 'a')).toBe(local);
  expect(taskOwner(spaces, 'vm', 'a')).toBe(remote);
  expect(taskOwner(spaces, 'vm', 'vm/a')).toBe(remote);
  expect(taskOwner(spaces, null, 'vm/a')).toBeNull();
  expect(taskOwner(spaces, null, 'missing')).toBeNull();
  expect(taskOwner(spaces, null, null)).toBeNull();
  expect(inSpace(other, { machine: null, folder: '/p/nested', space: 'a' })).toBe(false);
});
test('a worker must match task, machine, space and Feature; retained shells are not live agents', () => {
  const key = { machine: null, slug: 'nested', id: 5 };
  const task = { space: 'a', feature: 'f' };
  const worker = { address: 't1', state: 'live', foreground: { name: 'codex' }, labels: { 'herdr.task': 'nested#5', 'herdr.task.space': 'a', 'herdr.feature': 'f' } };
  expect(liveTaskTerminal(worker, key, task)).toBe(true);
  expect(liveTaskTerminal({ ...worker, address: 'vm/t1' }, key, task)).toBe(false);
  expect(liveTaskTerminal({ ...worker, labels: {...worker.labels, 'herdr.feature': 'other'} }, key, task)).toBe(false);
  expect(liveTaskTerminal({ ...worker, foreground: { name: 'bash', argv: ['bash','-i'] } }, key, task)).toBe(false);
});
