import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {element} from './fake-gpui';
const source=readFileSync(new URL('../mods/workspace-launchers/main.js',import.meta.url),'utf8');
function method(name:string){const a=source.indexOf(` ${name}(`),next:Record<string,string>={init:'load',featureForm:'render',save:'remove'};return source.slice(a,source.indexOf(`\n ${next[name]}(`,a));}
const labels={id:'Launcher ID',name:'Name',command:'Launch command',icon:'Icon path',url:'Website URL',profile:'Browser profile'};
function fieldState(options:any){let value=options?.value??'';return {value:()=>value,set_value:(s:string)=>{value=s},on(){},focus(){}};}
test('New Feature does not load or select agent launchers and leaves its name blank',()=>{
 const C=new Function('props','InputState','LABELS','keepKeys',`return class { ${method('init')} }`)(()=>({overlay:'overlay'}),{new:fieldState},labels,()=>{});
 const v:any=new C();let loads=0;v.load=()=>loads++;
 v.init({mode:'feature',space:'space'},{focus_handle:()=>({focus(){}}),timer:{every(){},after(){}}});
 expect(loads).toBe(0);expect(v.fields.name.value()).toBe('');expect(v.space).toBe('space');expect(v.loading).toBe(false);
});
test('New Feature has a persistent Feature name label and one explicit Create feature action',()=>{
 let footer:any,label:any;const C=new Function('spaces','props','closeOverlay','v_flex','div','dialogFooter',`return class { ${method('featureForm')} }`)(()=>[{id:'space',name:'Demo'}],()=>({}),()=>{},()=>element('v_flex'),()=>element('div'),(options:any)=>{footer=options;return element('footer')});
 const v:any=new C();v.space='space';v.fields={name:{value:()=>''}};v.field=(_key:string,_t:any,title:string)=>{label=title;return element('field')};v.featureForm({},{});
 expect(label).toBe('Feature name');expect(footer.primary.label).toBe('Create feature');expect(footer.primary.disabled).toBe(true);
 v.fields.name.value=()=> 'New behavior';v.featureForm({},{});expect(footer.primary.disabled).toBe(false);
});
test('creating a feature sends the entered name to its space before closing, with no work owned by the closing dialog',()=>{
 const events:any[]=[];const C=new Function('spaces','shared','setShared','closeOverlay','props',`return class { ${method('save')} }`)(()=>[{id:'space',folder:'/repo'}],()=>null,(...a:any[])=>events.push(['request',...a]),(id:string)=>events.push(['close',id]),()=>({overlay:'dialog'}));
 const v:any=new C();v.mode='feature';v.space='space';v.fields={name:{value:()=> '  Real feature  '}};v.save({spawn(){throw Error('must not spawn work from a closing dialog')}});
 expect(events[0][0]).toBe('request');expect(events[0][2].create).toMatchObject({name:'Real feature',space:'space',folder:'/repo'});expect(events[1]).toEqual(['close','dialog']);
});
