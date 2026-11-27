// Durable task ownership is independent of the repository, worktree, selected
// tab and worker address. The task list's machine qualifies the recorded space.
export const bareSpace = id => typeof id === 'string' ? id.split('/').pop() : null;
export const addressMachine = addr => typeof addr === 'string' && addr.includes('/') ? addr.split('/')[0] : null;
export function taskOwner(spaces, machine, recorded) {
  if (typeof recorded !== 'string' || !recorded || (recorded.includes('/') && addressMachine(recorded) !== (machine ?? null))) return null;
  const found = spaces.filter(s => (s.machine ?? null) === (machine ?? null) && bareSpace(s.id) === bareSpace(recorded));
  return found.length === 1 ? found[0] : null;
}
export const taskIdentity = key => key ? JSON.stringify([key.machine ?? null, key.folder, key.slug, Number(key.id)]) : null;
export const qualifyAddress = (machine, addr) => addr && machine && !addr.includes('/') ? `${machine}/${addr}` : addr;

// A retained shell, another task reusing a terminal, or a worker with stale
// ownership labels is not the live conversation. Historical logs are separate.
export function liveTaskTerminal(term, key, task) {
  if (!term || term.state !== 'live' || addressMachine(term.address) !== (key.machine ?? null)) return false;
  const labels = term.labels ?? {};
  if (labels['herdr.task'] !== `${key.slug}#${key.id}`) return false;
  const space = labels['herdr.task.space'];
  if (space && (bareSpace(space) !== bareSpace(task.space) || (space.includes('/') && addressMachine(space) !== (key.machine ?? null)))) return false;
  if (labels['herdr.feature'] && labels['herdr.feature'] !== (task.feature ?? null)) return false;
  if (term.program?.key === 'shell' || term.program?.shell) return false;
  const fg = term.foreground;
  const shell = /^-?(?:(?:ba|da|z|fi|k|tc|c)?sh|nu|pwsh)$/.test(String(fg?.name ?? '').split('/').pop());
  if (shell && Array.isArray(fg.argv)) {
    let command = false;
    for (const a of fg.argv.slice(1).map(String)) {
      if (a === '--command' || a.startsWith('--command=')) { command = true; break; }
      if (!a.startsWith('-') || a.startsWith('--')) break;
      if (a.slice(1).includes('c')) { command = true; break; }
    }
    if (!command) return false;
  }
  return true;
}

export function autoPrefix(folder) {
  const name = String(folder ?? "").split("/").filter(Boolean).pop() ?? "";
  const ws = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z]+/).filter(Boolean);
  let p = ws.length > 1 ? ws.map((w) => w[0]).join("").slice(0, 5) : (ws[0] ?? "").slice(0, 4);
  if (p.length < 2) p = ws.join("").length >= 2 ? ws.join("").slice(0, 2) : "TASK";
  return p.toUpperCase();
}
