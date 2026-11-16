import { View, div } from 'gpui-kit';
import { v_flex } from 'gpui-base';
import { props, theme, closeOverlay } from 'herdr';
import { spaces } from './live.js';
import { relativeFile, referenceTargets, queueReference, fileActions } from './file-reference.js';
import { menuRow, toast, plainError } from './ui.js';
export default class FileActions extends View {
 init(_props,cx){this.handle=cx.focus_handle();this.handle.focus();}
 copy(value,cx){cx.write_to_clipboard(value);closeOverlay(props()?.overlay);toast({title:'Path copied'});}
 reference(row){try{queueReference(row,props());closeOverlay(props()?.overlay);}catch(e){toast({title:'File was not added',body:plainError(e),level:'error'});}}
 render(cx){
  const p=props()??{},t=theme(),targets=referenceTargets(spaces().find(s=>s.id===p.space));
  return v_flex().id('file-actions').track_focus(this.handle).w_full().max_h(460).p(6).gap(3).bg(t.popover)
    .on_key_down(e=>{if(e.key==='escape')closeOverlay(p.overlay);})
    .child(div().px(8).py(6).truncate().text_size(12).text_color(t.dim).child(p.targets?'Reference in chat · choose a draft':relativeFile(p.root,p.file??'File')))
    .when(!p.targets,el=>el
      .child(menuRow('file-reference','Reference in chat…',{onClick:()=>{closeOverlay(p.overlay);fileActions({file:p.file,on:p.on,root:p.root},null,true);}}))
      .child(menuRow('file-copy-relative','Copy relative path',{onClick:(_e,cx)=>this.copy(relativeFile(p.root,p.file),cx)}))
      .child(menuRow('file-copy-absolute','Copy absolute path',{onClick:(_e,cx)=>this.copy(p.file,cx)})))
    .when(p.targets,el=>el.child(v_flex().min_h(0).overflow_y_scroll().children(targets.map((target,i)=>v_flex()
      .child(menuRow(`file-chat-${i}`,target.label+(target.last?' · last used':''),{disabled:Boolean(p.on&&p.on!==target.on),onClick:()=>this.reference(target)}))
      .child(div().px(9).pb(5).text_size(11).text_color(t.dim).child(target.account)))))
      .when(!targets.length,el=>el.child(div().p(10).text_size(12).text_color(t.dim).child('Open an Assistant or agent in Chat mode in this space first.'))));
 }
}
