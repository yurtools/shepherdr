// Hidden native materialization of the real Chat news plan and row renderer.
// No Chat init, live terminal, task store, second window or user conversation.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import Chat from "./chat.js";

const t = { accent: "#f59e0b", background: "#18181b", foreground: "#f4f4f5", muted: "#d4d4d8",
  dim: "#a1a1aa", raised: "#27272a", surface: "#202024", border: "#3f3f46", hover: "#3f3f46", blocked: "#fb7185" };
const at = (s) => Date.parse(s);
const task = { id: 60, ref: "DEMO-60", title: "Example work with a deliberately long summary for the narrower pane",
  space: "fixture", feature: "feature-one", folder: "/fixture", started: at("2024-12-31T23:55:00Z"),
  status: "ready", ready_at: at("2025-01-01T14:35:00Z") };
const rows = [task, { ...task, id: 61, ref: "DEMO-61", title: "Waiting for an answer", status: "needs" },
  { ...task, id: 62, ref: "DEMO-62", title: "Completed work", status: "done", done_at: at("2025-01-02T17:50:00Z") }];
const items = [
  { kind: "news", id: "legacy", at: 0, ref: "DEMO-61", event: "ready", text: "DEMO-61 is ready: Waiting for an answer" },
  { kind: "news", id: "needs", at: at("2025-01-01T05:15:00Z"), ref: "DEMO-61", event: "needs-you", text: "DEMO-61 needs you: A decision (Waiting for an answer)" },
  { kind: "news", id: "ready", at: at("2025-01-01T14:35:00Z"), ref: "DEMO-60", event: "ready", text: `DEMO-60 is ready: ${task.title} · An example result that will be shortened at narrow widths` },
];
export default class Fixture extends View {
  init() {
    const host = this.host = Object.create(Chat.prototype);
    Object.assign(host, { assistant: () => "fixture", feature: "feature-one", start: 0, spaceTasks: rows,
      wasks: [], accepting: new Set(), findQuery: () => "", opened: new Set(), unfolded: new Set() });
    const plan = host.newsPlan(items);
    let step; do { step = plan.next(); } while (!step.done);
    this.rows = [...step.value.extra.map(e => e.row), ...step.value.inline.values()].sort((a, b) => a.at - b.at);
    if (!this.rows.some(r => r.accept) || !this.rows.some(r => r.live)) throw Error("Missing fixture state");
  }
  render() {
    return div().children([340, 640].map(width => {
      this.host.width = width; this.host.column = () => width - 24;
      return div().w(width).child(v_flex().children(this.rows.map(row => this.host.rowBare(row, t, "fixture-"))));
    }));
  }
}
