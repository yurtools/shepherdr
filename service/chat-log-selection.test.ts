import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CODEX_LOG_PICKER} from '../core/chat-log.js';
test('the worker root rollout wins over guardian files regardless of descriptor order',()=>{
 const dir=mkdtempSync(join(tmpdir(),'shepherdr-rollouts-'));
 try{
  const guardian=join(dir,'rollout-guardian.jsonl'),worker=join(dir,'rollout-worker.jsonl');
  writeFileSync(guardian,JSON.stringify({type:'session_meta',payload:{source:{subagent:{other:'guardian'}}}})+'\n');
  writeFileSync(worker,JSON.stringify({type:'session_meta',payload:{source:'cli'}})+'\n');
  const run=(paths:string[])=>Bun.spawnSync(['python3','-c',CODEX_LOG_PICKER],{stdin:new TextEncoder().encode(paths.join('\n'))});
  for(const paths of [[guardian,worker],[worker,guardian]])expect(run(paths).stdout.toString().trim()).toBe(worker);
  expect(run([guardian]).stdout.toString()).toBe('');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
