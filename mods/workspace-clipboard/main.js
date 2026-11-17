import { View } from 'gpui-kit';
import { v_flex } from 'gpui-base';
import { props, theme, shared, setShared, closeOverlay } from 'herdr';
import { menuRow } from './ui.js';
import { keepKeys, dropKeys } from './keyholder.js';
export default class ClipboardMenu extends View {
 init(_props,cx){this.handle=cx.focus_handle();this.handle.focus();this.key=`dialog:clipboard:${props()?.overlay}`;keepKeys(this.key);}
 choose(action){const p=props();setShared('workspace.clipboard.request',{target:p.target,request:p.request,action,nonce:Math.random(),at:Date.now()});closeOverlay(p.overlay);}
 render(){const p=props()??{},input=p.kind==='input';
  const menu=v_flex().id('clipboard-menu').track_focus(this.handle).w_full().p(6).bg(theme().popover)
   .on_key_down(e=>{if(e.key==='escape')closeOverlay(p.overlay);});
  if(!input)return menu
   .child(menuRow('clipboard-copy-message','Copy message',{disabled:!p.canMessage,onClick:()=>this.choose('message')}))
   .child(menuRow('clipboard-selection-hint','Copy selected text',{disabled:true,hint:p.copyKey??'Ctrl+C'}));
  return menu
   .child(menuRow('clipboard-cut','Cut',{disabled:!p.canCopy,onClick:()=>this.choose('cut')}))
   .child(menuRow('clipboard-copy','Copy',{disabled:!p.canCopy,onClick:()=>this.choose('copy')}))
   .child(menuRow('clipboard-paste','Paste',{onClick:()=>this.choose('paste')}))
   .child(menuRow('clipboard-select-all','Select all',{onClick:()=>this.choose('select-all')}));
 }
 close(){dropKeys(this.key);}
}
