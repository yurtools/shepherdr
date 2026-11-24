// "Open in the sidebar" for the artifact viewer, and Ctrl+K's artifact when no chat pane shows
// (mods/jump): the same steps as mods/artifacts/sidebar.js (mods can't import each other's files;
// keep the two in step). Shared: the source is lib/artifact-sidebar.js; edit it, never a mod's
// copy, then run bin/sync-shared. The layout's "artifacts" stack
// shows "artifacts-view", whose body block ("artifacts-view-body") gets the artifact's mod;
// shared "artifacts.view" says which artifact its header names.

import { layout, run, shared, setShared, appHome, readTextFile, writeTextFile } from "herdr";
import { selectArtifactOwner } from "./artview.js";
import { toast, plainError } from "./ui.js";

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

export const hasSidebarView = () => Boolean(find(layout(), "artifacts-view-body"));

// The body block gets the artifact's mod: an edit of that one block in the layout's file (not
// layout.set: a mod's run() refuses arguments nested over 16 levels, which this block is, and
// layout.set would write the person's clicked sizes into the file). Only if the file is unchanged
// since it was read; else read again.
async function setBody(mod) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null"), body = find(tree, "artifacts-view-body");
    if (!body) throw new Error("This layout has no artifact view.");
    body.content = { mod };
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); return; }
    catch (e) { if (i >= 2) throw e; }
  }
}

export async function showInSidebar(view) {
  try {
    await selectArtifactOwner(view);
    const body = find(layout(), "artifacts-view-body");
    if (!body) return false;
    if (body.content?.mod !== view.mod || body.content?.props) await setBody(view.mod);
    // A space may have changed while the layout was written.
    await selectArtifactOwner(view);
    setShared("artifacts.view", { ...view, base: view.base ?? view.mod, latest: view.latest ?? view.version, at: Date.now() });
    run("layout.select", { stack: "panel-body", child: "artifacts" });
    run("layout.select", { stack: "artifacts", child: "artifacts-view" });
    run("layout.show", { id: "panel" });
    return true;
  } catch (e) {
    toast({ title: "Artifact didn't open", body: plainError(e), level: "error" });
    return false;
  }
}
