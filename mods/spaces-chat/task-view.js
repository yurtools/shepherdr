// One task drill-in owns one terminal block. Resolve the task from the source
// list before selecting its recorded space; never let the current tab decide.
import { shared, setShared, run, layout, spaces, terminals, exec, hc, home, readTextFile, notify } from 'herdr';
import { dirs } from './dirs.js';
import { READ_LISTS, taskLists, isTaskList } from './core/tasklists.js';
import { SH } from './core/paths.js';
import { taskOwner, liveTaskTerminal, addressMachine, qualifyAddress, autoPrefix } from './core/task-owner.js';

import { VIEWS, spaceKey, stored, threadIdentity, activeTaskThread, updateTaskThread } from './task-thread-state.js';

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
}
const refOf = (list, task) => `${list.prefix || autoPrefix(list.folder)}-${task.id}`;
const validSlug = slug => typeof slug === 'string' && slug.length > 0 && !slug.includes('/') && !slug.includes('\\') && slug !== '.' && slug !== '..';

async function readList(machine, slug) {
  if (!validSlug(slug)) throw new Error('The task list key is invalid.');
  const text = machine
    ? (await exec('sh', ['-c', SH + 'cat "$SHEP_TASKS/$1.json"', 'sh', slug], { on: machine })).stdout
    : await readTextFile(`${dirs().tasks}/${slug}.json`);
  let list;
  try { list = JSON.parse(text || 'null'); } catch { throw new Error("The task list could not be read."); }
  if (!isTaskList(list)) throw new Error('The task list is unavailable.');
  return { ...list, slug };
}

// An explicit list key wins over a terminal's labels. Ref-only news or links
// must supply the original folder; an address-only click uses its exact label.
export async function resolveTaskView(want) {
  const candidate = want.terminal && terminals().find(t => t.address === want.terminal);
  const label = candidate?.labels?.['herdr.task'];
  const [slug, id] = String(label ?? '').split('#');
  const explicit = want.key ?? null;
  const machine = explicit ? explicit.machine ?? null : want.machine !== undefined ? want.machine ?? null : addressMachine(want.terminal);
  let list, task;
  const refMatches = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  if (explicit?.slug || (!want.folder && slug && id)) {
    const k = explicit?.slug ? explicit : { slug, id: Number(id) };
    list = await readList(machine, k.slug);
    if (explicit?.folder && explicit.folder !== list.folder) throw new Error('The task list no longer matches the requested folder.');
    task = list.tasks.find(t => Number(t.id) === Number(k.id));
  } else if (want.folder && want.task) {
    const r = await exec('sh', ['-c', READ_LISTS], machine ? { on: machine } : {});
    if (r.code !== 0) throw new Error('The task lists on the requested machine are unavailable.');
    let folder = want.folder;
    if (folder === "~" || folder.startsWith("~/")) {
      const root = machine ? (await exec('sh', ['-c', 'printf "%s" "$HOME"'], { on: machine })).stdout : home();
      if (!root) throw new Error('The requested folder could not be resolved on that machine.');
      folder = root + folder.slice(1);
    }
    const matches = taskLists(r.stdout).flatMap(l => l.folder === folder ? l.tasks.filter(t => refMatches(refOf(l, t), want.task)).map(t => [l, t]) : []);
    if (matches.length === 1) [list, task] = matches[0];
  }
  if (!task || (want.task && !refMatches(want.task, refOf(list, task)) && want.task !== String(task.id))) throw new Error('The exact task was not found. Open it from its task list.');
  const key = { machine, folder: list.folder, slug: list.slug, id: Number(task.id) };
  const space = taskOwner(spaces(), machine, task.space);
  if (!task.space) throw new Error(`${refOf(list, task)} has no recorded owning space.`);
  if (!space) throw new Error(`${refOf(list, task)}'s recorded owning space is unavailable on its machine.`);
  if (want.space && !taskOwner([space], machine, want.space)) throw new Error('The task no longer belongs to the requested space.');
  if (want.feature !== undefined && (want.feature ?? null) !== (task.feature ?? null)) throw new Error('The task no longer belongs to the requested Feature.');
  const candidates = ["running", "ready"].includes(task.state) ? terminals().filter(t => liveTaskTerminal(t, key, task)) : [];
  // Native summaries can retain "live"/Codex after the process went back to
  // its shell. Check the actual core record before making it an interactive view.
  const checked = await Promise.all(candidates.map(async t => {
    try {
      const r = await hc(["get", t.address, "--json"]);
      const actual = JSON.parse(r.stdout || "null");
      return r.code === 0 && liveTaskTerminal({ ...actual, address: t.address }, key, task) ? { ...t, ...actual, address: t.address } : null;
    } catch { return null; }
  }));
  const valid = checked.filter(Boolean);
  const ownAgents = valid.filter(t => !(['reviewer', 'helper'].includes(t.labels?.['herdr.role']) && t.parent));

  const preferred = valid.find(t => t.address === want.terminal);
  const workers = ownAgents.filter(t => !['reviewer', 'helper'].includes(t.labels?.['herdr.role']));
  const selected = preferred ?? workers.find(t => (t.status?.state ?? t.status) === 'blocked') ?? workers[0] ?? ownAgents[0];
  // A click on a particular agent is not a request for some other agent.
  const last = task.agents?.at(-1);
  if (want.terminal && (want.exactWorker || (!explicit && !want.folder)) && !preferred &&
      (selected || qualifyAddress(machine, last?.address) !== want.terminal)) throw new Error('That worker is no longer the live agent for this task.');
  const historical = !selected && !!last?.address;
  const saved = selected ? [...(task.agents ?? [])].reverse().find(a => qualifyAddress(machine, a.address) === selected.address) : last;
  return { terminal: selected?.address ?? qualifyAddress(machine, last?.address) ?? null,
    task: refOf(list, task), title: task.title, key, space: space.id, feature: task.feature ?? null,
    historical, log: saved?.log ? { path: saved.log, kind: saved.agent ?? null } : null,
    session: saved?.session ?? null,
    note: selected || historical ? null : want.note ?? (task.started ? 'No saved conversation is available.' : "This task hasn't started.") };
}

// The task's record always wins, including when another open is pending.
// Re-read selection after the asynchronous native command, before changing layout.
export async function openWorkerView(want, { panel = true, mode = null, review = null } = {}) {
  const nonce = `${Date.now()}:${Math.random()}`;
  setShared('tasks.thread.opening', nonce);
  const current = () => shared('tasks.thread.opening') === nonce;
  try {
    const view = await resolveTaskView(want);
    if (!current()) return { ok: false, why: 'A newer task opening replaced this request.' };
    if (!review && !find(layout(), "tasks-thread") && !find(layout(), "tasks-thread-body")) throw new Error("This layout has no task Chat panel.");
    const space = taskOwner(spaces(), view.key.machine, view.space);
    if (!space) throw new Error('The task’s recorded owning space is unavailable.');
    const waitingAt = Date.now();
    while (shared('tasks.thread.selecting')) {
      if (!current()) return { ok: false, why: 'A newer task opening replaced this request.' };
      const lock = shared('tasks.thread.selecting');
      if (Date.now() - lock.at > 15000) { setShared('tasks.thread.selecting', null); break; }
      if (Date.now() - waitingAt > 15000) throw new Error('Another space selection did not finish.');
      await exec('sleep', ['0.05']);
    }
    if (!current()) return { ok: false, why: 'A newer task opening replaced this request.' };
    if (!taskOwner(spaces(), view.key.machine, view.space)?.active) {
      const old = activeTaskThread();
      // Do not show the previous space's raw terminal during a cross-space selection.
      const raw = find(layout(), 'tasks-thread-body')?.active === 'tasks-thread-term';
      if (raw) run('layout.select', { stack: 'tasks-thread-body', child: 'tasks-thread-chat' });
      setShared('tasks.thread.selecting', { nonce, at: Date.now() });
      try {
        const r = await exec('herdr-app', ['do', 'space.select', '--id', space.id]);
        if (!current()) return { ok: false, why: 'A newer task opening replaced this request.' };
        if (r.code !== 0 || !taskOwner(spaces(), view.key.machine, view.space)?.active) {
          if (raw && old && threadIdentity(activeTaskThread()) === threadIdentity(old)) showTaskMode(old, old.mode ?? 'chat');
          throw new Error('The task’s recorded owning space could not be selected.');
        }
      } finally {
        if (shared('tasks.thread.selecting')?.nonce === nonce) setShared('tasks.thread.selecting', null);
      }
    }
    if (review) { review(view); return { ok: true, view }; }
    const previous = stored(space);
    const changed = threadIdentity(view) !== threadIdentity(previous);
    const shown = shared('tasks.thread.displayed');
    const otherView = shown !== threadIdentity(view) || previous?.open === false;
    const next = { ...view, open: true, at: Date.now(), mode: mode ?? (changed ? (view.terminal && !view.historical ? 'terminal' : 'chat') : previous?.mode ?? 'chat') };
    setShared(VIEWS, { ...shared(VIEWS), [spaceKey(space)]: next });
    setShared('tasks.thread', next);
    setShared('tasks.thread.displayed', threadIdentity(next));
    if (panel || !space.active) run('layout.select', { stack: 'panel-body', child: 'tasks' });
    run('layout.select', { stack: 'tasks', child: 'tasks-thread' });
    if (find(layout(), 'tasks-thread-body') && (changed || otherView || mode)) showTaskMode(next, next.mode);
    if (panel || !space.active) run('layout.show', { id: 'panel' });
    return { ok: true, view: next };
  } catch (e) {
    const why = String(e?.message ?? e);
    if (current()) notify({ title: 'Task did not open', body: why, level: 'error' });
    return { ok: false, why };
  }
}

export function showTaskMode(want, mode) {
  if (!want || threadIdentity(activeTaskThread()) !== threadIdentity(want)) return;
  updateTaskThread(want, { mode });
  const previous = shared('tasks.thread.termreq')?.at ?? 0;
  setShared('tasks.thread.termreq', null);
  // Never expose the previous worker while the asynchronous terminal pointer catches up.
  run('layout.select', { stack: 'tasks-thread-body', child: 'tasks-thread-chat' });
  if (mode === 'terminal' && want.terminal && !want.historical) {
    setShared('tasks.thread.termreq', { terminal: want.terminal, identity: threadIdentity(want), at: Math.max(Date.now(), previous + 1) });
  } else if (['pr', 'browser', 'artifacts'].includes(mode)) {
    run('layout.select', { stack: 'tasks-thread-body', child: `tasks-thread-${mode}` });
  }
}

// Upgrade a saved keyed view without activating its space or borrowing the
// focused space. Unkeyed legacy state is deliberately not restored by address.
async function restoreSavedTask() {
  const legacy = shared('tasks.thread');
  const restoring = shared('tasks.thread.restoring');
  if (!legacy?.key || shared(VIEWS) || (restoring && Date.now() - restoring.at < 15000)) return;
  const opened = shared('tasks.thread.opening');
  const nonce = `${Date.now()}:${Math.random()}`;
  setShared('tasks.thread.restoring', { nonce, at: Date.now() });
  const mode = find(layout(), 'tasks-thread-body')?.active?.replace('tasks-thread-', '') ?? 'chat';
  // Keep the header mounted while it reads the legacy source, but never
  // display an unverified raw terminal in the meantime.
  run('layout.select', { stack: 'tasks-thread-body', child: 'tasks-thread-chat' });
  try {
    const view = await resolveTaskView(legacy);
    if (shared('tasks.thread.restoring')?.nonce !== nonce || shared('tasks.thread.opening') !== opened || shared(VIEWS)) return;
    const space = taskOwner(spaces(), view.key.machine, view.space);
    if (!space) return;
    const next = { ...view, open: true, mode: view.historical ? 'chat' : mode, at: Date.now() };
    setShared(VIEWS, { [spaceKey(space)]: next });
    if (space.active) {
      setShared('tasks.thread', next);
      setShared('tasks.thread.displayed', threadIdentity(next));
      showTaskMode(next, next.mode);
      run('layout.select', { stack: 'tasks', child: 'tasks-thread' });
    } else {
      setShared('tasks.thread.displayed', null);
      run('layout.select', { stack: 'tasks', child: 'tasks-list' });
    }
  } catch (e) {
    if (!shared(VIEWS) && shared('tasks.thread.opening') === opened) {
      setShared(VIEWS, {});
      setShared('tasks.thread.displayed', null);
      run('layout.select', { stack: 'tasks', child: 'tasks-list' });
      notify({ title: 'Saved task did not open', body: String(e?.message ?? e), level: 'error' });
    }
  } finally {
    if (shared('tasks.thread.restoring')?.nonce === nonce) setShared('tasks.thread.restoring', null);
  }
}

// The Tasks stack is shared by the window. When a person selects a different
// space, restore only that space's own selection, or return to the list.
export function reconcileTaskPanel() {
  const want = activeTaskThread();
  if (shared('tasks.thread.selecting')) return;
  if (!shared(VIEWS) && shared('tasks.thread')?.key) { void restoreSavedTask(); return; }
  if (shared('tasks.thread.displayed') === threadIdentity(want)) return;
  setShared('tasks.thread.displayed', threadIdentity(want));
  if (!want) {
    setShared('tasks.thread.termreq', null);
    run('layout.select', { stack: 'tasks-thread-body', child: 'tasks-thread-chat' });
    run('layout.select', { stack: 'tasks', child: 'tasks-list' });
  } else {
    setShared('tasks.thread', want);
    showTaskMode(want, want.mode ?? 'chat');
  }
}
