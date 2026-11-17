import {expect,test,mock} from 'bun:test';
import {fakeHerdr} from './fake-herdr';
mock.module('herdr',()=>fakeHerdr({}));
const {launcherAgents,executeTerminalClipboard}=await import('../lib/workspace-store.js');
const {skillSuggestions}=await import('../mods/chat/slash.js');
import {commandList,match} from '../core/slash.js';
test('configured account launchers appear first even when not returned by knownAgents',()=>{
 const known=[{key:'claude',name:'Claude',installed:true},{key:'codex',name:'Codex',installed:true},{key:'unused',name:'Unused',installed:false}];
 const configured={key:'codex-account-2',name:'Codex (Account 2)',run:['/account-two'],icon:'icons/codex.svg',installed:true};
 expect(launcherAgents(known,{agents:[configured]})[0]).toEqual(configured);
 expect(launcherAgents([],{agents:[configured]})).toEqual([configured]);
});
test('skill suggestions execute for $, /$, and filtered /$ without a missing local match import',()=>{
 const skills=[{name:'persistent-context',about:'Remember'},{name:'review',about:'Review'}];
 expect(skillSuggestions('$',skills)).toHaveLength(2);expect(skillSuggestions('/$',skills)).toHaveLength(2);
 expect(skillSuggestions('/$pers',skills)?.map(s=>s.name)).toEqual(['persistent-context']);
 expect(match(commandList('codex'),'').map(c=>c.name)).toContain('skills');
});
test('terminal Paste focuses the original pane before using the argument-free native command',async()=>{
 const calls:any[]=[];const io=async(...args:any[])=>{calls.push(args);return {code:0,stdout:'{}'}};
 await executeTerminalClipboard({command:'terminal.paste',pane:'original-pane',terminal:'t2'},io,[{pane:'original-pane',terminal:'t2'}]);
 expect(calls[0][1]).toEqual(['do','pane.focus','{"pane":"original-pane"}']);expect(calls[1][1]).toEqual(['do','terminal.paste']);
});
test('a closed or replaced terminal cannot receive a stale menu Paste',async()=>{
 let calls=0;await expect(executeTerminalClipboard({command:'terminal.paste',pane:'original-pane',terminal:'t2'},async()=>{calls++;return {code:0}},[{pane:'original-pane',terminal:'different'}])).rejects.toThrow('no longer open');expect(calls).toBe(0);
});
