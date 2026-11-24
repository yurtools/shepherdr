# PDF preview

PDFs opened from **Files** or a chat file link use a read-only document view.
Previous/next page, zoom, Fit, Reload and Open original are available. PDF bytes
never enter the text editor, Source mode, draft recovery or Save path. Full path
and machine identify the document: two spaces' `report.pdf` files keep separate
loaders and caches. Files and chat links retain their opening root for Copy path
and Reference in chat.

The active native PDF checks file metadata every 2.5 seconds. External changes
refresh the page without writing the original. Opening an already-open PDF
refreshes it too. Reload retries an error. Password-protected, corrupt, oversized
or unsupported PDFs show an explanation and Open original. Remote native PDFs
offer Copy remote path and ask for a local copy; they are not silently downloaded.

## Native implementation and limits

The host documents images, size events and asynchronous `exec`, but no embedded
PDF/WebView API. `lib/pdf-view.js` supplies common controls and loading for
documents and native recipe PDF blocks. `lib/pdf-render.py` uses the installed
`pdfinfo` and `pdftoppm` from [Poppler](https://poppler.freedesktop.org/).
Python 3.8+ and Poppler are required on local Linux or macOS. Linux was exercised
here; macOS remains unverified. Windows and remote native rendering are not
implemented. Open original remains available for local Windows files. Missing
dependencies produce a fallback; the app never installs them itself.

- One Poppler render runs at a time per mod instance. Navigation coalesces to the
  latest page. Parsing and rasterization run outside the UI process.
- Inputs are limited to 128 MiB and 100,000 pages. Only the selected page is
  rendered, at most 2,000 pixels on its longest edge. Zoom enlarges this bounded
  image; extreme zoom does not produce vector-resolution text.
- Each command has a 12-second timeout. POSIX child limits request 10 CPU seconds,
  768 MiB address space and 20 MiB output per file, where supported by the OS.
  The host call allows 30 seconds for metadata and rasterization together.
- A private session keeps at most two PNGs: the visible page and its replacement.
  Closing awaits pending work and removes the session; late results cannot revive
  a closed document. A host reload/crash may bypass close. The next render removes
  sessions older than a day; at most 32 sessions are accepted per cache root.
  The source PDF is not copied into this cache.
- Metadata is checked before and after rendering. A change during rendering
  produces a Reload message instead of mixed page state.

Newly published/updated recipe artifacts carry copies of the native viewer and
helper. Existing artifacts retain the code from their last publication; update
them to gain PDF controls. Evidence ownership/routing and Office/Markdown modes
are outside this change.

## Browser artifact PDFs

Recipe PDF blocks use PDF.js instead of a browser PDF iframe. The exact
`pdfjs-dist` version is pinned in `package.json` and `bun.lock`. Vite bundles its
worker, standard fonts, Adobe CMaps and WASM decoder assets locally, including
inside the standalone viewer HTML. No CDN or upload service is involved. The API
was checked against Mozilla's [examples](https://mozilla.github.io/pdf.js/examples/),
[loading lifecycle](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html),
[worker API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFWorker.html)
and pinned package types/source, including `BinaryDataFactory`.
The standalone preview policy permits bundled data scripts, blob workers and
WASM compilation; it permits no external origin. Artifact file responses retain
their separate sandbox policy. Worker boot failures and stalled workers also
produce a fallback and release the worker, rather than staying on Loading.

There is one displayed canvas per PDF and a real worker for parsing. Obsolete
renders are cancelled, page resources cleaned, and the worker destroyed when the
component closes or leaves the viewport. Off-screen PDFs load on approach.
Loading has a 20-second timeout; rendering a page has 15 seconds. Canvas output
is limited to four million pixels and device scale two. PDF.js may omit individual
source images above 16 million pixels; Open original is available for the full
document. Text selection/search, editable forms, annotations and embedded scripts
are not exposed. Range loading fetches only needed parts where the server supports
ranges; otherwise the whole file is fetched. Existing recipe limits still apply
(25 MB per PDF). Password-protected/corrupt files show an error and Open original;
Reload reopens the source. Web Files/chat document panes have no new parity here.

## Validation boundaries

`test/test_pdf_preview.py` runs actual Poppler subprocesses with generated,
nonprivate PDFs: distinct pages and space roots, external changes, a 1,200-page
file, corruption, encryption (with qpdf available), size limits and bounded cache
cleanup. `service/pdf-preview.test.ts` runs the common controller with the real
helper, including late close and rapid navigation. Document tests check text,
draft and save exclusion. Artifact packaging tests require all imports and the
Python helper to travel with published recipes.
Real raster tests skip when Poppler is unavailable. The Bun controller suite
always runs the real helper with Poppler hidden from its child PATH to verify
the missing-tool fallback and cleanup without requiring a system installation.

For the browser regression, build first, then run
`bun test/browser/serve-pdf.ts 8846`. This loopback-only fixture server applies
the actual standalone viewer Content Security Policy and serves only generated
test documents. Open it in the task browser, get that browser's CDP URL, then run
`bun test/browser/pdf-preview.ts <CDP-URL> http://127.0.0.1:8846/ <scratch-output>`.
The test attaches to that existing tab; it creates no browser or window.

Browser proof uses the built viewer with fixture-only APIs and actual painted
pages, navigation, zoom/Fit, phone width and errors. Native materialization checks
exercise the shared UI with a real raster. This is not proof of the updated pane
running in the live workspace: this task installs nothing, restarts no service and
opens no new Herdr window. Live native painting, macOS, Windows fallback and
remote/native workflows remain unproven. GPUI's decoded-image cache and long-term
native process memory were not measured; helper disk/cache bounds are tested.
