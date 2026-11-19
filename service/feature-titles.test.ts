import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';

// The real tabs mod imports dirs/local/bridge, whose module state belongs to one window.
// Isolate these native fixtures so their fake home cannot prime other suites' path caches.
test('native feature title render and lifecycle fixtures pass in an isolated Bun process',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const fixture=fileURLToPath(new URL('../test/native/feature-titles.test.ts',import.meta.url));
 const result=Bun.spawnSync([process.execPath,'test',fixture],{cwd:root,stdout:'pipe',stderr:'pipe'});
 if(result.exitCode!==0)throw new Error(new TextDecoder().decode(result.stdout)+new TextDecoder().decode(result.stderr));
 expect(result.exitCode).toBe(0);
});
