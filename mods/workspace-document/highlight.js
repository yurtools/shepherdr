import { div } from 'gpui-kit';
import { v_flex, h_flex, v_virtual_list, Scrollbar } from 'gpui-base';
import { settings } from 'herdr';
import { highlightedLines } from './core/syntax.js';
export function highlighted(doc, lang, t, id) {
  if (doc.highlightText !== doc.text || doc.highlightLang !== lang) {
    doc.highlightText=doc.text;doc.highlightLang=lang;doc.highlighted=highlightedLines(doc.text,lang);doc.highlightRevision=(doc.highlightRevision??0)+1;
    doc.highlightColumns=Math.max(80,...doc.highlighted.lines.map(line=>line.reduce((n,x)=>n+x.text.length,0)));
  }
  const data=doc.highlighted, colors={plain:t.foreground,keyword:t.ansi5,string:t.ansi2,comment:t.dim,number:t.ansi1,function:t.ansi4,type:t.ansi3,operator:t.ansi6};
  const list=`highlight-${id}-${doc.highlightRevision}`, w=Math.min(80000,60+doc.highlightColumns*8);
  return v_flex().flex_1().min_h(0)
    .child(div().px(10).py(4).flex_none().text_size(11).text_color(t.dim).child('Highlighted source · read only. Choose Edit to change the file.'))
    .when(data.limited,el=>el.child(div().p(8).text_size(11).text_color(t.dim).child('Highlight view shows the first 12,000 lines. Edit retains the full source.')))
    .child(div().flex_1().min_h(0).overflow_x_scrollbar()
      .child(div().relative().size_full().min_w(w)
        .child(v_virtual_list(list,data.lines.length,20,i=>String(i),(range)=>data.lines.slice(range.start,range.end).map((line,j)=>h_flex().h(20).min_w(w).items_center().font_family(settings().font_family).text_size(12.5)
          .child(div().w(50).pr(10).flex_none().text_right().text_color(t.dim).child(String(range.start+j+1)))
          .children(line.map(token=>div().flex_none().text_color(colors[token.kind]??t.foreground).child(token.text.replace(/ /g,'\u00a0'))))))
          .size_full())
        .child(Scrollbar.vertical(list).absolute().inset_0())));
}
