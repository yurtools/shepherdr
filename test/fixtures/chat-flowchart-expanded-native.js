// Hidden eager materialization only. No live props, keystrokes, shared state,
// history or overlay; the fixture initializes only the viewer's drawing/focus.
import Viewer from './viewer.js';
import { flowchart, fitCamera, zoomFlowchart, panFlowchart } from './core/chat-flowchart.js';
export default class Fixture extends Viewer {
 init(_props,cx){
  const source='graph LR; A([Start]) --> B{Ready?}; B -->|Yes| C[Publish]; B -->|No| D[Revise]; D --> B; C --> '+Array.from({length:10},(_,i)=>`N${i}[Stage ${i+1}]`).join(' --> ')+' -->|Complete| Z([Final])';
  this.drawing=flowchart(source).drawing;this.code=source;
  if(!this.drawing)throw Error('Synthetic flowchart did not parse');
  this.room={width:410,height:320};
  this.camera=panFlowchart(this.drawing,this.room,zoomFlowchart(this.drawing,this.room,fitCamera(),1),Infinity,Infinity);
  this.handle=cx.focus_handle();
 }
 close(){this.handle?.release();}
}
