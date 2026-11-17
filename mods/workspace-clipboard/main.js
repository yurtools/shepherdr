import { View } from 'gpui-kit';
import { v_flex } from 'gpui-base';
import { props, theme, shared, setShared, closeOverlay } from 'herdr';
import { menuRow } from './ui.js';
import { keepKeys, dropKeys } from './keyholder.js';
export default class ClipboardMenu extends View {
 init(_props,cx){this.handle=cx.focus_handle();this.handle.focus();this.key=`dialog:clipboard:${props()?.overlay}`;keepKeys(this.key);}
 choose(action){const p=props();setShared('workspace.clipboard.request',{...p,action,nonce:Math.random(),at:Date.now()});closeOverlay(p.overlay);}
 render(){const p=props()??{},input=p.kind==='input',selected=p.range&&p.range.start!==p.range.end;
  return v_flex().id('clipboard-menu').track_focus(this.handle).w_full().p(6).bg(theme().popover)
   .on_key_down(e=>{if(e.key==='escape')closeOverlay(p.overlay);})
   .child(menuRow('clipboard-cut','Cut',{disabled:!input||!selected,onClick:()=>this.choose('cut')}))
   .child(menuRow('clipboard-copy',!input&&p.selected===null?'Copy selection: use Ctrl+C':'Copy',{disabled:input?!selected:!p.selected,onClick:()=>this.choose('copy')}))
   .child(menuRow('clipboard-paste','Paste',{disabled:!input,onClick:()=>this.choose('paste')}))
   .child(menuRow('clipboard-select-all','Select all',{disabled:!input,onClick:()=>this.choose('select-all')}))
   .when(!input&&Boolean(p.text),el=>el.child(menuRow('clipboard-copy-message','Copy message',{onClick:()=>this.choose('message')})));
 }
 close(){dropKeys(this.key);}
}
