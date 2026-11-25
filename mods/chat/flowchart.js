// Shared native drawing. The inline overview and expanded viewer use the same
// geometry and drawing primitives, with no retained native paths or callbacks.
import { div, PathBuilder } from 'gpui-kit';
import { v_flex } from 'gpui-base';
import { arrowTriangle, fitFlowchart, chartHeight, nodePolygon, FLOW_FONT, FLOW_LINE, FLOW_WORDS, FLOW_OPEN_HEIGHT } from './core/chat-flowchart-geometry.js';

export function flowchartCanvas(drawing, fit, t) {
  const s = fit.scale;
  const canvas = div().relative().w(fit.width).h(fit.height).flex_none();
  const pathLayer = (path, color) => window.paint_path(path, color).absolute().top(0).left(0).w(fit.width).h(fit.height);
  const trace = (p, pts) => {
    if (!pts.length) return;
    p.move_to(pts[0].x*s, pts[0].y*s);
    for (const pt of pts.slice(1)) p.line_to(pt.x*s, pt.y*s);
  };
  const polygon = (p, pts) => { trace(p, pts); p.close(); };
  for (const style of ['solid','dotted','thick']) {
    const edges = drawing.edges.filter(e => e.style === style);
    if (!edges.length) continue;
    const p = PathBuilder.stroke((style === 'thick' ? 2.7 : 1.5)*s);
    if (style === 'dotted') p.dash_array([4*s, 4*s]);
    for (const e of edges) trace(p, e.points);
    canvas.child(pathLayer(p.build(), t.muted));
  }
  const arrows = PathBuilder.fill();
  let count = 0;
  for (const e of drawing.edges) {
    const points = e.points;
    for (const [on, tip, prev] of [[e.end,points.at(-1),points.at(-2)],[e.start,points[0],points[1]]]) {
      if (!on || !tip || !prev) continue;
      const triangle = arrowTriangle(tip,prev);
      if (triangle.length) { polygon(arrows,triangle); count++; }
    }
  }
  if (count) canvas.child(pathLayer(arrows.build(),t.muted));
  const label = (n, color) => v_flex().absolute().left((n.x-n.width/2)*s).top((n.y-n.height/2)*s)
    .w(n.width*s).h(n.height*s).items_center().justify_center().text_size(FLOW_FONT*s).text_color(color)
    .children(n.lines.map(line => div().h(FLOW_LINE*s).flex_none().text_center().child(line || ' ')));
  for (const n of drawing.nodes) {
    const pts = nodePolygon(n);
    if (pts.length) {
      const p = PathBuilder.fill(), stroke = PathBuilder.stroke(1.5*s);
      polygon(p,pts); polygon(stroke,pts);
      canvas.child(pathLayer(p.build(),t.raised)).child(pathLayer(stroke.build(),t.accent));
    } else {
      const r = n.shape === 'circle' || n.shape === 'pill' ? n.height/2 : n.shape === 'round' || n.shape === 'database' ? 10 : 5;
      const box = div().absolute().left((n.x-n.width/2)*s).top((n.y-n.height/2)*s).w(n.width*s).h(n.height*s)
        .rounded(r*s).bg(t.raised).border(1.5*s).border_color(t.accent);
      if (n.shape === 'subroutine') {
        for (const x of [8,n.width-8]) box.child(div().absolute().top(0).bottom(0).left(x*s).w(s).bg(t.accent));
      }
      if (n.shape === 'database') box.child(div().absolute().top(0).left(0).right(0).h(12*s).rounded_full().border_1().border_color(t.accent));
      canvas.child(box);
    }
    canvas.child(label(n,t.foreground));
  }
  for (const e of drawing.edges) if (e.lines.length) {
    const bg = div().absolute().left((e.x-e.width/2)*s).top((e.y-e.height/2)*s).w(e.width*s).h(e.height*s).bg(t.surface).rounded(4);
    canvas.child(bg).child(label(e,t.foreground));
  }
  return canvas;
}

export function nativeFlowchart(drawing, available, t, id, measure = false) {
  const fit = fitFlowchart(drawing, available);
  if (measure) return div().h(chartHeight(drawing, available)).flex_none();
  return v_flex().id(id).w_full().items_center().flex_none().cursor_pointer()
    .child(div().h(FLOW_OPEN_HEIGHT).flex_none().flex().items_center().justify_center()
      .text_size(12).text_color(t.accent).font_medium().accessibility_label(FLOW_WORDS.expand)
      .hover(el=>el.text_color(t.foreground)).child(`${FLOW_WORDS.expand} ↗`))
    .child(flowchartCanvas(drawing,fit,t));
}
