import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';

// Native owners carry per-window module state. Keep the fixture out of other suites' caches.
test('native Terminal defaults, role starts and delayed adoption pass in an isolated process',()=>{
 const result=Bun.spawnSync([process.execPath,'test',fileURLToPath(new URL('../test/native/agent-defaults.test.ts',import.meta.url))],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),stdout:'pipe',stderr:'pipe'});
 if(result.exitCode)throw new Error(new TextDecoder().decode(result.stdout)+new TextDecoder().decode(result.stderr));
 expect(result.exitCode).toBe(0);
});
