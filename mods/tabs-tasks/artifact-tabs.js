// Repair old CLI-created artifact tabs using Herdr's complete pane list, not ls's
// terminal-only list or the sidebar's (possibly stale) titles. Never rename mixed
// tabs, named tabs (even a manually named "4"), or an unverified mod.
import { appHome, exec, panes, run, spaces } from "herdr";

function candidates(ss, ps) {
  const space = ss.find(s => s.active);
  if (!space) return [];
  return space.tabs.flatMap(tab => {
    if (tab.named !== false || tab.name !== String(tab.index) || tab.panes !== 1) return [];
    const mine = ps.filter(p => p.tab === tab.id);
    if (mine.length !== 1 || mine[0].terminal != null || !mine[0].mod?.startsWith("art-")) return [];
    const p = mine[0];
    return [{ space: space.id, machine: space.machine ?? null, tab: tab.id, pane: p.pane, mod: p.mod }];
  });
}

const keyOf = a => JSON.stringify([a.space, a.machine, a.tab, a.pane, a.mod]);

export function watchArtifactTabNames(cx) {
  const attempted = new Map(); // one rename per tab/pane, even while the host update is delayed
  const checked = new Set();   // unavailable metadata: retry when the person revisits a tab/space
  let selection = null, busy = false;
  cx.timer.every(1000, cx => {
    if (busy) return;
    const ss = spaces(), active = ss.find(s => s.active);
    const now = JSON.stringify([active?.id, active?.tabs.find(t => t.active)?.id]);
    if (selection !== now) { selection = now; checked.clear(); }
    const live = new Set(ss.flatMap(s => s.tabs.map(t => t.id)));
    for (const id of attempted.keys()) if (!live.has(id)) attempted.delete(id);
    const pending = candidates(ss, panes()).find(a => attempted.get(a.tab) !== keyOf(a) && !checked.has(keyOf(a)));
    if (!pending) return;
    const key = keyOf(pending);
    checked.add(key);
    busy = true;
    cx.spawn(async () => {
      try {
        // The helper reads only its generated installation metadata, even for an
        // offline remote artifact. It does not import a panel or contact its machine.
        const r = await exec(`${appHome()}/mods/artifacts/bin/herdr-artifact`, ["tab-name", pending.mod, "--json"]);
        if (r.code !== 0) return;
        const record = JSON.parse(r.stdout);
        if (record.mod !== pending.mod || record.machine !== pending.machine || !record.id ||
            typeof record.name !== "string" || !record.name.trim()) return;
        // A read can finish after a rename, split, move, close, or space switch.
        if (!candidates(spaces(), panes()).some(a => keyOf(a) === key)) return;
        attempted.set(pending.tab, key);
        run("tab.rename", { id: pending.tab, name: record.name });
      } catch {
        // Missing/malformed metadata is not enough evidence to rename.
      } finally { busy = false; }
    });
  });
}
