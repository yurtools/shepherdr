// Run the native composer methods unchanged, with only the host and OS read boundary substituted.
import { beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../mods/chat/main.js', import.meta.url), 'utf8')
function method(name: string) { const a = source.indexOf(`  ${name}(`); if (a < 0) return ''; return source.slice(a, source.indexOf('\n  }', a) + 4) }
let read: () => Promise<any[]>, reads = 0, dropped: any[], notes: any[]
const file = (path = '/fixture/pasted.png') => ({ path, name: path.split('/').pop(), image: true, temp: true })
const attach = { fromClipboard: () => { reads++; return read() }, drop: (f: any) => dropped.push(f) }
const Native = new Function('attach', 'toast', `return class { ${['clipboardOwner', 'pasteClipboard', 'clipboardAction', 'addFiles'].map(method).join('\n')} }`)(attach, (n: any) => notes.push(n))
function view(value = '', text: string | undefined = undefined) {
  const v: any = new Native(); let current = value, range = { start: 0, end: value.length }
  const jobs: Promise<any>[] = [], replacements: string[] = []
  v.addr = 'tfixture'; v.kind = 'codex'; v.draftFile = 'draft-a'; v.originKey = 'account-a'; v.files = []; v.quote = { text: 'quoted reply' }; v.saveSoon = () => {}
  v.box = { value: () => current, set_value: (s: string) => { current = s }, selected_range: () => range, set_selected_range: (r: any) => { range = r }, focus() {}, replace: (s: string) => { replacements.push(s); current = current.slice(0, range.start) + s + current.slice(range.end) } }
  const cx: any = { read_from_clipboard: () => text, notify() {}, spawn: (fn: any) => { const p = fn(cx); jobs.push(p); return p } }
  return { v, cx, jobs, replacements, done: async () => { await Promise.all(jobs) } }
}
beforeEach(() => { reads = 0; dropped = []; notes = []; read = async () => [file()] })
test('screenshot-only paste attaches without changing text, selection or quote', async () => {
  const h = view('my draft'); const quote = h.v.quote
  h.v.pasteClipboard(h.cx); await h.done()
  expect(h.v.files).toEqual([file()]); expect(h.v.box.value()).toBe('my draft'); expect(h.v.quote).toBe(quote); expect(h.replacements).toEqual([])
})
test('bitmap plus text/HTML metadata attaches the bitmap rather than its source text', async () => {
  const h = view('draft', 'https://example.invalid/image'); h.v.pasteClipboard(h.cx); await h.done()
  expect(h.v.files).toHaveLength(1); expect(h.v.box.value()).toBe('draft')
})
test('context-menu Paste uses the same image path even with text in the clipboard', async () => {
  const h = view('draft', 'image metadata'); h.v.clipboardAction({ kind: 'input', action: 'paste', value: 'draft', range: { start: 0, end: 5 } }, h.cx); await h.done()
  expect(h.v.files).toHaveLength(1); expect(h.v.box.value()).toBe('draft')
})
test('ordinary text replaces the captured Unicode selection in one edit', async () => {
  read = async () => []; const h = view('a 😀 z', 'two\nlines')
  h.v.clipboardAction({ kind: 'input', action: 'paste', value: 'a 😀 z', range: { start: 2, end: 4 } }, h.cx); await h.done()
  expect(h.v.box.value()).toBe('a two\nlines z'); expect(h.replacements).toEqual(['two\nlines']); expect(h.v.files).toEqual([])
})
test('duplicate paste notifications while extraction is pending attach once', async () => {
  let resolve!: (f: any[]) => void; read = () => new Promise(r => { resolve = r }); const h = view()
  h.v.pasteClipboard(h.cx); h.v.pasteClipboard(h.cx); expect(reads).toBe(1)
  resolve([file()]); await h.done(); expect(h.v.files).toHaveLength(1)
  read = async () => [file('/fixture/pasted-second.png')]; h.v.pasteClipboard(h.cx); await h.done(); expect(h.v.files).toHaveLength(2)
})
for (const field of ['addr', 'kind', 'draftFile', 'originKey', 'slot', 'companion']) test(`async extraction cannot attach to a changed ${field}`, async () => {
  let resolve!: (f: any[]) => void; read = () => new Promise(r => { resolve = r }); const h = view('draft', 'metadata')
  h.v.pasteClipboard(h.cx); h.v[field] = 'different'; resolve([file()]); await h.done()
  expect(h.v.files).toEqual([]); expect(h.v.box.value()).toBe('draft'); expect(dropped).toEqual([file()]); expect(h.v.clipboardPaste).toBe(null)
})
test('editing or sending while extraction runs cannot replace the new draft', async () => {
  let resolve!: (f: any[]) => void; read = () => new Promise(r => { resolve = r }); const h = view('draft', 'text')
  h.v.pasteClipboard(h.cx); h.v.box.set_value('new draft'); resolve([file()]); await h.done()
  expect(h.v.files).toEqual([]); expect(h.v.box.value()).toBe('new draft'); expect(dropped).toHaveLength(1)
})
test('unavailable/unsupported image reads report the failure and retain ordinary clipboard text', async () => {
  read = async () => { throw new Error('reader unavailable') }; const h = view('', 'plain text')
  h.v.pasteClipboard(h.cx); await h.done(); expect(h.v.error).toBe('reader unavailable'); expect(notes[0].level).toBe('error'); expect(h.v.box.value()).toBe('plain text')
})
test('missing formats with no text leave a draft untouched', async () => {
  read = async () => []; const h = view('draft'); h.v.pasteClipboard(h.cx); await h.done(); expect(h.v.box.value()).toBe('draft'); expect(h.v.files).toEqual([])
})
test('keyboard and paste_other route into the transaction; Ctrl+V and Cmd+V override the text-only Input binding', () => {
  expect(source).toContain('this.box.on("paste_other", (_e, cx) => this.pasteClipboard(cx))')
  expect(source).toContain('.on_action("chat_paste", take((cx) => this.pasteClipboard(cx)))')
  const a = source.indexOf('      const keys = []'), b = source.indexOf('      try { cx.bind_keys(keys)', a)
  const keys: any[] = new Function(source.slice(a, b) + ';return keys;')()
  for (const ctx of ['Input', 'TextArea', 'Textarea']) for (const chat of ['chat_composer', 'chat_slash', 'chat_recall', 'chat_stop']) for (const key of ['ctrl-v', 'cmd-v']) expect(keys).toContainEqual({ keystroke: key, action: 'chat_paste', context: `${chat} > ${ctx}` })
})
test('a known image read failure never replaces the draft with image metadata', async () => {
  read = async () => { throw Object.assign(new Error('image read failed'), { clipboardImage: true }) }; const h = view('draft', 'source URL')
  h.v.pasteClipboard(h.cx); await h.done(); expect(h.v.box.value()).toBe('draft'); expect(h.v.files).toEqual([]); expect(notes[0].level).toBe('error')
})
const Sending = new Function('mentions', 'note', 'toast', `return class { ${method('send')} }`)({ expand: (x: string) => x, expandTasks: (x: string) => x }, () => {}, (n: any) => notes.push(n))
for (const text of ['', 'Please inspect this']) test(`Send retains the attachment and quote ${text ? 'with' : 'without'} text`, () => {
  const v: any = new Sending(), quote = { text: 'quoted reply' }, files = [file()]; let value = text, sent: any
  v.kind = 'codex'; v.files = files; v.quote = quote; v.box = { value: () => value, set_value: (s: string) => { value = s } }; v.deliver = (msg: any) => { sent = msg }; v.saveSoon = () => {}
  v.send({ notify() {}, timer: { after() {} } })
  expect(sent).toMatchObject({ text, files, quote }); expect(sent.files[0]).toBe(files[0]); expect(v.files).toEqual([]); expect(value).toBe('')
})
test('Send waits for pending extraction rather than sending text and stranding its picture', () => {
  const v: any = new Sending(); v.clipboardPaste = {}; v.send({}); expect(notes[0].title).toBe('Paste is still loading')
})

test('a new chat may paste while the old extraction waits, without cross-attaching either result', async () => {
  const resolves: ((f: any[]) => void)[] = []; read = () => new Promise(r => resolves.push(r)); const h = view()
  h.v.pasteClipboard(h.cx); h.v.addr = 'tdifferent'; h.v.draftFile = 'draft-b'; h.v.pasteClipboard(h.cx)
  expect(reads).toBe(2); resolves[0]([file('/fixture/old.png')]); resolves[1]([file('/fixture/new.png')]); await h.done()
  expect(h.v.files).toEqual([file('/fixture/new.png')]); expect(dropped).toEqual([file('/fixture/old.png')]); expect(h.v.clipboardPaste).toBe(null)
})
for (const account of ['profile', 'home']) test(`changing the account ${account} cancels an outstanding extraction`, async () => {
  let resolve!: (f: any[]) => void; read = () => new Promise(r => { resolve = r }); const h = view()
  h.v.pasteClipboard(h.cx); if (account === 'profile') h.v.choice = { sel: { profile: 'different' } }; else h.v.dflt = { home: '/different-profile' }
  resolve([file()]); await h.done(); expect(h.v.files).toEqual([]); expect(dropped).toEqual([file()])
})
