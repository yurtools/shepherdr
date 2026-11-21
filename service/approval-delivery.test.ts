import {expect,test} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {permissionStatus,requestHash,words} from '../core/asks.js';
import {Compat} from './compat.ts';
import {Asks} from './asks.ts';

test('real helper hand-back race and Advice persistence reach native and web conversions unchanged',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'approval-delivery-'));
 const run=Bun.spawnSync(['python3','test/fixtures/approval-delivery.py',folder]);
 expect(run.exitCode).toBe(0);
 const f=JSON.parse(run.stdout.toString()),before=process.env.HERDR_APP_HOME;
 process.env.HERDR_APP_HOME=f.app;
 try{
  const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
  const at=source.indexOf('  async readAsks('),method=source.slice(at,source.indexOf('\n  }',at)+4);
  const C=new Function('exec','readTextFile','words','permissionStatus',`return class {${method}}`)(async()=>({stdout:f.id+'.json\n'}),async(p:string)=>{try{return readFileSync(p,'utf8')}catch{return null}},words,permissionStatus);
  const native:any=new C();Object.assign(native,{addr:'fixture-worker',askDir:join(f.app,'data/chat-asks'),asks:[],cards:{keep(){}},askAlert(){},askEnded(){}});
  const check=async()=>{
   await native.readAsks({notify(){}});
   const service=new Asks();(service as any).read();
   const web:any=new Compat().question(service.of('fixture-worker')[0],'fixture-chat');
   expect(web.approval).toEqual(native.asks[0].approval);
   expect(web.approval.detail).toBe('Assistant asks you: '+f.rationale);
   expect(web.requestHash).toBe(f.requestHash);
   expect(web.approval.advice).toMatchObject({requestHash:f.requestHash,owner:'fixture-owner',ownerType:'feature'});
   expect(web.choices.map((c:any)=>c.label)).toEqual(['Allow','Deny']);
   expect(existsSync(join(f.app,'data/chat-asks/ans',f.id+'.json'))).toBe(false);
   return web;
  };
  writeFileSync(f.path.replace('.json','.advice'),JSON.stringify(f.advicePending));
  expect((await check()).approval.advice.state).toBe('pending');
  writeFileSync(f.path.replace('.json','.advice'),JSON.stringify(f.advice));
  const ready=await check();expect(ready.approval.advice.text).toContain('may replace');
  // Refresh/reopen creates new readers from persisted state, not an echoed string.
  native.asks=[];expect((await check()).approval).toEqual(ready.approval);
  // Reused ID with different content cannot inherit either explanation.
  writeFileSync(f.path,JSON.stringify({...f.request,session_id:'replacement',tool_input:{command:'git push'}}));
  await native.readAsks({notify(){}});expect(native.asks[0].approval.state).toBe('unknown');expect(native.asks[0].approval.advice).toBeUndefined();
  expect(f.pending&&f.reviewUnchanged).toBe(true);expect(requestHash(f.request)).toBe(f.requestHash);
 }finally{if(before===undefined)delete process.env.HERDR_APP_HOME;else process.env.HERDR_APP_HOME=before;rmSync(folder,{recursive:true,force:true});}
});
