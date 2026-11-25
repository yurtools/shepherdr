import { div } from 'gpui-kit';
import { v_flex, h_flex, v_virtual_list, Scrollbar } from 'gpui-base';
import { settings } from 'herdr';
import { highlightedLines } from './core/syntax.js';
import { PREVIEW, formatCount, textExcerpt } from './core/documents.js';
export function highlighted(doc, lang, t, id) {
  if (doc.highlightText !== doc.text || doc.highlightLang !== lang) {
    doc.highlightText=doc.text;doc.highlightLang=lang;
    const excerpt=textExcerpt(doc.text,PREVIEW.highlightChars,PREVIEW.highlightLines);
    doc.highlighted=highlightedLines(excerpt.text,lang,PREVIEW.highlightLines);
    doc.highlighted.limited ||= excerpt.limited;
    // A minified line can have thousands of tokens. Bound the visible line
    // as well as the number of lines, keeping the editable source intact.
    doc.highlighted.lines=doc.highlighted.lines.map(line=>{
      let remaining=PREVIEW.highlightLineChars;const result=[];
      for(const token of line){
        if(token.text.length>remaining){
          let end=remaining;if(end>0&&/[\uD800-\uDBFF]/.test(token.text[end-1]))end--;
          result.push({...token,text:token.text.slice(0,end)+'…'});doc.highlighted.limited=true;break;
        }
        result.push(token);remaining-=token.text.length;
      }
      return result;
    });
    doc.highlightRevision=(doc.highlightRevision??0)+1;
    doc.highlightColumns=Math.max(80,...doc.highlighted.lines.map(line=>line.reduce((n,x)=>n+x.text.length,0)));
  }
  const data=doc.highlighted, colors={plain:t.foreground,keyword:t.ansi5,string:t.ansi2,comment:t.dim,number:t.ansi1,function:t.ansi4,type:t.ansi3,operator:t.ansi6};
  const list=`highlight-${id}-${doc.highlightRevision}`, w=Math.min(80000,60+doc.highlightColumns*8);
  return v_flex().flex_1().min_h(0)
    .child(div().px(10).py(4).flex_none().text_size(11).text_color(t.dim).child('Highlighted source · read only. Choose Edit to change the file.'))
    .when(data.limited,el=>el.child(div().p(8).text_size(11).text_color(t.dim).child(`Highlight view is bounded to ${formatCount(PREVIEW.highlightChars)} characters, ${formatCount(PREVIEW.highlightLines)} lines and ${formatCount(PREVIEW.highlightLineChars)} characters per displayed line. Edit retains the full source.`)))
    .child(div().flex_1().min_h(0).overflow_x_scrollbar()
      .child(div().relative().size_full().min_w(w)
        .child(v_virtual_list(list,data.lines.length,20,i=>String(i),(range)=>data.lines.slice(range.start,range.end).map((line,j)=>h_flex().h(20).min_w(w).items_center().font_family(settings().font_family).text_size(12.5)
          .child(div().w(50).pr(10).flex_none().text_right().text_color(t.dim).child(String(range.start+j+1)))
          .children(line.map(token=>div().flex_none().text_color(colors[token.kind]??t.foreground).child(token.text.replace(/ /g,'\u00a0'))))))
          .size_full())
        .child(Scrollbar.vertical(list).absolute().inset_0())));
}
