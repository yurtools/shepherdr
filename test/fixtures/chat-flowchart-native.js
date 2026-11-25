import { View, div } from 'gpui-kit';
import { nativeFlowchart } from './flowchart.js';
import { flowchart } from './core/chat-flowchart.js';
const source = 'flowchart TD\n A([Start]) --> B{Ready?}\n B -->|Yes| C[Done]\n B -->|No| D[Try again] --> B';
const wide='graph LR\n A[Receive request] --> B[Review] --> C[Approve] --> D[Publish]';
export default class Fixture extends View {
 render(){
  const light={muted:'#52525b',surface:'#fafafa',raised:'#f4f4f5',accent:'#c2410c',foreground:'#09090b'};
  const dark={muted:'#b4b4bf',surface:'#17171a',raised:'#242429',accent:'#fb923c',foreground:'#f4f4f5'};
  const a=flowchart(source), b=flowchart(wide);
  if(!a.drawing||!b.drawing)throw Error('Synthetic flowchart did not parse');
  return div().w(600).children([nativeFlowchart(a.drawing,540,light,'light'),nativeFlowchart(b.drawing,240,dark,'dark')]);
 }
}
