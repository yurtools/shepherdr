import { featureRecords, featureRequest, startFeature, workspaceCall } from "./features.js";
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { theme, shared, setShared, terminals } from "herdr";
import { spaces } from "./live.js";
import { historyScope, historyRead, openHistory, requestSession } from "./session-history.js";
import { button, segmented, plainError } from "./ui.js";
import { holdKeys, dropKeys } from "./keyholder.js";
import { stamp } from "./stamp.js";

// This persistent list only reads history. The tab bar still owns resume/launch operations.
export default class Sidebar {
  init(cx) {
    this.rows = []; this.filter = "closed"; this.section = localStorage.getItem("history-section") ?? "features"; this.generation = 0;
    this.search = InputState.new({ placeholder: "Search…" });
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
    this.space = space; this.scope = scope;
    if (changed) {
      this.identity = identity; this.generation++; this.rows = []; this.error = error; this.loading = false;
      this.selected = null; this.search.set_value(""); cx.notify();
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
  open(row) { if (this.space) openHistory(this.space, row?.key ?? this.selected ?? null); }
  resume(row) { if (!this.scope || !row) return; this.selected = row.key; requestSession(this.scope, row.key); }
  chooseSection(section,cx) { this.section=section;localStorage.setItem('history-section',section);cx.notify(); }
  features(cx) {
    const t=theme(),rows=featureRecords().filter(r=>r.space===this.space?.id),q=(this.search.value()??'').trim().toLowerCase();
    const list=rows.filter(r=>(this.filter==='all'||r.status!=='completed')&&(!q||r.name.toLowerCase().includes(q)));
    return v_flex().id('features-sidebar').size_full().min_h(0).text_color(t.foreground)
      .child(v_flex().p(10).gap(8).flex_none()
       .child(segmented('workspace-history-tabs',[['features','Features'],['sessions','Sessions']],this.section,(section,_e,cx)=>this.chooseSection(section,cx)))
       .child(h_flex().gap(6).items_center().child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(this.space?.name??'Choose a space'))
        .child(button('feature-new','+',{kind:'plain',disabled:!this.space,onClick:()=>startFeature(this.space)}))
        .child(button('features-refresh','↻',{kind:'plain',onClick:(_e,cx)=>cx.spawn(async cx=>{try{setShared('workspace.features',(await workspaceCall('features')).features);this.error=null;}catch(e){this.error=plainError(e);}cx.notify();})})))
       .child(Input.new(this.search).w_full().text_size(12))
       .child(segmented('feature-filter',[['closed','Active'],['all','All']],this.filter,(v,_e,cx)=>{this.filter=v;cx.notify();})))
      .when(Boolean(this.error),el=>el.child(div().p(8).text_size(11).text_color(t.blocked).child(this.error)))
      .child(v_flex().id('feature-list').flex_1().min_h(0).overflow_y_scroll().px(6).gap(4)
       .children(list.map(row=>{
        const live=terminals().find(k=>k.state==='live'&&k.labels?.['herdr.feature']===row.id&&k.labels?.['herdr.role']==='feature');
        const status=live?.status?.state??(row.session?'Paused':'New'),color=status==='blocked'?t.blocked:status==='working'?t.working:status==='done'||row.status==='completed'?t.done:t.dim;
        return h_flex().id(`feature-${row.id}`).p(9).gap(7).items_center().rounded(7).cursor_pointer().hover(x=>x.bg(t.hover))
         .on_click(()=>featureRequest(row.id))
         .child(svg('mods/coordinator/network.svg').size(15).flex_none().text_color(color))
         .child(v_flex().flex_1().min_w(0).gap(4).child(div().truncate().text_size(12).font_medium().child(row.name))
          .child(div().text_size(11).text_color(color).child(row.status==='completed'?'Completed':status)))
         .child(button(`feature-complete-${row.id}`,row.status==='completed'?'↶':'✓',{kind:'plain',onClick:(_e,cx)=>{cx.stop_propagation();cx.spawn(async cx=>{try{await workspaceCall('feature-update',{id:row.id,status:row.status==='completed'?'active':'completed'});setShared('workspace.features',(await workspaceCall('features')).features);}catch(e){this.error=plainError(e);}cx.notify();});}}));
       }))
       .when(!list.length,el=>el.child(div().p(10).text_size(12).text_color(t.dim).child(q?'No matching features.':'Start a feature from + or a conversation.'))));
  }
  draw(cx) {
    if (this.section === "features") return this.features(cx);
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
          .child(segmented("workspace-history-tabs", [["features","Features"],["sessions","Sessions"]], this.section, (section,_e,cx)=>this.chooseSection(section,cx)))
          .child(div().flex_1())
          .child(button("sidebar-sessions-open", "Open…", { kind: "plain", onClick: () => this.open() }))
          .child(button("sidebar-sessions-refresh", "↻", { kind: "plain", onClick: (_e, cx) => this.sync(cx, true) }).accessibility_label("Refresh sessions")))
        .child(div().truncate().text_size(11).text_color(t.dim).child(this.space?.name ?? "This space"))
        .child(Input.new(this.search).w_full().text_size(12))
        .child(segmented("sidebar-sessions-filter", [["closed", "Closed"], ["all", "All"]], this.filter, (id, _e, cx) => { this.filter = id; cx.notify(); })))
      .child(v_flex().id("sidebar-session-list").flex_1().min_h(0).overflow_y_scroll().px(6).pb(8).gap(3)
        .when(this.loading && !list.length, el => el.child(div().p(8).child(muted("Finding conversations…"))))
        .when(Boolean(this.error), el => el.child(div().p(8).text_size(12).text_color(t.blocked).child(this.error)))
        .children(list.map(row => v_flex().id(`sidebar-session-${row.key}`).p(9).gap(5).rounded(7).cursor_pointer()
          .hover(s => s.bg(t.hover)).on_click(() => this.resume(row))
          .child(div().truncate().font_medium().text_size(12).child(row.title))
          .child(h_flex().gap(6).child(muted(row.account)).when(Boolean(row.terminal), el => el.child(muted("Open"))))
          .child(muted(stamp(row.updated)))))
        .when(!this.loading && !this.error && !list.length, el => el.child(div().p(8).child(muted(q ? "No matching conversations." : this.filter === "closed" ? "No closed conversations. Try All." : "No saved conversations yet."))))
        .when(filtered.length > list.length || this.truncated, el => el.child(div().p(8).child(muted("Search to narrow the list.")))));
  }
}
