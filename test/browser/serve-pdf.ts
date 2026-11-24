// Loopback-only fixture server. No service, live data, deployment or changed HOME.
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..')
const fixtures = await mkdtemp(join(tmpdir(), 'shepherdr-pdf-browser-'))
for (const file of ['two-pages.pdf', 'locked.pdf']) await copyFile(join(root, 'test/fixtures/pdf', file), join(fixtures, file))
await writeFile(join(fixtures, 'corrupt.pdf'), '%PDF-1.7\ncorrupt')
const generation = Bun.spawnSync(['python3', '-c', "import sys;sys.path.insert(0,sys.argv[1]);from pdf_fixture import pdf_bytes;open(sys.argv[2],'wb').write(pdf_bytes(pages=1200))", join(root, 'test'), join(fixtures, 'large.pdf')])
if (generation.exitCode) throw Error('Could not generate the safe large PDF fixture')
// Apply the real standalone viewer policy, so worker/font/decoder packaging is checked too.
const source = await readFile(join(root, 'mods/artifacts/bin/herdr-artifact'), 'utf8')
const policy = source.match(/VIEWER_CSP = \(([\s\S]*?)\)/)![1]
const csp = [...policy.matchAll(/"([^"]*)"/g)].map(match => match[1]).join('')
Bun.serve({ hostname: '127.0.0.1', port: Number(process.argv[2] || 8846), async fetch(request) {
 const url = new URL(request.url), id = url.pathname.split('/')[3] || 'two-pages'
 const name = ['two-pages', 'large', 'locked', 'corrupt'].includes(id) ? id + '.pdf' : 'two-pages.pdf'
 if (url.pathname.endsWith('/recipe')) return Response.json({ recipe: 1, blocks: [{type:'text',md:'Safe local fixture. The PDF contains only test text and colored shapes.'},{type:'pdf',src:name,caption:'Safe PDF fixture'}] })
 if (url.pathname.includes('/file/')) return new Response(Bun.file(join(fixtures, name)), {headers:{'Content-Type':'application/pdf','Cache-Control':'no-store'}})
 if (url.pathname.startsWith('/api/artifacts/')) return Response.json({id,title:'PDF preview · isolated fixture',version:1,versions:[{v:1,at:Date.now()}]})
 if (url.pathname.startsWith('/api/')) return new Response('Not found', {status:404})
 return new Response(Bun.file(join(root,'web/dist/artifact-viewer.html')), {headers:{'Content-Security-Policy':csp}})
}})
console.log('PDF fixtures served on loopback only')
