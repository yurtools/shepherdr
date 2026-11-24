// Actual built-viewer regression test. Attach only to the supplied task browser's CDP endpoint.
// Usage: bun test/browser/pdf-preview.ts <CDP URL> <fixture viewer URL> <screenshot folder>
// The fixture URL must serve the built artifact viewer and safe PDF fixtures as documented.
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const [endpoint, fixture, output] = process.argv.slice(2)
assert(endpoint && fixture && output, 'Supply task CDP URL, isolated fixture URL and screenshot folder')
assert.equal(new URL(fixture).hostname, '127.0.0.1')
await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith(new URL(fixture).origin))
assert(page, 'Open the fixture in the task browser first; this test creates no browser or tab')
const requests: string[] = []
page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
const route = (id: string) => `${fixture}?artifact=${id}`
const rendered = async (number: number) => {
  await page.waitForSelector(`canvas[aria-label="PDF page ${number}"]`, { timeout: 25000 })
  assert.equal(await page.locator('canvas').count(), 1)
  const size = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({ w: canvas.width, h: canvas.height }))
  assert(size.w * size.h <= 4_000_000)
}
const hash = () => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
const check = (message: string) => console.log(`PASS ${message}`)
try {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(route('two-pages')); await rendered(1)
  const first = await hash()
  await page.screenshot({ path: join(output, 'page-one-desktop.png') })
  await page.getByRole('button', { name: 'Next PDF page', exact: true }).click(); await rendered(2)
  assert.notEqual(await hash(), first); check('two real pages paint different content')
  await page.screenshot({ path: join(output, 'page-two-desktop.png') })
  const fit = await page.locator('canvas').evaluate(canvas => canvas.style.width)
  await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click()
  await page.waitForFunction(before => document.querySelector('canvas')?.style.width !== before && !!document.querySelector('canvas'), fit)
  const zoom = await page.locator('canvas').evaluate(canvas => canvas.style.width)
  assert.notEqual(zoom, fit)
  await page.getByRole('button', { name: '125% · Fit', exact: true }).click(); await rendered(2)
  await page.waitForFunction(before => document.querySelector('canvas')?.style.width === before, fit)
  assert.equal(await page.locator('canvas').evaluate(canvas => canvas.style.width), fit); check('zoom and Fit change the actual page canvas')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => (document.querySelector('canvas')?.getBoundingClientRect().width || 1000) < 390)
  await rendered(2)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: join(output, 'page-two-phone.png') }); check('phone layout fits without horizontal page overflow')
  await page.getByRole('button', { name: 'Reload PDF', exact: true }).click(); await rendered(1); check('Reload reopens at the first page')
  await page.evaluate(() => { const spacer = document.createElement('div'); spacer.id = 'test-spacer'; spacer.style.height = '3000px'; document.querySelector('figure')!.after(spacer); spacer.scrollIntoView({ block: 'end' }) })
  await page.waitForFunction(() => !document.querySelector('canvas'))
  await expectWorkers(0); check('off-screen close releases the canvas and parser worker')
  for (const id of ['locked', 'corrupt']) {
    await page.goto(route(id)); await page.getByRole('alert').waitFor()
    assert.equal(await page.locator('canvas').count(), 0)
    assert(await page.getByRole('link', { name: 'Open original' }).isVisible())
    if (id === 'locked') await page.screenshot({ path: join(output, 'password-phone.png') })
    await expectWorkers(0); check(`${id} PDF shows an error, keeps Open original and releases its worker`)
  }
  await page.goto(route('large')); await rendered(1)
  assert((await page.locator('body').innerText()).includes('Page 1 / 1200'))
  await page.getByRole('button', { name: 'Next PDF page', exact: true }).click(); await rendered(2)
  check('a 1200-page file renders one page at a time and stays navigable')
  assert(requests.every(url => new URL(url).hostname === '127.0.0.1')); check('all document and dependency requests remain local')
  await page.addInitScript(() => {
    const mode = new URLSearchParams(location.search).get('workerfail')
    if (!mode) return
    const RealWorker = window.Worker
    window.Worker = class extends RealWorker {
      constructor() {
        const source = mode === 'boot' ? 'throw Error("fixture worker boot failure")' : 'setInterval(()=>{},1000)'
        super(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' })
      }
    }
  })
  for (const mode of ['boot', 'stalled']) {
    await page.goto(`${route('two-pages')}&workerfail=${mode}`)
    await page.getByRole('alert').waitFor({ timeout: 25000 })
    assert(await page.getByRole('link', { name: 'Open original' }).isVisible())
    await expectWorkers(0); check(`${mode} worker fails with a fallback and releases the real worker`)
  }
  console.log('All browser PDF checks passed; exit 0')
} finally { await browser.close() }
async function expectWorkers(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (page!.workers().length === count) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(page!.workers().length, count)
}
