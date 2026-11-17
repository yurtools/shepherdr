import { launcherAgents } from "./workspace-store.js";
import { View, div } from 'gpui-kit';
import { h_flex, v_flex, Input, InputState } from 'gpui-base';
import { props, theme, closeOverlay, knownAgents, shared, setShared, spaces } from 'herdr';
import { workspaceCall } from './features.js';
import { button, segmented, plainError } from './ui.js';
import { keepKeys, dropKeys } from './keyholder.js';
export default class Launchers extends View {
 init(_props,cx) {
  this.mode=props()?.mode??'manage';this.tab='agents';this.fields={};this.rows=[];this.catalog={chats:[],hidden_agents:[]};
  for(const k of ['id','name','command','icon','url','profile'])this.fields[k]=InputState.new({placeholder:{id:'Unique ID',name:'Name',command:'Launch command',icon:'Icon path',url:'https://…',profile:'Browser profile (default)'}[k]});
  this.handle=cx.focus_handle();this.handle.focus();this.holder=`dialog:launchers:${props()?.overlay}`;keepKeys(this.holder);
  cx.timer.every(1500,()=>keepKeys(this.holder));this.load(cx);
 }
 load(cx){cx.spawn(async cx=>{try{this.catalog=await workspaceCall('catalog');this.rows=launcherAgents(await knownAgents(),this.catalog);}catch(e){this.error=plainError(e);}cx.notify();});}
 select(row){this.selected=row?.id??row?.key??null;for(const k of Object.keys(this.fields))this.fields[k].set_value(k==='command'?(row?.run??[]).map(x=>/^[\w@%+=:,./-]+$/.test(x)?x:JSON.stringify(x)).join(' '):row?.[k]??(k==='id'?row?.key??'':''));}
 save(cx){if(this.busy)return;this.busy=true;cx.spawn(async cx=>{try{
  const value=Object.fromEntries(Object.entries(this.fields).map(([k,v])=>[k,v.value()]));
  if(this.mode==='feature'){
   if(!value.name.trim())throw new Error('Enter a feature name.');
   const space=spaces().find(s=>s.id===props()?.space);
   if(!space)throw new Error('Choose a space.');
   setShared('workspace.feature.request',{create:{name:value.name.trim(),space:space.id,folder:shared('workspace.roots')?.[space.id]??space.folder},at:Date.now(),nonce:Math.random()});closeOverlay(props().overlay);return;
  }
  if(this.mode==='browser'){
   setShared('workspace.browser.request',{url:value.url,name:value.name||'Browser',profile:value.profile||'default',space:spaces().find(s=>s.active)?.id,at:Date.now(),nonce:Math.random()});closeOverlay(props().overlay);return;
  }
  await workspaceCall(this.tab==='agents'?'save-agent':'save-chat',value);this.selected=null;this.select(null);this.load(cx);this.error=null;
 }catch(e){this.error=plainError(e);}finally{this.busy=false;cx.notify();}});}
 remove(cx){if(!this.selected)return;cx.spawn(async cx=>{try{await workspaceCall(this.tab==='agents'?'remove-agent':'remove-chat',{id:this.selected});this.select(null);this.load(cx);}catch(e){this.error=plainError(e);}cx.notify();});}
 field(k){return Input.new(this.fields[k]).w_full().text_size(13);}
 render(cx){const t=theme(),simple=this.mode!=='manage',rows=this.tab==='agents'?this.rows:this.catalog.chats??[];
  return v_flex().id('workspace-launchers').track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
   .on_key_down(e=>{if(e.key==='escape')closeOverlay(props().overlay);})
   .child(h_flex().items_center().child(div().flex_1().text_size(17).font_semibold().child(this.mode==='feature'?'Start feature':this.mode==='browser'?'New browser tab':'Manage launchers')).child(button('manage-close','×',{kind:'plain',onClick:()=>closeOverlay(props().overlay)})))
   .when(!simple,el=>el.child(segmented('launcher-tabs',[['agents','Agents'],['chats','Web chats']],this.tab,(tab,_e,cx)=>{this.tab=tab;this.select(null);cx.notify();})))
   .when(Boolean(this.error),el=>el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
   .when(!simple,el=>el.child(v_flex().id('launcher-list').max_h(210).min_h(0).overflow_y_scroll().gap(3)
    .children(rows.map(row=>h_flex().id(`launcher-${row.key??row.id}`).items_center().gap(5)
      .child(button(`edit-${row.key??row.id}`,row.name,{kind:this.selected===(row.key??row.id)?'secondary':'plain',onClick:(_e,cx)=>{this.select(row);cx.notify();}}))
      .when(this.tab==='agents',el=>el.child(button(`enable-${row.key}`,(this.catalog.hidden_agents??[]).includes(row.key)?'Enable':'Disable',{kind:'plain',onClick:(_e,cx)=>cx.spawn(async cx=>{try{await workspaceCall('hide-agent',{id:row.key,enabled:(this.catalog.hidden_agents??[]).includes(row.key)});this.load(cx);}catch(e){this.error=plainError(e);}cx.notify();})})))))))
   .when(this.mode!=='browser',el=>el.child(this.field('name')))
   .when(!simple&&this.tab==='agents',el=>el.child(this.field('id')).child(this.field('command')).child(this.field('icon')))
   .when(this.mode==='browser'||!simple&&this.tab==='chats',el=>el.child(this.field('url')).child(this.field('profile')))
   .when(!simple,el=>el.child(div().text_size(11).text_color(t.dim).child(this.tab==='agents'?'Launch commands use executable arguments. Disabling hides an entry without changing its account. Removing a built-in hides it.':'Profiles are isolated per space. Use shared:name only when you want to share a login across spaces.')))
   .child(h_flex().mt_auto().gap(8).items_center().child(button('launcher-save',this.busy?'Saving…':simple?'Open':'Save',{kind:'primary',disabled:this.busy,onClick:(_e,cx)=>this.save(cx)}))
    .when(!simple,el=>el.child(button('launcher-new','New',{kind:'plain',onClick:(_e,cx)=>{this.select(null);cx.notify();}})).child(button('launcher-remove','Remove',{kind:'plain',disabled:!this.selected,onClick:(_e,cx)=>this.remove(cx)}))));
 }
 close(){for(const field of Object.values(this.fields))field.release();dropKeys(this.holder);}
}
