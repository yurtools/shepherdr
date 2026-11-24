import { beforeEach, afterEach, expect, mock, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fakeHerdr } from './fake-herdr';
import { fakeGpuiBase, fakeGpuiKit } from './fake-gpui';

let root:string, calls:any[], pending:Promise<any>[], cx:any;
mock.module('herdr',()=>fakeHerdr({appHome:()=>root, exec:async(command:string,args:string[])=>{
 calls.push([command,args]);const process=Bun.spawn([command,...args],{stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,code]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);return{stdout,stderr,code};
}}));
mock.module('gpui-kit',()=>fakeGpuiKit());mock.module('gpui-base',()=>fakeGpuiBase());
const {PdfPreview}=await import('../lib/pdf-view.js');
const helper=resolve('lib/pdf-render.py');
const fixture=await readFile(resolve('test/fixtures/pdf/two-pages.pdf'));
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'shepherdr-pdf-'));calls=[];pending=[];
 cx={notify(){},spawn(fn:any){const promise=Promise.resolve(fn(cx));pending.push(promise);return promise;}};
});
afterEach(async()=>{await Promise.all(pending);await rm(root,{recursive:true,force:true});});
async function settled(){for(let i=0;i<pending.length;i++)await pending[i];}

test('actual native controller loads pages, notices external edits, and removes its cache on close',async()=>{
 const path=join(root,'report.pdf');await writeFile(path,fixture);
 const pdf=new PdfPreview(path,{helper});pdf.load(cx);await settled();expect(pdf.pages).toBe(2);
 const initial=pdf.result;pdf.turn(1,cx);await settled();expect(pdf.page).toBe(2);
 expect(await readFile(pdf.result.image)).not.toEqual(await readFile(initial.image));
 await writeFile(path,Buffer.from(fixture.toString().replaceAll('PDF preview','New preview')));
 pdf.check(cx);await settled();expect(pdf.result.version).not.toBe(initial.version);
 expect((await readdir(join(root,'data/pdf-preview',pdf.token))).length).toBeLessThanOrEqual(2);
 await pdf.dispose();expect(await readdir(join(root,'data/pdf-preview'))).toEqual([]);
});
test('closing during an actual render ignores the late result and leaves no cache',async()=>{
 const path=join(root,'report.pdf');await writeFile(path,fixture);
 const pdf=new PdfPreview(path,{helper});pdf.load(cx);await pdf.dispose();await settled();
 expect(pdf.closed).toBe(true);expect(pdf.result).toBeNull();
 expect(await readdir(join(root,'data/pdf-preview')).catch(()=>[])).toEqual([]);
});
test('rapid navigation coalesces to the latest page and never leaves rendering busy',async()=>{
 const path=join(root,'report.pdf');await writeFile(path,fixture);
 const pdf=new PdfPreview(path,{helper});pdf.pages=2;pdf.load(cx);pdf.turn(1,cx);pdf.turn(-1,cx);pdf.turn(1,cx);await settled();
 expect(pdf.result.page).toBe(2);expect(pdf.busy).toBe(false);expect(calls.length).toBeLessThanOrEqual(2);await pdf.dispose();
});
test('remote files never invoke local rendering and corrupt files stop with a recoverable error',async()=>{
 const remote=new PdfPreview('/project/report.pdf',{helper,on:'other'});remote.load(cx);await settled();expect(calls.length).toBe(0);expect(remote.error).toContain('Remote');await remote.dispose();
 const path=join(root,'bad.pdf');await writeFile(path,'corrupt');const pdf=new PdfPreview(path,{helper});pdf.load(cx);await settled();
 expect(pdf.error).toContain('corrupt');expect(pdf.busy).toBe(false);await pdf.dispose();
});
