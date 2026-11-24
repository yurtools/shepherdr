// An artifact inside the Artifacts sidebar (the person's decision: drill in, same pane, like a
// task's chat inside the Tasks panel). The layout's "artifacts" stack holds the list
// ("artifacts-list", this mod) and the view ("artifacts-view"): a header (this mod with props
// { head: true }: ‹ Artifacts back to the list, the title and version) over a block that shows
// the artifact's own mod ("artifacts-view-body"). Which artifact: shared "artifacts.view" =
// { mod, id, title, version, machine, at }; the body block's mod is swapped in the layout file.
// Also used by the chat's artifact viewer (mods/chat-image) for its "Open in the sidebar".

import { layout, run, shared, setShared, appHome, readTextFile, writeTextFile } from "herdr";
export { showInSidebar } from "./artifact-sidebar.js";

export const STACK = "artifacts", LIST = "artifacts-list", VIEW = "artifacts-view", BODY = "artifacts-view-body";

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

// Whether the shown layout has the drill-in view.
export const hasSidebarView = () => Boolean(find(layout(), BODY));

// Shows the artifact (its mod already in this app) in the sidebar: false when the layout can't,
// else a promise of whether it did.
export const backToList = () => run("layout.select", { stack: STACK, child: LIST });


