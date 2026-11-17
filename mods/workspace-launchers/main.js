import { launcherAgents } from './workspace-store.js';
import { View, div, svg, image } from 'gpui-kit';
import { h_flex, v_flex, Input, InputState } from 'gpui-base';
import { props, theme, closeOverlay, knownAgents, shared, setShared, spaces } from 'herdr';
import { workspaceCall } from './features.js';
import { button, segmented, plainError, dialogFooter } from './ui.js';
import { keepKeys, dropKeys } from './keyholder.js';
const LABELS={id:'Launcher ID',name:'Name',command:'Launch command',icon:'Icon path',url:'Website URL',profile:'Browser profile'};
const HELP={id:'A stable ID used in programs.json.',command:'Executable and arguments. Keep an account wrapper to retain its separate login.',icon:'SVG or image path, relative to Herdr’s app folder or absolute.',profile:'Same profile shares a login within a space. Use shared:name to share across spaces.'};
export default class Launchers extends View {
 init(_props,cx) {
  this.mode=_props?.mode??props()?.mode??'manage';this.space=_props?.space??props()?.space;this.tab='agents';this.fields={};this.rows=[];this.loading=true;this.catalog={chats:[],hidden_agents:[]};
  for(const k of Object.keys(LABELS)){
   this.fields[k]=InputState.new({placeholder:{name:this.mode==='feature'?'e.g. OpenAI knowledge bases':'',url:'https://chatgpt.com/',profile:'default',command:'codex --no-daemon',icon:'icons/codex.svg'}[k]??''});
   this.fields[k].on('change',(_e,cx)=>cx.notify());
  }
  this.handle=cx.focus_handle();this.handle.focus();this.holder=`dialog:launchers:${props()?.overlay}`;keepKeys(this.holder);
  cx.timer.every(1500,()=>keepKeys(this.holder));
  if(this.mode==='manage')this.load(cx);
  else{this.loading=false;cx.timer.after(0,()=>this.fields[this.mode==='browser'?'url':'name'].focus());}
  if(this.mode==='feature')this.fields.name.on('submit',(_e,cx)=>this.save(cx));
 }
 load(cx){this.loading=true;cx.spawn(async cx=>{try{
  this.catalog=await workspaceCall('catalog');
  let known=[];try{known=await knownAgents();}catch{}
  this.rows=launcherAgents(known,this.catalog);if(this.selected===undefined)this.select(this.rows[0]??null);this.error=null;
 }catch(e){this.error=plainError(e);}finally{this.loading=false;cx.notify();}});}
 select(row){this.selected=row?.id??row?.key??null;for(const k of Object.keys(this.fields))this.fields[k].set_value(k==='command'?(row?.run??[]).map(x=>/^[\w@%+=:,./-]+$/.test(x)?x:JSON.stringify(x)).join(' '):row?.[k]??(k==='id'?row?.key??'':''));}
 save(cx){if(this.busy)return;
  if(this.mode==='feature'){
   const name=this.fields.name.value().trim(),space=spaces().find(s=>s.id===this.space);
   if(!name||!space){this.error=!name?'Enter a feature name.':'Choose a space.';cx.notify();return;}
   setShared('workspace.feature.request',{create:{name,space:space.id,folder:shared('workspace.roots')?.[space.id]??space.folder},at:Date.now(),nonce:Math.random()});
   closeOverlay(props().overlay);return;
  }
  this.busy=true;cx.spawn(async cx=>{try{
  const value=Object.fromEntries(Object.entries(this.fields).map(([k,v])=>[k,v.value()]));
  if(this.mode==='browser'){
   setShared('workspace.browser.request',{url:value.url,name:value.name||'Browser',profile:value.profile||'default',space:spaces().find(s=>s.active)?.id,at:Date.now(),nonce:Math.random()});closeOverlay(props().overlay);return;
  }
  await workspaceCall(this.tab==='agents'?'save-agent':'save-chat',value);this.select(null);this.load(cx);this.error=null;
 }catch(e){this.error=plainError(e);}finally{this.busy=false;cx.notify();}});}
 remove(cx){if(!this.selected)return;cx.spawn(async cx=>{try{await workspaceCall(this.tab==='agents'?'remove-agent':'remove-chat',{id:this.selected});this.select(null);this.load(cx);}catch(e){this.error=plainError(e);}cx.notify();});}
 field(k,t,label=LABELS[k]){return v_flex().gap(5).w_full().child(div().text_size(12).font_medium().child(label))
  .child(div().rounded(6).border_1().border_color(t.border).px(9).py(7).bg(t.background).child(Input.new(this.fields[k]).w_full().text_size(13)))
  .when(Boolean(HELP[k]),el=>el.child(div().text_size(11).text_color(t.dim).child(HELP[k])));}
 icon(path,t,size=20,tint=false){return path?(tint?svg(path).size(size).text_color(t.foreground):image(path).size(size)):svg('icons/shell.svg').size(size).text_color(t.dim);}
 list(t,cx){const rows=this.tab==='agents'?this.rows:this.catalog.chats??[];
  return v_flex().w(265).h_full().flex_none().min_h(0).gap(8).pr(14).border_r(1).border_color(t.border)
   .child(h_flex().items_center().child(div().flex_1().text_size(12).text_color(t.dim).child(this.tab==='agents'?'Configured launchers first':'Web-chat shortcuts'))
    .child(button('launcher-new','+ New',{kind:'plain',onClick:(_e,cx)=>{this.select(null);cx.notify();}})))
   .child(v_flex().id('launcher-list').flex_1().min_h(0).overflow_y_scrollbar().gap(4)
    .when(this.loading,el=>el.child(div().p(10).text_color(t.dim).child('Loading launchers…')))
    .children(rows.map(row=>{
     const id=row.key??row.id,disabled=(this.catalog.hidden_agents??[]).includes(id);
     return v_flex().id(`launcher-${id}`).px(10).py(9).gap(5).rounded(7).cursor_pointer()
      .bg(this.selected===id?t.hover:t.popover).hover(s=>s.bg(t.hover))
      .on_click((_e,cx)=>{this.select(row);cx.notify();})
      .child(h_flex().gap(8).items_center().when(this.tab==='agents',el=>el.child(this.icon(row.icon,t,18,row.tint)))
       .child(div().flex_1().min_w(0).font_medium().text_size(13).truncate().child(row.name??id)))
      .child(h_flex().gap(7).items_center().child(div().flex_1().text_size(11).text_color(t.dim).child(this.tab==='agents'?(disabled?'Hidden from + menu':row.installed?'Installed':'Not installed'):row.url))
       .when(this.tab==='agents',el=>el.child(button(`enable-${id}`,disabled?'Enable':'Disable',{kind:'plain',onClick:(_e,cx)=>{cx.stop_propagation();cx.spawn(async cx=>{try{await workspaceCall('hide-agent',{id,enabled:disabled});this.load(cx);}catch(e){this.error=plainError(e);}cx.notify();});}}))));
    })));
 }
 editor(t){return v_flex().id('launcher-fields').h_full().flex_1().min_w(0).min_h(0).overflow_y_scrollbar().gap(14)
  .child(div().text_size(15).font_medium().child(this.selected?'Edit launcher':'New launcher'))
  .child(this.field('name',t))
  .when(this.tab==='agents',el=>el.child(this.field('id',t)).child(this.field('command',t))
   .child(h_flex().gap(12).items_start().child(div().flex_1().min_w(0).child(this.field('icon',t)))
    .child(v_flex().gap(5).items_center().child(div().text_size(11).text_color(t.dim).child('Preview'))
     .child(div().size(58).rounded(8).border_1().border_color(t.border).flex().items_center().justify_center().child(this.icon(this.fields.icon.value(),t,28,this.rows.find(row=>row.key===this.selected)?.tint))))))
  .when(this.tab==='chats',el=>el.child(this.field('url',t)).child(this.field('profile',t)));
 }
 featureForm(t,cx){
  const space=spaces().find(s=>s.id===this.space);
  return v_flex().id('new-feature-dialog').track_focus(this.handle).size_full().min_h(0).p(20).gap(12).bg(t.popover).text_color(t.foreground)
   .on_key_down(e=>{if(e.key==='escape')closeOverlay(props().overlay);})
   .child(div().flex_none().text_size(18).font_semibold().child('New feature'))
   .child(div().flex_none().truncate().text_size(12).text_color(t.dim).child(space?.name?`In ${space.name}`:'Start a separate feature conversation.'))
   .child(this.field('name',t,'Feature name').flex_none())
   .when(Boolean(this.error),el=>el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
   .child(div().flex_1().min_h(0))
   .child(dialogFooter({onCancel:()=>closeOverlay(props().overlay),primary:{id:'feature-create',label:'Create feature',disabled:!this.fields.name.value().trim()||!space,onClick:(_e,cx)=>this.save(cx)}}));
 }
 render(cx){const t=theme(),simple=this.mode!=='manage';
  if(this.mode==='feature')return this.featureForm(t,cx);
  return v_flex().id('workspace-launchers').track_focus(this.handle).size_full().min_h(0).p(20).gap(16).bg(t.popover).text_color(t.foreground)
   .on_key_down(e=>{if(e.key==='escape')closeOverlay(props().overlay);})
   .child(h_flex().items_center().child(div().flex_1().text_size(18).font_semibold().child(this.mode==='feature'?'Start feature':this.mode==='browser'?'New browser tab':'Manage launchers'))
    .child(button('manage-close','×',{kind:'plain',onClick:()=>closeOverlay(props().overlay)})))
   .when(!simple,el=>el.child(segmented('launcher-tabs',[['agents','Agents'],['chats','Web chats']],this.tab,(tab,_e,cx)=>{this.tab=tab;this.select(null);cx.notify();})))
   .when(Boolean(this.error),el=>el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
   .when(!simple,el=>el.child(h_flex().flex_1().min_h(0).items_stretch().gap(20).child(this.list(t,cx)).child(this.editor(t))))
   .when(simple,el=>el.child(this.field('name',t)))
   .when(this.mode==='browser',el=>el.child(this.field('url',t)).child(this.field('profile',t)))
   .child(h_flex().mt_auto().pt(10).gap(8).items_center()
    .child(button('launcher-save',this.busy?'Saving…':simple?'Open':'Save launcher',{kind:'primary',disabled:this.busy,onClick:(_e,cx)=>this.save(cx)}))
    .when(!simple,el=>el.child(button('launcher-remove','Remove',{kind:'plain',disabled:!this.selected,onClick:(_e,cx)=>this.remove(cx)})))
    .child(div().flex_1()).child(button('launcher-done',simple?'Cancel':'Done',{kind:'plain',onClick:()=>closeOverlay(props().overlay)})));
 }
 close(){for(const field of Object.values(this.fields))field.release();dropKeys(this.holder);}
}
