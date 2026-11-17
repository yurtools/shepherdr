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
test('Paste inserts clipboard text into the captured selection, retaining newlines and one undoable replacement',()=>{
 const v=view('hello world');v.clipboardAction({kind:'input',action:'paste',value:'hello world',range:{start:6,end:11}},{read_from_clipboard:()=> 'two\nlines'});expect(v.box.value()).toBe('hello two\nlines');
});
test('reply Copy uses the captured selection after the popup has taken focus',()=>{
 const v=view('unsent draft');let copied='';v.clipboardAction({kind:'reply',action:'copy',selected:'selected reply text'},{write_to_clipboard:(s:string)=>{copied=s}});expect(copied).toBe('selected reply text');expect(v.box.value()).toBe('unsent draft');
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

const Picking=new Function(`return class { ${method('pick')} }`)();
test('Skills in the slash menu opens the picker directly without sending a slash prompt',()=>{
 const v:any=new Picking();let value='/';v.box={set_value:(s:string)=>{value=s},focus(){}};v.pick({name:'skills',skillPicker:true},{notify(){}});expect(value).toBe('$');expect(v.slashOff).toBe(null);
});
test('choosing a /$ suggestion inserts a normal $skill reference',()=>{
 const v:any=new Picking();let value='/$pers';v.box={value:()=>value,set_value:(s:string)=>{value=s},focus(){}};v.pick({name:'persistent-context',skill:true},{notify(){}});expect(value).toBe('$persistent-context ');
});
const MenuHost=new Function('openOverlay',`return class { ${method('clipboardMenu')} }`);
test('right-click captures reply selection before the popup clears native selection and restores the previous text clipboard',()=>{
 let clipboard='previous clipboard',popup:any;
 (globalThis as any).window={dispatch_action:(action:string)=>{expect(action).toBe('shell_root::Copy');clipboard='only the selected words'}};
 const Host=MenuHost((args:any)=>{popup=args;});const v:any=new Host();v.pickKey=()=> 'pane';v.box={value:()=> 'draft',selected_range:()=>({start:0,end:0})};
 v.clipboardMenu('reply',{position:{x:10,y:20}},{stop_propagation(){},read_from_clipboard:()=>clipboard,write_to_clipboard:(s:string)=>{clipboard=s},timer:{after:(_n:number,fn:any)=>fn({read_from_clipboard:()=>clipboard,write_to_clipboard:(s:string)=>{clipboard=s}})}},'the full reply');
 expect(popup.props.selected).toBe('only the selected words');expect(popup.props.text).toBe('the full reply');expect(clipboard).toBe('previous clipboard');
});
