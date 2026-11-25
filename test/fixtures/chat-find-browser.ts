// Interaction regression against chat-find-web.ts, using the existing task browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { join } from 'node:path';
const [cdp, base, shots] = process.argv.slice(2);
assert(cdp && /^http:\/\/127\.0\.0\.1:\d+$/.test(base));
const browser = await chromium.connectOverCDP(cdp);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(base));
assert(page, 'Open the synthetic fixture in the task browser first');
const search = page.getByRole('searchbox', {name:'Find in chat'});
const status = page.locator('[role=search] [role=status]');
const wait = (text:string) => status.getByText(text, {exact:true}).count().then(async count => {
  if (!count) await page.waitForFunction(w => document.querySelector('[role=search] [role=status]')?.textContent === w, text, {timeout:10000});
});
const active = () => page.evaluate(() => {
  const highlight = CSS.highlights.get('find-active');
  const r = highlight && [...highlight][0];
  if (!r) return null;
  const el = r.startContainer.parentElement!;
  const row = el.closest<HTMLElement>('[data-whole],[data-msg]')!;
  let scroll = el.parentElement;
  while (scroll && getComputedStyle(scroll).overflowY !== 'auto') scroll = scroll.parentElement;
  const b = r.getBoundingClientRect(), s = scroll?.getBoundingClientRect();
  return {text:r.toString(), id:row.dataset.msg ?? row.dataset.whole, offset:r.startOffset,
    visible:!!s && b.top >= s.top-1 && b.bottom <= s.bottom+1, insideSource:!!el.closest('pre'), total:(CSS.highlights.get('find')?.size ?? 0)+1};
});
const expectActive = async (id:string,text:string) => {
  await page.waitForFunction(({id,text}) => {
    const r = [...(CSS.highlights.get('find-active') ?? [])][0];
    if (!r) return false;
    const row = r.startContainer.parentElement?.closest<HTMLElement>('[data-whole],[data-msg]');
    return (row?.dataset.msg ?? row?.dataset.whole) === id && r.toString() === text;
  },{id,text});
  await page.waitForTimeout(250);
  const a=await active();assert(a?.visible, `Selected occurrence not visible: ${JSON.stringify(a)}`);return a;
};
const query = async (q:string, count:string) => { await search.fill(q); await wait(count); };
const step=async (n=1)=>{for(let i=0;i<n;i++)await search.press('Enter');};
const shot=async (name:string)=>{if(shots)await page.screenshot({path:join(shots,name+'.png')});};
try {
  await page.setViewportSize({width:1280,height:800});await page.goto(base+"/?place=fixture%2Ffind");
  await page.getByText('Person: Needle, literal punctuation [a+b] and café. Needle.',{exact:true}).waitFor();
  await page.keyboard.press('Control+f');await search.waitFor();
  await query('needle','1 of 10');assert.equal((await expectActive('human','Needle'))?.total,10);
  await step(2);await wait('3 of 10');await expectActive('agent','needle');await shot('desktop-inline');
  await step(5);await wait('8 of 10');const code=await expectActive('long','NEEDLE');assert(code.insideSource);assert(code.offset>500);
  await page.setViewportSize({width:390,height:844});await expectActive('long','NEEDLE');await shot('phone-code-middle');
  await step();await wait('9 of 10');const last=await expectActive('long','needle');assert(last.offset>code.offset);await shot('phone-code-last');
  await search.press('Shift+Enter');await wait('8 of 10');assert.equal((await expectActive('long','NEEDLE')).offset,code.offset);
  await page.getByRole('button',{name:'Search earlier'}).click();await wait('10 of 12');assert.equal((await expectActive('long','NEEDLE')).offset,code.offset);
  await page.evaluate(async()=>{await fetch('/fixture/stream');});await wait('10 of 13');assert.equal((await expectActive('long','NEEDLE')).offset,code.offset);await shot('phone-paged');
  await query('Omega','1 of 1');assert((await expectActive('diagram','Omega')).insideSource);await shot('phone-diagram-source');
  const source=await page.locator('.flowchart-source code').textContent();assert(source?.endsWith('  '));
  await page.locator('.flowchart-card').getByRole('button',{name:'Copy code'}).click();
  await page.evaluate(()=>{const input=document.createElement('textarea');input.id='fixture-copy';input.style.cssText='position:fixed;left:8px;top:8px;z-index:1000';document.body.append(input);input.focus();});
  await page.keyboard.press('Control+v');assert.equal(await page.locator('#fixture-copy').inputValue(),source,'Copy must keep the original diagram source');
  await page.locator('#fixture-copy').evaluate(el=>el.remove());
  await query('needle Done','1 of 1');assert(!(await expectActive('diagram','needle Done')).insideSource);assert(await page.getByText('Matching diagram labels',{exact:true}).isVisible());
  await page.emulateMedia({colorScheme:'dark'});await shot('phone-diagram-label-dark');
  await query('hidden-target','1 of 1');assert((await expectActive('agent','hidden-target')).insideSource);assert.equal(await page.getByRole('link',{name:'readable link'}).count(),1);
  await query('[a+b]','1 of 1');await expectActive('human','[a+b]');
  await query('CAFÉ','1 of 5');await expectActive('human','café');
  await query('nonexistent search word','No matches');assert.equal(await active(),null);await shot('phone-no-match');
  await search.press('Escape');await search.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>CSS.highlights.has('find')||CSS.highlights.has('find-active')),false);
  await page.getByRole('button',{name:'Find in chat',exact:true}).click();await search.waitFor();assert.equal(await search.inputValue(),'');
  await query('needle','1 of 13');await search.press('Escape');
  await page.setViewportSize({width:1280,height:800});await page.getByRole('button',{name:'Second Feature',exact:true}).click();
  await page.getByText('Another Feature: needle once.',{exact:true}).waitFor();await page.keyboard.press('Control+f');await search.waitFor();await query('needle','1 of 1');await expectActive('human','needle');
  await page.evaluate(async()=>{await fetch('/fixture/large');});
  await page.getByText('Retained message 799.',{exact:true}).waitFor();
  await search.fill('Retained');await search.fill('Bulkmarker');await wait('1 of 4');await expectActive('bulk-0','Bulkmarker');
  await search.press('F3');await wait('2 of 4');await expectActive('bulk-200','Bulkmarker');
  await page.evaluate(async()=>{await fetch('/fixture/session');});await page.getByText('Replacement session, no old words.',{exact:true}).waitFor();
  await search.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>CSS.highlights.has('find-active')),false);
  console.log('Real browser: 10 initial occurrences, distinct inline/code/source ranges; exact middle and last code hits visible; 2 prepended and 1 streamed hit retained active location; hidden-link source, punctuation, Unicode, no match, close/reopen, diagram label, exact source Copy, touch header, 800-message cancellation, F3 and session replacement passed.');
} finally { await browser.close(); }
