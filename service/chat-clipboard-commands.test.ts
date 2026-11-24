import {afterEach,expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {element} from './fake-gpui';
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
function method(name:string){const a=source.indexOf(`  ${name}(`);return source.slice(a,source.indexOf('\n  }',a)+4);}
const originalWindow=(globalThis as any).window;
afterEach(()=>{if(originalWindow===undefined)delete (globalThis as any).window;else (globalThis as any).window=originalWindow;});
let notes:any[]=[];
const Controls=new Function('toast','attach',`return class { ${method('clipboardAction')} ${method('clipboardOwner')} ${method('pasteClipboard')} }`)((n:any)=>notes.push(n),{fromClipboard:async()=>[],drop(){}});
function view(value:string){const v:any=new Controls();let text=value,range:any={start:0,end:0};v.jobs=[];v.files=[];v.box={value:()=>text,selected_range:()=>range,set_selected_range:(r:any)=>{range=r},replace:(next:string)=>{text=text.slice(0,range.start)+next+text.slice(range.end)},focus(){}};v.saveSoon=()=>{};return v;}
function pasteCx(v:any,text:string){const cx:any={notify(){},read_from_clipboard:()=>text,spawn:(fn:any)=>{v.jobs.push(fn(cx))}};return cx;}

test('Cut edits only the captured selection as one native edit and copies its Unicode text',()=>{
 const v=view('hello 😀 world');let copied="";v.clipboardAction({kind:'input',action:'cut',value:'hello 😀 world',range:{start:6,end:8}},{write_to_clipboard:(s:string)=>{copied=s}});
 expect(copied).toBe('😀');expect(v.box.value()).toBe('hello  world');
});
test('a stale clipboard menu does not delete a changed draft',()=>{
 const v=view('new draft');notes=[];v.clipboardAction({kind:'input',action:'cut',value:'old draft',range:{start:0,end:3}},{});expect(v.box.value()).toBe('new draft');expect(notes[0].title).toBe('Text changed');
});
test('Paste inserts clipboard text into the captured selection, retaining newlines and one undoable replacement',async()=>{
 const v=view('hello world');v.clipboardAction({kind:'input',action:'paste',value:'hello world',range:{start:6,end:11}},pasteCx(v,'two\nlines'));await Promise.all(v.jobs);expect(v.box.value()).toBe('hello two\nlines');
});
test('Copy message copies the reply rather than the composer draft',()=>{
 const v=view('unsent draft');let copied='';v.clipboardAction({kind:'reply',action:'message',text:'complete reply'},{write_to_clipboard:(s:string)=>{copied=s}});expect(copied).toBe('complete reply');expect(v.box.value()).toBe('unsent draft');
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
// The native SDK dispatches ShellAction, not Rust's shell_root::Copy. Opening
// a menu must never pretend that the existing clipboard is a reply selection.
const menuSource=readFileSync(new URL('../mods/workspace-clipboard/main.js',import.meta.url),'utf8');
const choose=menuSource.match(/ choose\(action\)\{[^\n]+\}/)![0];
const MenuClass=new Function('props','setShared','closeOverlay',`return class { ${choose} }`);
const Pending=new Function('openOverlay','appWindow','setShared',`return class { ${method('clipboardMenu')} ${method('takeClipboardRequest')} }`);
function menuHost(range={start:0,end:0}){
 let popup:any,request:any,closed:any;const Host=Pending((p:any)=>{popup=p},()=>({platform:'linux'}),(_k:string,v:any)=>{request=v});
 const v:any=new Host();v.pickKey=()=> 'pane';v.box={value:()=> 'unsent draft',selected_range:()=>range};
 return {v,get popup(){return popup},get request(){return request},get closed(){return closed},choose(action:string){const Menu=MenuClass(()=>popup.props,(_k:string,r:any)=>{request=r},(id:string)=>{closed=id});new Menu().choose(action)}};
}
test('opening a reply menu never dispatches a fake native copy or reads/replaces clipboard data',()=>{
 let dispatched=0;(globalThis as any).window={dispatch_action:()=>{dispatched++}};
 const h=menuHost();h.v.clipboardMenu('reply',{position:{x:10,y:20}},{stop_propagation(){}},'reply');
 expect(dispatched).toBe(0);expect(h.popup.height).toBe(76);expect(h.popup.props.canMessage).toBe(true);expect(h.popup.props.copyKey).toBe('Ctrl+C');
});
test('the popup and persisted action signal contain no reply, draft, clipboard or selection text',()=>{
 const h=menuHost({start:0,end:6});h.v.clipboardMenu('input',{position:{x:1,y:2}},{stop_propagation(){}},'private reply');
 expect(h.popup.props.canCopy).toBe(true);h.choose('copy');
 for(const data of [h.popup.props,h.request]){expect(JSON.stringify(data)).not.toContain('unsent draft');expect(JSON.stringify(data)).not.toContain('private reply');expect(data.range).toBeUndefined();expect(data.value).toBeUndefined();expect(data.selected).toBeUndefined();}
});
test('menu Copy message reaches its original chat once, using only its local snapshot',()=>{
 const h=menuHost();h.v.clipboardMenu('reply',{position:{x:1,y:2}},{stop_propagation(){}},'exact reply');h.choose('message');
 const actions:any[]=[];h.v.clipboardAction=(r:any)=>actions.push(r);let notified=0;
 h.v.takeClipboardRequest(h.request,{notify(){notified++}});h.v.takeClipboardRequest(h.request,{notify(){notified++}});
 expect(actions).toHaveLength(1);expect(actions[0]).toMatchObject({kind:'reply',action:'message',text:'exact reply'});expect(notified).toBe(1);
});
test('a stale menu or another chat cannot apply an action to the current draft',()=>{
 const h=menuHost();h.v.clipboardMenu('input',{position:{x:1,y:2}},{stop_propagation(){}});h.choose('cut');const old=h.request;
 h.v.clipboardMenu('input',{position:{x:1,y:2}},{stop_propagation(){}});let applied=0;h.v.clipboardAction=()=>applied++;
 h.v.takeClipboardRequest(old,{notify(){}});h.choose('cut');h.v.takeClipboardRequest({...h.request,target:'other-pane'},{notify(){}});expect(applied).toBe(0);
});
test('a Paste chosen from the menu replaces the original composer selection',async()=>{
 const h=menuHost({start:0,end:6}),input=view('unsent draft');h.v.clipboardAction=input.clipboardAction.bind(input);
 h.v.clipboardMenu('input',{position:{x:1,y:2}},{stop_propagation(){}});h.choose('paste');
 h.v.takeClipboardRequest(h.request,pasteCx(input,'new'));await Promise.all(input.jobs);expect(input.box.value()).toBe('new draft');
});

test('reply menus offer Copy message and an honest keyboard hint; composer menus retain all edit actions',()=>{
 const a=menuSource.indexOf(' render(){'),render=menuSource.slice(a,menuSource.indexOf('\n close()',a));let p:any={kind:'reply',canMessage:true,copyKey:'Ctrl+C'},rows:any[]=[];
 const C=new Function('props','v_flex','theme','closeOverlay','menuRow',`return class { ${render} }`)(()=>p,()=>element('v_flex'),()=>({}),()=>{},(id:string,label:string,options:any)=>{rows.push({id,label,...options});return element('row')});
 const v:any=new C();v.render();expect(rows.map(r=>r.label)).toEqual(['Copy message','Copy selected text']);expect(rows[0].disabled).toBe(false);expect(rows[1]).toMatchObject({disabled:true,hint:'Ctrl+C'});expect(rows[1].onClick).toBeUndefined();
 rows=[];p={kind:'input',canCopy:true};v.render();expect(rows.map(r=>r.label)).toEqual(['Cut','Copy','Paste','Select all']);expect(rows.every(r=>!r.disabled&&typeof r.onClick==='function')).toBe(true);
});

const ReplyText=new Function(`return class { ${method('clipboardText')} }`)();
test('Copy message resolves the complete reply when right-clicking a rendered chunk or code block',()=>{
 const v:any=new ReplyText();v.conv={items:[{id:'reply',text:'Full reply\n```js\nconst x=1;\n```\nEnding'}]};
 expect(v.clipboardText({id:'reply:1',blk:'reply',text:'one rendered chunk'})).toBe(v.conv.items[0].text);
 expect(v.clipboardText({id:'reply:c1',blk:'reply',code:'const x=1;'})).toBe(v.conv.items[0].text);
 expect(v.clipboardText({id:'pending',text:'pending text'})).toBe('pending text');expect(v.clipboardText(undefined)).toBe('');
});
