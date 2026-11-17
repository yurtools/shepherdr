import {test,expect} from 'bun:test';
import {approvalOrigin,approvalDecision} from './approval-history.js';
test('history distinguishes human, saved rule and delegated decision sources',()=>{
 for(const [source,label] of [['user','You · once'],['user-rule','You · saved rule'],['rule','Saved rule'],['assistant','Assistant review']])expect(approvalOrigin({source})).toBe(label);
 expect(approvalOrigin({source:'codex-review'})).toContain('final result not reported');
 expect(approvalDecision({decision:'delegated'})).toBe('Sent for review');
 expect(approvalOrigin({})).toBe('Unknown approval source');
});
