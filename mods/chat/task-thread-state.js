import { shared, setShared, spaces } from 'herdr';
import { taskOwner, taskIdentity } from './core/task-owner.js';

export const VIEWS = 'tasks.thread.bySpace';
export const spaceKey = s => s ? JSON.stringify([s.machine ?? null, s.id]) : null;
const activeSpace = () => spaces().find(s => s.active);
export const stored = s => shared(VIEWS)?.[spaceKey(s)] ?? null;
export const threadIdentity = w => w ? JSON.stringify([w.space, taskIdentity(w.key), w.terminal, w.historical ?? false, w.historical ? w.log?.path : null]) : null;
// Old global requests lacked an owner. They must not reappear under the wrong space.
export const activeTaskThread = () => { const w = stored(activeSpace()); return w?.open === false ? null : w; };
export function updateTaskThread(expected, patch) {
  const s = taskOwner(spaces(), expected?.key?.machine, expected?.space);
  const prev = s && stored(s);
  if (!prev || threadIdentity(expected) !== threadIdentity(prev)) return false;
  const next = { ...prev, ...patch };
  setShared(VIEWS, { ...shared(VIEWS), [spaceKey(s)]: next });
  if (s.active) setShared('tasks.thread', next); // last opened view, for older integrations
  return true;
}
