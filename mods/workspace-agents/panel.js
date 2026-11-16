import { div } from 'gpui-kit';
import { v_flex, h_flex, Input, InputState } from 'gpui-base';
import { focused, run, theme } from 'herdr';
import { panes, spaces, terminals } from './live.js';
import { besideChoices, openBeside } from './companions.js';
import { button, plainError } from './ui.js';
import { holdKeys, dropKeys } from './keyholder.js';
export default class AgentPanel {
 init(cx){this.query=InputState.new({placeholder:'Find agents in this space…'});this.query.on('change',(_e,cx)=>cx.notify());this.query.on('focus',()=>holdKeys('agents-panel'));cx.timer.every(2000,()=>cx.notify());}
 anchor(){const space=spaces().find(s=>s.active),all=panes().filter(p=>space?.tabs.some(t=>t.id===p.tab));return all.find(p=>p.pane===focused()?.pane)??all.find(p=>p.mod==='chat')??all[0];}
 choose(row,beside,cx){dropKeys("agents-panel");const anchor=this.anchor();if(!anchor)return;this.error=null;
  if(!beside&&row.pane){run('tab.select',{id:row.tab});run('pane.focus',{pane:row.pane});return;}
  cx.spawn(async cx=>{try{await openBeside(anchor.pane,row);}catch(e){this.error=plainError(e);}cx.notify();});}
 draw(cx){const t=theme(),space=spaces().find(s=>s.active),q=(this.query.value()??'').toLowerCase();
  const all=besideChoices(this.anchor()?.pane,{includeSelf:true,spaceId:space?.id}),rows=all.filter(r=>!q||`${r.label} ${r.detail}`.toLowerCase().includes(q)).slice(0,200);
  return v_flex().id('agents-panel').size_full().min_h(0).gap(8).p(10).text_color(t.foreground)
   .child(h_flex().items_center().gap(8).child(div().font_semibold().child('Agents')).child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(space?.name??'')))
   .child(Input.new(this.query).w_full())
   .when(Boolean(this.error),el=>el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
   .child(v_flex().id('running-agents').flex_1().min_h(0).overflow_y_scroll().gap(8).children(rows.map((row,i)=>v_flex().p(8).gap(5).rounded(7).border_1().border_color(t.border)
    .child(div().font_medium().text_size(12).child(row.label))
    .child(div().truncate().text_size(11).text_color(t.dim).child(row.detail))
    .child(div().text_size(11).text_color(t.dim).child(String(terminals().find(k=>k.address===row.terminal)?.status?.state??terminals().find(k=>k.address===row.terminal)?.status??(row.slot?'Not started':'Running'))))
    .child(h_flex().gap(5).child(button(`agent-open-${i}`,'Open',{kind:'plain',onClick:(_e,cx)=>this.choose(row,false,cx)}))
      .child(button(`agent-beside-${i}`,'Beside…',{kind:'plain',onClick:(_e,cx)=>this.choose(row,true,cx)})))))
    .when(!rows.length,el=>el.child(div().p(8).text_size(12).text_color(t.dim).child('No matching agents in this space.'))));}
 close(){this.query?.release();dropKeys('agents-panel');}
}
