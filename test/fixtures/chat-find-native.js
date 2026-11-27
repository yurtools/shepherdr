// Hidden native materialization only: never initialize a Chat, read a log,
// launch a second window, bind a terminal or change live shared state.
import { View, div } from 'gpui-kit';
import { InputState, v_flex } from 'gpui-base';
import Chat from './chat.js';
import { flowchart } from './core/chat-flowchart.js';
const t={background:'#18181b',foreground:'#f4f4f5',muted:'#a1a1aa',dim:'#a1a1aa',raised:'#27272a',surface:'#202024',border:'#3f3f46',accent:'#f59e0b',hover:'#3f3f46',blocked:'#fb7185'};
export default class Fixture extends View {
  init(){
    const h=this.host=Object.create(Chat.prototype);
    Object.assign(h,{width:510,column:()=>474,findQuery:()=> 'needle',finding:true,findIdx:1,opened:new Set(),unfolded:new Set(),
      pickKey:()=> 'synthetic-view',areaKey:()=> 'synthetic-view',mentionsIn:s=>s,records:[],start:10});
    h.findBox=InputState.new({placeholder:'Find in chat'});h.findBox.set_value('needle');
    const source='graph LR\nA[Other<br>needle] --> B[Publish]  ';
    const rows=this.rows=[{id:'person',kind:'user',text:'Needle and [a+b]'},
      {id:'reply',kind:'agent',text:'**nee**dle, `NEEDLE` and [link](./doc.md).'},
      {id:'code',kind:'code',code:'const needle = 1;\nconst NEEDLE = 2;'},
      {id:'table',kind:'agent',text:'| Key | Value |\n|---|---|\n| needle | |'},
      {id:'diagram-source',kind:'code',code:source,display:source,result:flowchart(source)}];
    for(const row of rows)row.find=h.findData(row,'needle');
    const found=h.findMatches(rows),findOffsets=new Map(),findEnds=[];let findTotal=0;
    for(const m of found){findOffsets.set(m.id,findTotal);findTotal+=m.n;findEnds.push(findTotal);}
    h.history={snapshot:{rows,found,findQuery:'needle',findOffsets,findEnds,findTotal}};
    h.findSelected=h.findOccurrence(found);
    if(h.findSelected?.text.slice(h.findSelected.start,h.findSelected.end)!=='needle')throw Error('Selected occurrence did not resolve');
  }
  render(){return div().w(510).child(v_flex().child(this.host.findBar(t,this.rows)).children(this.rows.map(row=>this.host.rowBare(row,t,'fixture-'))));}
  close(){this.host.findBox.release();}
}
