import AgentPanel from "./panel.js";
import { inRender } from "./live.js";
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, theme, nextCommand } from "herdr";
import { besideChoices, openBeside } from "./companions.js";
import { menuRow, toast, plainError } from "./ui.js";
export default class Agents extends View {
  init(_props, cx) {
    if(props()?.panel){this.panel=new AgentPanel();this.panel.init(cx);return;}
    this.handle = cx.focus_handle(); this.handle.focus(); this.selected = 0;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (!command.startsWith("open-")) continue;
        const id = command.slice(5).replace(/~/g, "/");
        this.choose(besideChoices(props()?.pane).find(row => row.id === id), cx);
      }
    });
  }
  choose(row, cx) {
    if (!row || this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try { await openBeside(props()?.pane, row); closeOverlay(props()?.overlay); }
      catch (e) { this.busy = false; toast({ title: "Agent view didn't open", body: plainError(e), level: "error" }); }
    });
  }
  close(){this.panel?.close();}
  render(cx) {
    if(this.panel)return inRender(()=>this.panel.draw(cx));
    const t = theme(), rows = besideChoices(props()?.pane);
    return v_flex().id("beside-agents").track_focus(this.handle).w_full().max_h(460).p(6).gap(2).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props()?.overlay);
        else if (e.key === "up") this.selected = (this.selected + rows.length - 1) % Math.max(1, rows.length);
        else if (e.key === "down") this.selected = (this.selected + 1) % Math.max(1, rows.length);
        else if (e.key === "enter") this.choose(rows[this.selected], cx);
        cx.notify();
      })
      .child(div().px(8).py(6).text_size(12).text_color(t.muted).child("Open beside · this space"))
      .child(v_flex().min_h(0).overflow_y_scroll().children(rows.map((row, i) => v_flex()
        .child(menuRow(`beside-${i}`, row.label, { onClick: (_e, cx) => this.choose(row, cx) }).when(i === this.selected, e => e.bg(t.selected)))
        .child(div().px(9).pb(6).truncate().text_size(11).text_color(t.dim).child(row.detail)))))
      .when(!rows.length, e => e.child(div().px(8).py(12).text_size(12).text_color(t.dim).child("Open another agent in this space first.")));
  }
}
