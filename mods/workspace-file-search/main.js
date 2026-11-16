import { View, div } from 'gpui-kit';
import { v_flex, Input, InputState } from 'gpui-base';
import { props, exec, appHome, theme, closeOverlay } from 'herdr';
import * as fs from 'fs/promises';
import { queueReference, referenceTargets } from './file-reference.js';
import { spaces } from './live.js';
import { keepKeys, dropKeys } from './keyholder.js';
import { menuRow, plainError } from './ui.js';
export default class FileSearch extends View {
 init(_props,cx){
  this.rows=[];this.selected=0;this.loading=true;this.holder=`dialog:project-files:${props()?.overlay??'picker'}`;
  this.handle=cx.focus_handle();this.handle.focus();keepKeys(this.holder);cx.timer.every(1500,()=>keepKeys(this.holder));
  this.search=InputState.new({placeholder:'Search project files…'});this.search.on('change',(_e,cx)=>{this.selected=0;cx.notify();});this.search.focus();cx.timer.after(150,()=>this.search.focus());
  cx.spawn(async cx=>{try{const code=await fs.readFile(`${appHome()}/mods/workspace-file-search/bin/herdr-project-files`,'utf8');const r=await exec('python3',['-c',code,props()?.root??''],{on:props()?.on??null,timeout:10000});const out=JSON.parse(r.stdout);if(r.code!==0||out.error)throw new Error(out.error||r.stderr);this.rows=out.files;this.root=out.root;this.limited=out.limited;}catch(e){this.error=plainError(e);}this.loading=false;cx.notify();});
 }
 matches(){const q=(this.search.value()??'').trim().toLowerCase();return this.rows.filter(p=>!q||p.toLowerCase().includes(q)).sort((a,b)=>Number(b.split('/').pop().toLowerCase().startsWith(q))-Number(a.split('/').pop().toLowerCase().startsWith(q))).slice(0,80);}
 choose(file){if(!file)return;const p=props(),space=spaces().find(s=>s.id===p.space),target=referenceTargets(space).find(x=>x.pane===p.pane);if(!target){this.error='That chat closed. Open the file picker from another chat.';return;}queueReference(target,{file:`${this.root}/${file}`,root:this.root,on:p.on??null,token:p.token});closeOverlay(p.overlay);}
 render(cx){const t=theme(),rows=this.matches();return v_flex().id('project-file-picker').track_focus(this.handle).size_full().p(12).gap(8).bg(t.popover)
  .on_key_down((e,cx)=>{if(e.key==='escape')closeOverlay(props()?.overlay);else if(e.key==='down')this.selected=Math.min(rows.length-1,this.selected+1);else if(e.key==='up')this.selected=Math.max(0,this.selected-1);else if(e.key==='enter')this.choose(rows[this.selected]);cx.notify();})
  .child(div().font_semibold().child('Reference a project file'))
  .child(Input.new(this.search).w_full())
  .child(div().text_size(11).text_color(t.dim).child('Adds a file to this draft. Enter selects; Escape closes.'))
  .child(v_flex().id('project-file-results').flex_1().min_h(0).overflow_y_scroll()
   .when(this.loading,el=>el.child(div().p(8).child('Loading project files…')))
   .when(Boolean(this.error),el=>el.child(div().p(8).text_color(t.blocked).child(this.error)))
   .children(rows.map((file,i)=>menuRow(`project-file-${i}`,file,{onClick:()=>this.choose(file)}).when(i===this.selected,el=>el.bg(t.selected))))
   .when(!this.loading&&!this.error&&!rows.length,el=>el.child(div().p(8).text_color(t.dim).child('No matching files.'))))
  .when(this.limited,el=>el.child(div().text_size(11).text_color(t.dim).child('Listing limited to 5,000 files. Files also offers direct references.')));}
 close(){this.search?.release();dropKeys(this.holder);}
}
