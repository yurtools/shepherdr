import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { theme } from "herdr";
import { spaces } from "./live.js";
import { historyScope, historyRead, openHistory } from "./session-history.js";
import { button, segmented, plainError } from "./ui.js";
import { holdKeys, dropKeys } from "./keyholder.js";
import { stamp } from "./stamp.js";

// This persistent list only reads history. The tab bar still owns resume/launch operations.
export default class Sidebar {
  init(cx) {
    this.rows = []; this.filter = "closed"; this.generation = 0;
    this.search = InputState.new({ placeholder: "Search sessions…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.search.on("focus", () => holdKeys("sessions-sidebar"));
    this.sync(cx);
    cx.timer.every(2000, () => this.sync(cx));
  }
  close() { this.generation++; this.closed = true; this.search.release(); dropKeys("sessions-sidebar"); }
  sync(cx, force = false) {
    const space = spaces().find(s => s.active);
    let scope, error;
    try { scope = historyScope(space); } catch (e) { error = space ? plainError(e) : "Choose a space to see its sessions."; }
    const identity = JSON.stringify([space?.id, scope?.folder, error]);
    const changed = identity !== this.identity;
    this.space = space;
    if (changed) {
      this.identity = identity; this.generation++; this.rows = []; this.error = error; this.loading = false;
      this.search.set_value(""); cx.notify();
    }
    if (!scope || (!force && !changed && (this.loading || Date.now() - this.updated < 30000))) return;
    const generation = ++this.generation;
    this.loading = true; this.error = null; this.updated = Date.now();
    cx.spawn(async cx => {
      try {
        const result = await historyRead("list", scope);
        if (this.closed || generation !== this.generation) return;
        this.rows = result.sessions; this.truncated = result.truncated;
      } catch (e) { if (this.closed || generation !== this.generation) return; this.error = plainError(e); }
      this.loading = false; cx.notify();
    });
  }
  open(row) { if (this.space) openHistory(this.space, row?.key ?? null); }
  draw(cx) {
    const t = theme(), q = (this.search.value() ?? "").trim().toLowerCase();
    const filtered = this.rows.filter(r => (this.filter === "all" || !r.terminal) && (!q || `${r.title} ${r.tabTitle ?? ""} ${r.account} ${r.cwd}`.toLowerCase().includes(q)));
    const list = filtered.slice(0, 100), muted = text => div().text_size(11).text_color(t.dim).child(text);
    if (this.width < 160) return v_flex().size_full().items_center().pt(8)
      .child(button("sessions-rail", "◷", { kind: "plain", onClick: () => this.open() }))
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); });
    return v_flex().id("sessions-sidebar").size_full().min_h(0).overflow_hidden().text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(v_flex().flex_none().p(10).gap(8)
        .child(h_flex().items_center().gap(8)
          .child(div().font_semibold().text_size(13).child("Sessions"))
          .child(div().flex_1())
          .child(button("sidebar-sessions-refresh", "Refresh", { kind: "plain", onClick: (_e, cx) => this.sync(cx, true) })))
        .child(div().truncate().text_size(11).text_color(t.dim).child(this.space?.name ?? "This space"))
        .child(Input.new(this.search).w_full().text_size(12))
        .child(segmented("sidebar-sessions-filter", [["closed", "Closed"], ["all", "All"]], this.filter, (id, _e, cx) => { this.filter = id; cx.notify(); })))
      .child(v_flex().id("sidebar-session-list").flex_1().min_h(0).overflow_y_scroll().px(6).pb(8).gap(3)
        .when(this.loading && !list.length, el => el.child(div().p(8).child(muted("Finding conversations…"))))
        .when(Boolean(this.error), el => el.child(div().p(8).text_size(12).text_color(t.blocked).child(this.error)))
        .children(list.map(row => v_flex().id(`sidebar-session-${row.key}`).p(9).gap(5).rounded(7).cursor_pointer()
          .hover(s => s.bg(t.hover)).on_click(() => this.open(row))
          .child(div().truncate().font_medium().text_size(12).child(row.title))
          .child(h_flex().gap(6).child(muted(row.account)).when(Boolean(row.terminal), el => el.child(muted("Open"))))
          .child(muted(stamp(row.updated)))))
        .when(!this.loading && !this.error && !list.length, el => el.child(div().p(8).child(muted(q ? "No matching conversations." : this.filter === "closed" ? "No closed conversations. Try All." : "No saved conversations yet."))))
        .when(filtered.length > list.length || this.truncated, el => el.child(div().p(8).child(muted("Search to narrow the list.")))));
  }
}
