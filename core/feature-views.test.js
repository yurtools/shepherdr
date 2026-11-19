import {expect,test} from 'bun:test';
import {featureViews} from './spaces.js';

const feature={id:'feature',space:'space',name:'Durable feature',tab:'stale-tab',pane:'stale-pane'};
function fixture() {
 return {features:[feature],spaces:[{id:'space',tabs:[{id:'tab'}]}],panes:[{pane:'chat',mod:'chat',tab:'tab'}],
  terminals:[{address:'agent',state:'live',labels:{'herdr.role':'feature','herdr.feature':'feature','herdr.chat':'chat'}}],slots:{},companions:{}};
}
test('feature identity survives startup, status/program/title changes and rebound Chat/Terminal panes',()=>{
 const s=fixture();
 for(const status of ['idle','working','blocked','done',{state:'working',app:'codex'}]) {
  s.terminals[0]={...s.terminals[0],status,program:{name:'Codex'},title:'Changing automatic title'};
  expect(featureViews(s).byTab.get('tab')).toBe(feature);
 }
 s.panes=[{pane:'terminal-pane',terminal:'agent',tab:'tab'}];delete s.terminals[0].labels['herdr.chat'];
 expect(featureViews(s).byPane.get('terminal-pane')).toBe(feature);
 s.panes=[{pane:'replacement-chat',mod:'chat',tab:'tab'}];s.terminals[0].labels['herdr.chat']='replacement-chat';
 expect(featureViews(s).byTab.get('tab')).toBe(feature);
});
test('an agentless or stopped restored chat uses its durable feature slot, never stored record addresses',()=>{
 const s=fixture();s.terminals=[];s.slots={'feature-feature':{feature:'feature',space:'space',tab:'tab',pane:'chat'}};
 expect(featureViews(s).byPane.get('chat')).toBe(feature);
 expect(featureViews({...s,slots:{}}).byTab.size).toBe(0);
 for(const change of [{tab:'stale-tab'},{pane:'stale-pane'},{space:'other'},{feature:'other'}]) {
  expect(featureViews({...s,slots:{'feature-feature':{...s.slots['feature-feature'],...change}}}).byTab.size).toBe(0);
 }
});
test('workers, ordinary agents, foreign spaces and obsolete/reused bindings cannot own a feature tab',()=>{
 const s=fixture();s.slots={'feature-feature':{feature:'feature',space:'space',tab:'tab',pane:'chat'}};
 for(const labels of [
  {'herdr.feature':'feature','herdr.task':'JOB-1'},
  {'herdr.feature':'feature','herdr.role':'worker'},
  {'herdr.feature':'feature','herdr.role':'feature','herdr.task':'JOB-1'},
  {'herdr.role':'coordinator'}, {},
 ]) {
  expect(featureViews({...s,terminals:[{...s.terminals[0],labels:{...labels,'herdr.chat':'chat'}}]}).byTab.size).toBe(0);
 }
 expect(featureViews({...s,features:[{...feature,space:'other'}]}).byTab.size).toBe(0);
 expect(featureViews({...s,spaces:[{...s.spaces[0],machine:'remote'}]}).byTab.size).toBe(0);
});
test('extra feature views and conflicting feature owners leave the host tab name alone',()=>{
 const s=fixture();s.companions={view:{pane:'chat'}};
 expect(featureViews(s).byTab.size).toBe(0);expect(featureViews(s).byPane.get('chat')).toBe(feature);
 s.companions={};s.features.push({...feature,id:'another'});s.panes.push({pane:'another-chat',mod:'chat',tab:'tab'});
 s.terminals.push({address:'another-agent',state:'live',labels:{'herdr.role':'feature','herdr.feature':'another','herdr.chat':'another-chat'}});
 expect(featureViews(s).byTab.size).toBe(0);
});
test('a current live feature view outranks a saved slot pointing to a reused empty chat',()=>{
 const s=fixture();s.spaces[0].tabs.push({id:'reused-tab'});s.panes.push({pane:'reused-chat',mod:'chat',tab:'reused-tab'});
 s.slots={'feature-feature':{feature:'feature',space:'space',tab:'reused-tab',pane:'reused-chat'}};
 expect([...featureViews(s).byTab.keys()]).toEqual(['tab']);expect(featureViews(s).byPane.has('reused-chat')).toBe(false);
});
