import {expect,test,mock} from 'bun:test';
import {fakeHerdr} from './fake-herdr';
import {fakeGpuiBase,fakeGpuiKit} from './fake-gpui';
import {appendInstructions,spaceInstructions} from '../core/instructions.js';
mock.module('herdr',()=>fakeHerdr({}));mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
const {flushSpaceInstructions}=await import('../mods/shepherdr-settings/space-instructions.js');
test('space instructions append to the latest global prompt and never replace or mutate its configuration',()=>{
 const cfg={everywhere:{coordinator:{agent:'codex',profile:'second'}},spaces:{a:{instructions:{coordinator:'Only A',feature:'Feature A'}},b:{instructions:{coordinator:'Only B'}}}};
 const before=JSON.stringify(cfg);expect(appendInstructions('GLOBAL ONE',spaceInstructions(cfg,'a','coordinator'))).toBe('GLOBAL ONE\n\n## Space-specific instructions\n\nOnly A\n');
 expect(appendInstructions('GLOBAL TWO',spaceInstructions(cfg,'a','coordinator'))).toContain('GLOBAL TWO\n\n');expect(spaceInstructions(cfg,'b','coordinator')).toBe('Only B');expect(spaceInstructions(cfg,'a','worker')).toBe('');expect(JSON.stringify(cfg)).toBe(before);
 expect(appendInstructions('global\n','')).toBe('global\n');
});
function view(){let value='New space instructions';const p={saved:'',box:{value:()=>value}};
 const v:any={scope:'a',promptScope:'a',cfg:{everywhere:{coordinator:{agent:'codex',profile:'account-2'}},spaces:{a:{folder:'/correct/project',instructions:{reviewer:'Keep reviewer'}},b:{instructions:{coordinator:'Other space'}}}},spacePrompts:{coordinator:p},target:(cfg:any,scope:string)=>cfg.spaces[scope]};
 v.apply=async(edit:any)=>{edit(v.cfg);return true};return {v,p,set:(s:string)=>{value=s}};
}
test('autosave and Clear change only the selected space role, preserving global accounts and other role prompts',async()=>{
 const {v,p,set}=view();await flushSpaceInstructions(v);expect(v.cfg.spaces.a.instructions).toEqual({coordinator:'New space instructions',reviewer:'Keep reviewer'});expect(p.saved).toBe('New space instructions');
 set('');await flushSpaceInstructions(v);expect(v.cfg.spaces.a.instructions).toEqual({reviewer:'Keep reviewer'});expect(v.cfg.spaces.b.instructions.coordinator).toBe('Other space');expect(v.cfg.everywhere.coordinator.profile).toBe('account-2');
});
test('a queued save retains the old scope even after the settings scope switches',async()=>{
 const {v}=view();const pending=flushSpaceInstructions(v);v.scope='b';v.promptScope='b';await pending;
 expect(v.cfg.spaces.a.instructions.coordinator).toBe('New space instructions');expect(v.cfg.spaces.b.instructions.coordinator).toBe('Other space');
});
test('failed writes retain the draft and retry without marking it saved',async()=>{
 const {v,p}=view();v.apply=async()=>false;expect(await flushSpaceInstructions(v)).toBe(false);expect(p.saved).toBe('');expect(p.box.value()).toBe('New space instructions');expect(v.promptError).toContain('could not be saved');
 v.apply=async(edit:any)=>{edit(v.cfg);return true};expect(await flushSpaceInstructions(v)).toBe(true);expect(p.saved).toBe('New space instructions');
});
test('Everywhere does not write a space instruction draft',async()=>{
 const {v}=view();v.promptScope=null;v.apply=async()=>{throw Error('must not write')};await expect(flushSpaceInstructions(v)).resolves.toBe(true);
});

test('prompt saves preserve existing space metadata instead of recomputing the project folder',async()=>{
 const {v}=view();v.target=()=>{throw Error('must not replace existing metadata')};await flushSpaceInstructions(v);expect(v.cfg.spaces.a.folder).toBe('/correct/project');
});
