// One task drill-in owns one terminal block. Repoint it through the header before showing
// another worker, and preserve the person's current view when merely focusing this task.
import { shared, setShared, run, layout } from 'herdr';
const identity = w => w?.terminal ?? (w?.key ? `${w.key.machine ?? ''}:${w.key.slug}#${w.key.id}` : null);
function body(node) {
  if (node?.id === 'tasks-thread-body') return node;
  for (const child of node?.children ?? []) { const hit = body(child); if (hit) return hit; }
  return null;
}
export function openWorkerView(want, { panel = true, mode = null } = {}) {
  const changed = identity(want) !== identity(shared('tasks.thread'));
  setShared('tasks.thread', { ...want, at: Date.now() });
  if (panel) run('layout.select', { stack: 'panel-body', child: 'tasks' });
  run('layout.select', { stack: 'tasks', child: 'tasks-thread' });
  if (body(layout()) && (changed || mode)) {
    // Never expose the previous worker while the async layout pointer catches up.
    run('layout.select', { stack: 'tasks-thread-body', child: 'tasks-thread-chat' });
    if (want.terminal && mode !== 'chat') setShared('tasks.thread.termreq', { terminal: want.terminal,
      at: Math.max(Date.now(), (shared('tasks.thread.termreq')?.at ?? 0) + 1) });
  }
  if (panel) run('layout.show', { id: 'panel' });
}
