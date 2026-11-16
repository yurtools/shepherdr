import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, TextView } from "gpui-base";
import { props, theme, closeOverlay, nextCommand } from "herdr";
import { spaces, inRender } from "./live.js";
import { historyScope, historyRead, requestSession } from "./session-history.js";
import { button, segmented, plainError } from "./ui.js";
import { keepKeys, dropKeys } from "./keyholder.js";
import Sidebar from "./sidebar.js";
import { stamp } from "./stamp.js";
export default class Sessions extends View {
  init(_props, cx) {
    if (props()?.sidebar) { this.sidebar = new Sidebar(); this.sidebar.init(cx); return; }
    this.handle = cx.focus_handle(); this.handle.focus();
    this.keyHolder = `dialog:sessions:${props()?.overlay ?? "history"}`;
    keepKeys(this.keyHolder);
    cx.timer.every(1500, () => keepKeys(this.keyHolder));
    this.search = InputState.new({ placeholder: "Search conversations or accounts…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.search.focus();
    cx.timer.after(300, () => this.search.focus());
    this.filter = "closed"; this.rows = []; this.messages = []; this.loading = true;
    this.refresh(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        if (command === "all") { this.filter = "all"; cx.notify(); }
        if (command.startsWith("preview-")) { const row = this.rows.find(r => r.key === command.slice(8)); if (row) this.select(row, cx); }
      }
    });
  }
  close() { if (this.sidebar) return this.sidebar.close(); this.search?.release(); dropKeys(this.keyHolder); }
  refresh(cx) {
    this.loading = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        const space = spaces().find(s => s.id === props()?.space);
        this.scope = historyScope(space); this.spaceName = space.name || "This space";
        const result = await historyRead("list", this.scope);
        this.rows = result.sessions; this.truncated = result.truncated;
        const first = this.rows.find(r => r.key === props()?.selected) ?? this.rows.find(r => !r.terminal) ?? this.rows[0];
        if (first) this.select(first, cx);
      } catch (e) { this.error = plainError(e); }
      this.loading = false; cx.notify();
    });
  }
  select(row, cx) {
    this.selected = row; this.messages = []; this.previewLoading = true; this.previewError = null;
    cx.spawn(async (cx) => {
      try {
        const out = await historyRead("preview", this.scope, row.key);
        if (this.selected?.key === row.key) this.messages = out.messages;
      } catch (e) { if (this.selected?.key === row.key) this.previewError = plainError(e); }
      if (this.selected?.key === row.key) this.previewLoading = false;
      cx.notify();
    });
  }
  open(beside = false) {
    if (!this.selected || !this.scope) return;
    requestSession(this.scope, this.selected.key, beside ? props()?.pane : null);
    closeOverlay(props()?.overlay);
  }
  render(cx) { return inRender(() => this.sidebar ? this.sidebar.draw(cx) : this.draw(cx)); }
  draw(cx) {
    const t = theme(), selected = this.selected, q = this.search.value().trim().toLowerCase();
    const filtered = this.rows.filter(r => (this.filter === "all" || !r.terminal) && (!q || `${r.title} ${r.tabTitle ?? ""} ${r.account} ${r.cwd}`.toLowerCase().includes(q)));
    const list = filtered.slice(0, 100);
    const muted = text => div().text_size(12).text_color(t.dim).child(text);
    const left = v_flex().w(320).flex_none().h_full().min_h(0).border_r(1).border_color(t.border)
      .child(v_flex().p(12).gap(10)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Sessions"))
        .child(muted(this.spaceName ?? "This space"))
        .child(Input.new(this.search).w_full().text_size(13))
        .child(segmented("sessions-filter", [["closed", "Closed"], ["all", "All"]], this.filter, (id, _e, cx) => { this.filter = id; cx.notify(); })))
      .child(v_flex().id("session-list").flex_1().min_h(0).overflow_y_scroll().px(6).pb(8).gap(3)
        .when(this.loading, el => el.child(div().p(10).child(muted("Finding saved conversations…"))))
        .when(Boolean(this.error), el => el.child(div().p(10).text_color(t.blocked).child(this.error)))
        .children(list.map(row => v_flex().id(`session-${row.key}`).p(10).gap(5).rounded(8).cursor_pointer()
          .bg(selected?.key === row.key ? t.selected : t.popover).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.select(row, cx))
          .child(div().truncate().font_medium().text_size(13).text_color(t.foreground).child(row.title))
          .child(h_flex().gap(7).text_size(11).text_color(t.dim).child(row.account).child(row.terminal ? "Open" : "Closed").child(stamp(row.updated)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(row.cwd))))
        .when(!this.loading && !this.error && !list.length, el => el.child(div().p(10).child(muted(q ? "No matching conversations." : this.filter === "closed" ? "No closed conversations yet. All shows running sessions too." : "No saved Codex conversations in this space’s folder yet."))))
        .when(filtered.length > list.length, el => el.child(div().p(10).child(muted("Showing 100 results. Search to narrow the list.")))))
      .child(h_flex().p(10).gap(8).items_center().child(muted(`${filtered.length} conversations`)).child(div().flex_1())
        .child(button("sessions-refresh", "Refresh", { kind: "plain", onClick: (_e, cx) => this.refresh(cx) })));
    const right = v_flex().flex_1().min_w(0).h_full().min_h(0)
      .child(h_flex().flex_none().p(16).gap(8).items_center().border_b(1).border_color(t.border)
        .child(v_flex().flex_1().min_w(0).gap(5)
          .child(div().truncate().font_medium().text_size(14).text_color(t.foreground).child(selected?.title ?? "Choose a conversation"))
          .when(Boolean(selected), el => el.child(muted(`${selected?.account} · ${selected?.model ?? "Saved model"}${selected?.effort ? ` · ${selected.effort}` : ""}`))))
        .when(Boolean(selected), el => el.child(button("sessions-resume", selected?.terminal ? "Open" : "Resume", { kind: "primary", onClick: () => this.open() }))
          .child(button("sessions-beside", "Beside", { kind: "secondary", disabled: !props()?.pane, onClick: () => this.open(true) })))
        .child(button("sessions-close", "×", { kind: "plain", onClick: () => closeOverlay(props()?.overlay) })))
      .child(v_flex().id("session-preview").flex_1().min_h(0).overflow_y_scroll().p(18).gap(14)
        .when(this.previewLoading, el => el.child(muted("Loading preview…")))
        .when(Boolean(this.previewError), el => el.child(div().text_color(t.blocked).child(this.previewError)))
        .when(!selected, el => el.child(muted("Closed conversations stay available here. Resume uses the same account and conversation.")))
        .children(this.messages.map((message, i) => v_flex().gap(6).p(10).rounded(8).when(message.role === "user", el => el.bg(t.raised))
          .child(div().text_size(11).text_color(t.dim).child(message.role === "user" ? "You" : "Codex"))
          .child(TextView.markdown(`history-${selected?.key}-${i}`, message.text).selectable(true))))
        .when(Boolean(selected) && !this.previewLoading && !this.previewError, el => el.child(muted("Recent messages · read-only preview. Resume opens the saved conversation in Chat."))));
    return h_flex().id("space-sessions").track_focus(this.handle).size_full().min_h(0).rounded(12).border_1().border_color(t.border).bg(t.popover).overflow_hidden()
      .on_key_down((e) => { if (e.key === "escape") closeOverlay(props()?.overlay); })
      .child(left).child(right);
  }
}
