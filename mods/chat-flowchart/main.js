// An eager, modal viewer, outside Chat's deferred virtual list. No scroll
// handle or native path survives the viewer; the prepared drawing is data.
import { View, div } from 'gpui-kit';
import { v_flex, h_flex, Button } from 'gpui-base';
import { props, theme, closeOverlay, settings } from 'herdr';
import { flowchartCanvas } from './flowchart.js';
import { fitCamera, flowCamera, panFlowchart, zoomFlowchart, FLOW_ZOOM_STEP, FLOW_WORDS } from './core/chat-flowchart-geometry.js';
import { keepKeys, dropKeys } from './keyholder.js';

const zoomOf = () => Number(settings()?.zoom)||1;
export default class FlowchartViewer extends View {
  init(_props,cx) {
    const p=props()??{};
    this.drawing=p.drawing; this.code=p.code;
    this.camera=fitCamera(); this.room={width:1,height:1};
    this.handle=cx.focus_handle();
    this.holder=`dialog:flowchart:${p.overlay}`;
    keepKeys(this.holder);
    cx.timer.every(1500,()=>keepKeys(this.holder));
    cx.timer.after(0,()=>this.handle.focus());
  }
  close() { this.copyTimer?.cancel(); dropKeys(this.holder); this.handle?.release(); }
  dismiss() { closeOverlay(props()?.overlay); }
  view() { return flowCamera(this.drawing,this.room,this.camera); }
  fit() { this.camera=fitCamera(); }
  zoom(scale,at) { this.camera=zoomFlowchart(this.drawing,this.room,this.camera,scale,at); }
  pan(dx,dy) { this.camera=panFlowchart(this.drawing,this.room,this.camera,dx,dy); }
  step(x,y) { this.pan(x*this.room.width*0.8,y*this.room.height*0.8); }
  size(size,cx) {
    const z=zoomOf(),width=Math.max(1,Math.floor(size.width/z)),height=Math.max(1,Math.floor(size.height/z));
    if(width===this.room.width&&height===this.room.height)return;
    this.room={width,height};
    // Preserve the current diagram point, but clamp to the new viewport.
    this.camera=panFlowchart(this.drawing,this.room,this.camera,0,0);
    cx.notify();
  }
  copy(cx) {
    cx.write_to_clipboard(this.code);this.copied=true;
    this.copyTimer?.cancel();this.copyTimer=cx.timer.after(1400,(cx)=>{this.copied=false;cx.notify();});
  }
  key(e,cx) {
    const k=e.key, mod=e.modifiers?.control||e.modifiers?.platform;
    if(k==='escape')this.dismiss();
    else if(k==='0')this.fit();
    else if(k==='1')this.zoom(1);
    else if(k==='+'||k==='=')this.zoom(this.view().scale*FLOW_ZOOM_STEP);
    else if(k==='-')this.zoom(this.view().scale/FLOW_ZOOM_STEP);
    else if(k==='left')this.step(-1,0);
    else if(k==='right')this.step(1,0);
    else if(k==='up'||k==='pageup')this.step(0,-1);
    else if(k==='down'||k==='pagedown')this.step(0,1);
    else if(k==='home')this.pan(-Infinity,-Infinity);
    else if(k==='end')this.pan(Infinity,Infinity);
    else if(k==='c'&&mod)this.copy(cx);
    else return;
    cx.stop_propagation();cx.notify();
  }
  wheel(e,cx) {
    const z=zoomOf(),view=this.view(), dx=-(e.delta?.x??0)/z,dy=-(e.delta?.y??0)/z;
    if(e.modifiers?.control||e.modifiers?.platform) {
      const p=e.local_position;
      this.zoom(view.scale*Math.exp(Math.max(-1,Math.min(1,-dy*0.004))),p&&{x:p.x/z,y:p.y/z});
    } else if(e.modifiers?.shift||(!dx&&view.height<=this.room.height&&view.width>this.room.width))this.pan(dx||dy,0);
    else this.pan(dx,dy);
    cx.stop_propagation();cx.notify();
  }
  pinch(e,cx) {
    const z=zoomOf(),p=e.local_position;
    this.zoom(this.view().scale*Math.max(0.1,1+e.delta),p&&{x:p.x/z,y:p.y/z});
    cx.stop_propagation();cx.notify();
  }
  down(e,cx) {
    this.handle.focus();this.drag=e.position;cx.stop_propagation();
  }
  move(e,cx) {
    if(!this.drag)return;
    const z=zoomOf();this.pan((this.drag.x-e.position.x)/z,(this.drag.y-e.position.y)/z);
    this.drag=e.position;cx.stop_propagation();cx.notify();
  }
  btn(id,label,t,action,description=label) {
    return Button.new(id).flex_none().min_w(32).h(32).px(8).rounded(5).bg(t.raised).text_color(t.foreground).text_size(12)
      .accessibility_label(description).tab_stop(true).hover(el=>el.bg(t.hover)).focus(el=>el.border_1().border_color(t.accent))
      .on_click((_e,cx)=>{cx.stop_propagation();action(cx);cx.notify();}).child(label);
  }
  render() {
    const t=theme();
    if(!this.drawing)return v_flex().size_full().bg(t.background).child(this.btn('close',FLOW_WORDS.close,t,()=>this.dismiss()));
    const view=this.view(),btn=(id,label,act,desc)=>this.btn(id,label,t,act,desc);
    return v_flex().id('flowchart-viewer').size_full().min_w(0).min_h(0).bg(t.background).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e,cx)=>this.key(e,cx))
      .child(h_flex().w_full().flex_none().px(8).py(6).gap(4).items_center()
        .child(div().flex_1().min_w(0).truncate().font_medium().text_size(13).child('Mermaid flowchart'))
        .child(btn('copy',this.copied?'Copied':'Copy',cx=>this.copy(cx),this.copied?'Copied':'Copy code'))
        .child(btn('close',FLOW_WORDS.close,()=>this.dismiss())))
      .child(h_flex().w_full().flex_none().px(8).gap(4).items_center()
        .child(btn('fit',FLOW_WORDS.fit,()=>this.fit()))
        .child(btn('actual',FLOW_WORDS.actual,()=>this.zoom(1)))
        .child(btn('minus','−',()=>this.zoom(view.scale/FLOW_ZOOM_STEP),FLOW_WORDS.zoomOut))
        .child(btn('plus','+',()=>this.zoom(view.scale*FLOW_ZOOM_STEP),FLOW_WORDS.zoomIn))
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(`${Math.round(view.scale*100)}%`)))
      .child(h_flex().w_full().flex_none().px(8).py(4).gap(4).items_center()
        .child(btn('left','←',()=>this.step(-1,0),FLOW_WORDS.panLeft))
        .child(btn('up','↑',()=>this.step(0,-1),FLOW_WORDS.panUp))
        .child(btn('down','↓',()=>this.step(0,1),FLOW_WORDS.panDown))
        .child(btn('right','→',()=>this.step(1,0),FLOW_WORDS.panRight))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child('Scroll or drag to pan · Arrow keys')))
      .child(div().id('flowchart-stage').relative().w_full().flex_1().min_h(0).overflow_hidden().bg(t.surface)
        .when(view.width>this.room.width||view.height>this.room.height,el=>this.drag?el.cursor_grabbing():el.cursor_grab())
        .on_size_change((size,cx)=>this.size(size,cx))
        .on_mouse_down('left',(e,cx)=>this.down(e,cx))
        .on_mouse_move((e,cx)=>this.move(e,cx))
        .on_mouse_up('left',()=>{this.drag=null;})
        .on_hover(on=>{if(!on)this.drag=null;})
        .on_scroll_wheel((e,cx)=>this.wheel(e,cx))
        .on_pinch((e,cx)=>this.pinch(e,cx))
        .when(this.room.width>1&&this.room.height>1,el=>el.child(div().absolute().left(view.left).top(view.top).w(view.width).h(view.height)
          .child(flowchartCanvas(this.drawing,view,t)))));
  }
}
