import { expect, test } from 'bun:test'
import { pasted } from './paste.ts'
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0))
function data(files: File[], text = '', html = '') { return { files: files as unknown as FileList, types: ['Files', ...(text ? ['text/plain'] : []), ...(html ? ['text/html'] : [])], getData: (t: string) => t === 'text/plain' ? text : t === 'text/html' ? html : '' } }
for (const rich of [false, true]) test(`real PNG bytes survive ${rich ? 'bitmap + text/HTML' : 'screenshot-only'} paste and renaming`, async () => {
  const files = pasted(data([new File([png], 'image.png', { type: 'image/png' })], rich ? 'source URL' : '', rich ? '<img src="https://example.invalid/picture">' : ''))
  expect(files).toHaveLength(1); expect(files[0].name).toMatch(/^screenshot-.*\.png$/); expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(png)
})
test('text, HTML and copied file URLs without file payloads remain normal text', () => {
  for (const text of ['hello', 'file:///tmp/a%20b.png', '']) expect(pasted(data([], text, '<b>hello</b>'))).toEqual([])
  expect(pasted(null)).toEqual([])
})
test('several images and a named copied file keep their independent contents and names', async () => {
  const f = new File(['notes'], 'notes.txt', { type: 'text/plain' })
  const got = pasted(data([new File([png], 'image.png', { type: 'image/png' }), new File([png], 'image.png', { type: 'image/png' }), f], 'metadata', '<img>'))
  expect(got).toHaveLength(3); expect(got[0].name).not.toBe(got[1].name); expect(got[2]).toBe(f)
  expect(new Uint8Array(await got[1].arrayBuffer())).toEqual(png)
})
