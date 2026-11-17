import {test,expect} from 'bun:test';
import {featureActivity,terminalState} from './feature-state.js';
const feature={id:'feature',session:'saved'};
const owner=status=>({state:'live',status,labels:{'herdr.feature':'feature','herdr.role':'feature'}});
const worker=status=>({state:'live',status,labels:{'herdr.feature':'feature','herdr.task':'AB-2'}});
test('native and hc statuses have the same meaning',()=>{
 expect(terminalState(owner('working'))).toBe('working');
 expect(featureActivity(feature,[owner({state:'working'})]).state).toBe('working');
 expect(featureActivity(feature,[owner('working')]).label).toBe('Working');
});
test('a waiting or absent owner does not pause its working workers',()=>{
 for(const all of [[owner('done'),worker('working')],[worker('working')]])
  expect(featureActivity(feature,all)).toEqual({state:'working',label:'Working · 1 worker',workers:1});
});
test('blocked workers need attention and other features cannot change the state',()=>{
 expect(featureActivity(feature,[owner('working'),worker('blocked')]).state).toBe('blocked');
 expect(featureActivity(feature,[{...worker('working'),labels:{'herdr.feature':'other'}}]).state).toBe('paused');
 expect(featureActivity(feature,[{...owner('working'),state:'ended'}]).state).toBe('paused');
 expect(featureActivity({...feature,status:'completed'},[worker('working')]).label).toBe('Completed');
});
