import {afterEach,expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
function method(name:string){const a=source.indexOf(`  ${name}(`);return source.slice(a,source.indexOf('\n  }',a)+4);}
const originalWindow=(globalThis as any).window;
afterEach(()=>{if(originalWindow===undefined)delete (globalThis as any).window;else (globalThis as any).window=originalWindow;});
let notes:any[]=[];
const Controls=new Function('toast',`return class { ${method('clipboardAction')} }`)((n:any)=>notes.push(n));
function view(value:string){const v:any=new Controls();let text=value,range:any={start:0,end:0};v.box={value:()=>text,set_selected_range:(r:any)=>{range=r},replace:(next:string)=>{text=text.slice(0,range.start)+next+text.slice(range.end)},focus(){}};v.saveSoon=()=>{};return v;}
test('Cut edits only the captured selection as one native edit and copies its Unicode text',()=>{
 const v=view('hello 😀 world');let copied="";v.clipboardAction({kind:'input',action:'cut',value:'hello 😀 world',range:{start:6,end:8}},{write_to_clipboard:(s:string)=>{copied=s}});
 expect(copied).toBe('😀');expect(v.box.value()).toBe('hello  world');
});
test('a stale clipboard menu does not delete a changed draft',()=>{
 const v=view('new draft');notes=[];v.clipboardAction({kind:'input',action:'cut',value:'old draft',range:{start:0,end:3}},{});expect(v.box.value()).toBe('new draft');expect(notes[0].title).toBe('Text changed');
});
test('Paste uses the native input action, retaining the existing attachment/paste hooks',()=>{
 const actions:string[]=[];(globalThis as any).window={dispatch_action:(s:string)=>actions.push(s)};
 const v=view('draft');v.clipboardAction({kind:'input',action:'paste',value:'draft',range:{start:5,end:5}},{});expect(actions).toEqual(['input::Paste']);
});
const Delivery=new Function('slash',`return class { ${method('deliver')} }`)({});
test('/status is routed before reply quoting or a worker approval card',()=>{
 const v:any=new Delivery();v.kind='codex';v.phase='ready';v.asks=[{id:'permission'}];let called=0;v.nativeStatus=()=>called++;
 v.deliver({text:'/status',quote:{text:'old reply'},files:[]},{});expect(called).toBe(1);
});
test('/skills opens skill selection rather than becoming an agent prompt',()=>{
 const v:any=new Delivery();v.kind='codex';let text='';v.box={set_value:(s:string)=>{text=s},focus(){}};
 v.deliver({text:'/skills',files:[]},{notify(){}});expect(text).toBe('$');
});
const Workers=new Function(`return class { ${method('workerTasks')} }`)();
test('worker actions stay with their Feature Assistant, while the space Assistant owns unassigned workers',()=>{
 const v:any=new Workers();v.assistant=()=> 'space';v.spaceTasks=[{space:'space',ref:'TASK-1',live:[{address:'main'}]},{space:'space',ref:'TASK-2',feature:'feature-a',live:[{address:'a'}]},{space:'space',ref:'TASK-3',feature:'feature-b',live:[{address:'b'}]}];
 expect([...v.workerTasks().keys()]).toEqual(['main']);v.feature='feature-a';expect([...v.workerTasks().keys()]).toEqual(['a']);
});
