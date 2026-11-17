import {div} from 'gpui-kit';
import {TextareaState,Textarea,v_flex,h_flex} from 'gpui-base';
import {ROLES} from './core/settings.js';
import {button} from './ui.js';
const text=p=>String(p.box.value()??'');
export function initSpaceInstructions(view,cx) {
 view.spacePrompts={};
 for(const role of ROLES){
  const prompt=view.spacePrompts[role.id]={box:TextareaState.new({placeholder:''}),saved:'',gen:0};
  prompt.box.set_auto_grow(3,10);
  prompt.box.on('change',(_e,cx)=>{const gen=++prompt.gen;cx.notify();cx.timer.after(500,cx=>{if(gen===prompt.gen)saveSpaceInstructions(view,cx);});});
  prompt.box.on('blur',(_e,cx)=>saveSpaceInstructions(view,cx));
 }
}
export function resetSpaceInstructions(view) {
 view.promptScope=view.scope;view.promptOpen=null;
 for(const [role,p] of Object.entries(view.spacePrompts??{})){
  p.gen++;const value=view.cfg.spaces?.[view.scope]?.instructions?.[role];p.saved=typeof value==='string'?value:'';p.box.set_value(p.saved);
 }
}
export function flushSpaceInstructions(view) {
 const scope=view.promptScope;
 const changes=Object.entries(view.spacePrompts??{}).filter(([,p])=>text(p)!==p.saved).map(([role,p])=>({role,p,text:text(p)}));
 if(!scope||!changes.length)return view.promptWriting??Promise.resolve(true);
 const write=async()=>{
  const ok=await view.apply(next=>{
   const own=next.spaces?.[scope]??view.target(next,scope),values={...(own.instructions??{})};
   for(const {role,text} of changes){if(text.trim())values[role]=text;else delete values[role];}
   if(Object.keys(values).length)own.instructions=values;else delete own.instructions;
  });
  if(view.promptScope===scope){
   if(ok){for(const {p,text} of changes)p.saved=text;view.promptError=null;}
   else view.promptError='Space instructions could not be saved. Your text is still in the editor.';
  }
  return ok;
 };
 view.promptWriting=(view.promptWriting??Promise.resolve()).then(write);return view.promptWriting;
}
function saveSpaceInstructions(view,cx){cx.spawn(async cx=>{await flushSpaceInstructions(view);cx.notify();});}
export function spaceInstructionButton(view,role,t) {
 const p=view.spacePrompts?.[role.id];if(!view.scope||!p)return div();
 return button(`space-instructions-${role.id}`,text(p).trim()?'Space instructions · Added':'Space instructions',{kind:'plain',disabled:view.promptScope!==view.scope,onClick:(_e,cx)=>{view.promptOpen=view.promptOpen===role.id?null:role.id;if(view.promptOpen)p.box.focus();cx.notify();}});
}
export function spaceInstructionEditor(view,role,t) {
 const p=view.spacePrompts[role.id];
 return v_flex().id(`space-instructions-editor-${role.id}`).w_full().px(16).py(12).gap(8).bg(t.raised)
  .child(h_flex().items_center().gap(8).child(div().flex_1().text_size(13).font_medium().child(`${role.title}: additional instructions for this space`))
   .child(button(`space-instructions-clear-${role.id}`,'Clear',{kind:'plain',disabled:!text(p),onClick:(_e,cx)=>{p.box.set_value('');saveSpaceInstructions(view,cx);cx.notify();}})))
  .child(div().text_size(12).text_color(t.dim).child('Effective prompt: global instructions + these space instructions. Used on the next fresh conversation or task start.'))
  .child(div().p(8).rounded(6).border_1().border_color(t.border).bg(t.background).child(Textarea.new(p.box).w_full().text_size(13)))
  .when(Boolean(view.promptError),el=>el.child(div().text_size(12).text_color(t.blocked).child(view.promptError)));
}
