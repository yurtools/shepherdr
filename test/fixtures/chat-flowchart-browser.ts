// Run against the synthetic Chat fixture with an existing task browser's CDP URL.
// No browser launch, real conversations or sending messages. The browser stays open.
import assert from 'node:assert/strict';
import { chromium, type Locator } from 'playwright-core';
import { join } from 'node:path';

const [cdp, base, shots] = process.argv.slice(2);
assert(cdp && /^http:\/\/127\.0\.0\.1:\d+$/.test(base), 'Supply a task browser CDP URL and synthetic loopback fixture URL');
const browser=await chromium.connectOverCDP(cdp);
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));
assert(page,'Open the fixture in the task browser first');
const shot=async(name:string)=>{if(shots)await page.screenshot({path:join(shots,name+'.png')});};
const card=page.locator('.flowchart-card');
const modal=page.locator('dialog.flowchart-dialog[open]');
const stage=modal.locator('.flowchart-full-viewport');
const metrics=()=>stage.evaluate(el=>({w:el.clientWidth,h:el.clientHeight,sw:el.scrollWidth,sh:el.scrollHeight,x:el.scrollLeft,y:el.scrollTop}));
const waitFit=()=>page.waitForFunction(()=>{const el=document.querySelector('.flowchart-full-viewport');return !!el&&el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1;});
const end=async(label:string)=>{
  await page.keyboard.press('End');
  await page.waitForFunction(name=>{
    const el=document.querySelector('.flowchart-full-viewport');if(!el)return false;
    const t=[...el.querySelectorAll('text')].find(t=>[...t.querySelectorAll('tspan')].map(l=>l.textContent).join(' ')===name);if(!t)return false;
    const r=el.getBoundingClientRect(),b=t.getBoundingClientRect();
    return el.scrollLeft>=el.scrollWidth-el.clientWidth-1&&el.scrollTop>=el.scrollHeight-el.clientHeight-1&&b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom;
  },label,{timeout:5000});
};
const chatTop=(loc:Locator)=>loc.evaluate(el=>{let p=el.parentElement;while(p&&getComputedStyle(p).overflowY!=='auto')p=p.parentElement;return p?.scrollTop??-1;});
const open=async(i:number)=>{
  const button=card.nth(i).getByRole('button',{name:'Expand diagram ↗'});
  await button.scrollIntoViewIfNeeded();await button.focus();const before=await chatTop(button);
  await page.keyboard.press('Enter');await modal.waitFor({state:'visible'});await waitFit();
  return {button,before};
};
const close=async({button,before}:Awaited<ReturnType<typeof open>>)=>{
  await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
  assert(Math.abs(await chatTop(button)-before)<=1,'Closing must not move the conversation');
  assert(await button.evaluate(el=>document.activeElement===el),'Focus must return to the Expand button');
};
try{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'light'});
  await page.goto(base);await card.first().waitFor();
  const more=page.getByRole('button',{name:'Show more',exact:true}).first();if(await more.isVisible())await more.click();
  assert.equal(await card.locator('.flowchart-expand').count(),3,'Historical tall/wide and user previews need Expand');
  for(const overview of await card.locator('.flowchart-overview').all()){
    assert(await overview.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1),'Inline diagrams must not create a nested overflow');
  }
  assert(await card.first().locator('svg').getByText('Final vertical step',{exact:true}).count());
  await card.first().scrollIntoViewIfNeeded();await shot('phone-overview');
  const tall=await open(0);await shot('phone-fit');await modal.getByRole('button',{name:'100%',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.flowchart-pct')?.textContent==='100%');
  assert((await metrics()).sh>(await metrics()).h,'Tall chart scrolls at actual size');
  await end('Final vertical step');await shot('phone-tall-end');
  assert(await stage.getByText('All checks done',{exact:true}).count());
  await close(tall);
  // Second chart in the same historical message opens independently; exact copy
  // includes the original spacing. Inspect source before opening it again.
  const wide=card.nth(1);await wide.getByRole('button',{name:'Show source'}).click();
  const original=await wide.locator('pre').textContent();assert(original?.startsWith('graph LR')&&original.endsWith('  '),'Source retains trailing spaces');
  await wide.getByRole('button',{name:'Show preview'}).click();
  const opened=await open(1);await modal.getByRole('button',{name:'100%',exact:true}).click();
  await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.flowchart-full-viewport')?.scrollLeft===0);
  assert((await metrics()).sw>(await metrics()).w,'Wide chart scrolls at actual size');
  // Real Chromium touch sequence, not assigning scrollLeft or firing fake DOM events.
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const rect=(await stage.boundingBox())!;const y=Math.round(rect.y+rect.height/2), from=Math.round(rect.x+rect.width-40), to=Math.round(rect.x+40);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from,y}]});
  for(let i=1;i<=10;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(from+(to-from)*i/10),y}]});await page.waitForTimeout(25);}
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>Number(document.querySelector('.flowchart-full-viewport')?.scrollLeft)>20);
  console.log('Phone touch swipe moved wide diagram:',await metrics());
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});await session.detach();
  await end('Final horizontal step');await shot('phone-wide-end');
  // A desktop resize preserves the opened drawing and actual scale; Fit then
  // recomputes to the new room. Test arrow/click controls, copy, and return.
  await page.setViewportSize({width:1280,height:800});await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>Number(document.querySelector('.flowchart-full-viewport')?.clientWidth)>1000);
  assert.equal(await modal.locator('.flowchart-pct').textContent(),'100%');
  await modal.getByRole('button',{name:'Fit',exact:true}).click();await waitFit();await shot('desktop-fit');
  await modal.getByRole('button',{name:'100%',exact:true}).click();await modal.getByRole('button',{name:'Zoom in'}).click();
  assert.equal(await modal.locator('.flowchart-pct').textContent(),'125%');
  await page.keyboard.press('Home');await modal.getByRole('button',{name:'Pan right'}).click();
  await page.waitForFunction(()=>Number(document.querySelector('.flowchart-full-viewport')?.scrollLeft)>0);
  await end('Final horizontal step');await shot('desktop-wide-end');
  // The fallback must remain above the top-layer dialog if both clipboard APIs fail.
  await page.evaluate(()=>{
    const oldWrite=navigator.clipboard.writeText,oldExec=document.execCommand;
    Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new Error('synthetic clipboard denial'))});
    document.execCommand=()=>false;
    (window as any).restoreFixtureClipboard=()=>{Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:oldWrite});document.execCommand=oldExec;delete (window as any).restoreFixtureClipboard;};
  });
  await modal.getByRole('button',{name:'Copy code'}).click();
  const manual=modal.locator('[data-copy-manual]');await manual.waitFor();
  assert.equal(await manual.locator('textarea').inputValue(),original);
  await page.keyboard.press('Escape');await manual.waitFor({state:'detached'});assert(await modal.isVisible());
  await page.evaluate(()=>(window as any).restoreFixtureClipboard());
  await modal.getByRole('button',{name:'Copy code'}).click();await modal.getByRole('button',{name:'Copied'}).waitFor();
  await modal.getByRole('button',{name:'Close',exact:true}).click();await modal.waitFor({state:'detached'});
  assert(await opened.button.evaluate(el=>document.activeElement===el));
  const composer=page.getByRole('textbox',{name:'Message fixture'});await composer.focus();await page.keyboard.press('Control+v');
  assert.equal(await composer.inputValue(),original,'Copy from expanded viewer must preserve exact source');await composer.fill('');
  // User chart, invalid chart, ordinary fenced code and streaming completion.
  const user=await open(2);await close(user);
  assert.equal(await card.nth(3).locator('.flowchart-expand').count(),0);
  assert.match(await card.nth(3).locator('.flowchart-error').textContent()??'',/Could not read/);
  assert(await page.getByText('const sample = 42;',{exact:true}).count());
  assert.match(await card.nth(4).locator('.flowchart-error').textContent()??'',/closing fence/);
  await page.evaluate(()=>fetch('/fixture/complete'));
  await card.nth(4).getByRole('button',{name:'Expand diagram ↗'}).waitFor();
  const streamed=await open(4);await close(streamed);
  console.log('PASS: historical/multiple diagrams; fit; keyboard, touch and button pan; both final labels; resize; light/dark; focus and chat position; exact copy; invalid, streamed and ordinary code.');
  process.exit(0);
}catch(e){console.error(e);process.exit(1);}
