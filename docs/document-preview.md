# Document preview limits

The native **Files** tree and its **Document** pane are separate from the web
Task Files panel, Chat attachments, Changes and published artifacts. Limits are
specific to those paths; increasing a document's viewing budget must not
increase what can be edited, uploaded, decoded or rendered at once.

## What you can do in the native Document pane

| Type | File/read budget | Display budget and controls |
| --- | --- | --- |
| Text and source code | Full edit buffer: at most 400,000 UTF-16 code units **and** 1 MiB (1,048,576 bytes) of valid UTF-8, no NULs. Larger regular text files are read-only; no whole-file size cap for source paging. | **Source** pages contain approximately 32 KiB of bytes (at most 32 KiB + 3), adjusted to UTF-8 boundaries. Use arrows or a page number. For editable files, **Highlight** shows the first 65,536 UTF-16 units, up to 12,000 lines, and at most 2,048 characters per displayed line; **Edit** retains the full buffer. |
| Markdown | Same source/edit policy. | **Preview** renders at most 32,768 UTF-16 units and 500 lines from the beginning. Larger rendered content has an explicit notice; use **Source** for the rest (full editor or read-only pages). |
| CSV / TSV | Full source/edit policy unchanged. Read-only table scan: up to **32 MiB** (33,554,432 file bytes) and **2,000,000 logical records**, including a header if present. | 40 records × 16 columns per page, with first/last, arrows and a row-number jump; column pages cover wide tables. Displayed cells show up to 160 Unicode codepoints plus an ellipsis, with a notice when clipped. Each complete logical record is bounded to 256 KiB of UTF-8, including line endings. Auto, comma, tab and semicolon are supported. |
| Word (`.docx`) | Local OOXML only: compressed file ≤ 64 MiB, total declared uncompressed members ≤ 64 MiB, XML member ≤ 16 MiB, at most 10,000 archive members. | Read-only content, at most 400,000 output characters, 500 rows and 50 columns per table. Truncated content is indicated. Page layout and images are not reproduced. |
| Excel (`.xlsx`, `.xlsm`, `.xltx`) | Same OOXML guards; local only. | Up to 100 worksheets, 500 rows and 100 columns per sheet, 400,000 value characters and **500,000 allocated cell slots across the workbook**, including sparse empty cells. 40 rows × 16 columns per page; truncated previews are indicated. Sheet names are bounded to 128 characters (ordinary Excel names are at most 31). Values are cached, not recalculated. |
| PDF | Local Linux/macOS: 128 MiB file, up to 100,000 pages. | One page at a time, longest edge ≤ 2,000 pixels; zoom/Fit/Reload. See [PDF preview](pdf-preview.md) for Poppler, time, process and disk-cache guards. |
| Raster images (`.png`, `.jpg`, `.gif`, `.webp`, `.bmp`, `.tif`, `.ico`, `.heic`, `.avif`, etc.) | No native project-file image decoding. | **Open original** opens the local file in its usual app. Remote files offer **Copy remote path**. SVG remains text source in Files; artifact and Chat image viewers are separate. |

MiB and KiB mean powers of 1,024. A UTF-16 unit is what JavaScript's string
length measures; a supplementary character such as 🦀 takes two units and four
UTF-8 bytes. Excel and Word output character budgets count Python Unicode
codepoints, not original file bytes or compressed archive size.

For CSV/TSV, Auto inspects the first logical record (TSV defaults to tab).
Quoted delimiters, doubled quotes, quoted newlines, CR/LF/CRLF and a UTF-8 BOM
are handled. Changing the delimiter starts a new scan and resets navigation.
Absolute row numbers and column letters are shown, including on the last page.
If the record-count limit is reached with more records present, the count has a
`+` and only the first two million records are indexed. A file above 32 MiB,
record above 256 KiB or malformed quoted record has an explanation instead of a
misleading partial table; the original text remains available in Source. UTF-8
errors and binary source pages have an explicit error rather than replacement
characters that could accidentally be saved. **Open original** is available for
local read-only documents and unsupported files.

## Find within a document

Focus a native Document tab and press **Ctrl+F** (or **Command+F**), or select
**Find** in its toolbar. The bar shows the current match and the count. Enter
and Shift+Enter (or the down/up buttons) move through matches and wrap around.
Escape or the close button removes the marks. Find is literal and
case-insensitive; it searches the active preview mode, not another open file.
A new query, reload, source/table mode or delimiter invalidates the old results.
Switching tabs pauses an in-flight scan and resumes it on return.

- **Text, supported source languages, and Markdown/CSV Source:** search the
  complete in-budget buffer, including unsaved changes. Search on larger
  read-only files crosses UTF-8 source-page boundaries and goes to the page
  containing the match. Since the retained native editor exposes one selection
  but no multiple-range decoration API, Find temporarily uses a virtualized
  read-only source view with colored spans; closing it returns to the original
  editor or Highlight view. Source bytes, drafts and Save are unchanged.
- **Markdown Preview and Word:** search visible headings, paragraphs, link labels,
  inline emphasis, code and table text within the respective preview budgets.
  The Find view lays the rendered text and table values out in searchable rows
  rather than changing the original rich renderer. Closing it restores normal
  formatting and links. Raw HTML uses a textual fallback, not a browser DOM.
  Choose Markdown Source for content outside the rendered excerpt.
- **CSV/TSV Preview and Excel:** search complete logical cell values (including
  values longer than the displayed cell), on all indexed records/columns or
  every worksheet within the Office read budget. Find opens the matched sheet
  and starts the visible row and column window at the hit. A long active cell
  may show a short excerpt around the match so hidden text can be found.
  A match cell is tinted and the active match has a stronger highlight.
  Excel now has column paging as well as row paging.
- **PDF:** local searchable text is extracted with Poppler `pdftotext` in
  batches of up to eight pages. Phrase matches use extracted word order
  with spaces between words. Word boxes follow the raster page's MediaBox and
  rotation at the current zoom or Fit. This is a word-box highlight, not
  character-level PDF editing. Image-only PDFs report no searchable text layer;
  text on scanned pages is not OCR scanned. Extraction errors and missing
  Poppler tools are reported rather than treated as zero matches.
- **Images and unsupported Office/binary files:** Find explains that the
  preview has no searchable text or is unavailable, without attempting OCR,
  binary decoding or conversion.

Queries are limited to 256 UTF-16 units and 5,000 retained matches (PDF also
has a 12,000-word-box cap). A `+` count and a separate notice indicate partial
results. Paged source Find reads up to 4 MiB plus a small UTF-8 lookahead per
helper batch; table Find reads up to 4 MiB / 65,536 logical records per
batch, using the same CSV record and file guards. One scan is queued per
native pane, with a 60-second overall scan budget checked between batches and
the existing helper timeouts. Changing the query, closing Find/the file or
switching documents stops further batches; the host cannot kill an already
running exec, but obsolete replies cannot change the current search. The
source may exceed the time budget, and a dirty editor buffer that outgrows the
edit budget has a clearly bounded search. Office search covers only extracted
content within the existing decompression, output and sheet/table limits.

**Web Files** uses the same literal match/count/navigation conventions and
preserves syntax colors while painting matches. It searches only the existing
read-only text prefix (400,000 file bytes); Markdown and CSV/TSV are raw text,
not rendered modes. Known PDF, Office and image formats and binary data are
not searchable in this panel. It labels truncated prefixes and the match cap.
Ctrl/Cmd+F belongs to the focused file preview; Chat Find remains separate.
Web Files is currently a desktop/tablet side panel, not a phone Document pane.
Changes, Chat attachments and published recipe artifacts are separate surfaces,
not project document previews.

## Why these limits are separate

Before this change, native initial text loads used Herdr App's `readTextFile`.
The installed `herdr.d.ts` declares a 1 MiB UTF-8 read limit. The Document pane
then rejected anything above `MAX_TEXT = 400000` (UTF-16 units) **before** it
could reach Markdown or CSV rendering. CSV parsing held at most 500 records and
100 columns, although it displayed 40 rows per page. The same cap was not
consistently applied to the periodic clean-file reload. These were three
separate limits, not a single 1 MB file policy.

`core/documents.js` owns the new text/table policy, copied through `bin/sync-shared`.
`mods/workspace-document/preview-reader.js` sends that policy and the fixed
`preview-read.py` reader to Python 3 via `herdr.exec`. The reader checks that the
source is a regular file and examines size **before** reading it. Only complete
small text can enter the native editor; the helper reads at most 1 MiB + 1 byte
for this decision. Larger source pages are random-access reads, not prefixes
passed off as complete files. Adjacent source pages cover each byte once. The
initial rendered Markdown uses the first source page, not the last visited page.

For a large CSV/TSV, the Python standard-library CSV reader scans bounded logical
records incrementally outside the UI process. It stores a checkpoint every
1,024 records and the first displayed page, not all rows or all file bytes.
Checkpoint offsets are opaque text-stream cookies (strings, not rounded JS
numbers). A later page seeks to the nearest checkpoint and parses at most 1,023
skipped records plus 40 displayed records. The 256 KiB record budget additionally
bounds unusually wide rows and multiline fields. Tables render at most 640 cell
values per page; the response is bounded by the cell cap and sparse index, not
file size. The helper's reply remains below the native host's documented 8 MiB
`exec` output ceiling. An editable CSV uses the same page limits on its complete
buffer, so unsaved edits are reflected in Preview without reading stale disk
content.

The 32 MiB default leaves room above common 10–25 MiB exports while limiting the
initial scan's I/O and time. The two-million-record cap separately bounds tiny
records that could fit in a few MiB. Table operations are serialized per pane;
source and table requests outside the UI process have a 20-second host timeout.
While scanning, Source is usable and the tab can close. A closed tab discards
late results and a queued operation for a closed tab is skipped. The host
`exec` API does not expose a child kill handle; an already-running scan may
finish or time out after close, but cannot recreate the tab or overwrite another
one. Navigation controls prevent overlapping requests on a tab.

The reader verifies file identity, size and modification/change times before and
after reads. All pages from one preview use the same version. A change to a
read-only file produces **Reload preview**, not a mixture of old offsets and new
bytes. Clean complete buffers still refresh automatically, including a transition
to read-only if the file grows. A dirty/recovered draft stays a complete buffer
and conflicts with the new disk version; explicit discard is required to replace
it. **Save** is only for complete, local, in-budget text and uses Herdr's guarded
atomic `writeTextFile` against the original contents. An edit that grows beyond
the editing budget keeps its draft and refuses Save. No partial source page,
PDF, Office or image can enter Save or draft storage. Source-line links still
jump in full buffers; for larger read-only files the pane explains that the
source pages must be browsed instead.

The Office output guard was also measured rather than raising the decompression
limits. A synthetic 100-sheet workbook with only an empty cell at column 100 in
each of its 500 rows per sheet was 265,798 bytes compressed, but previously
expanded to 20,106,668 bytes of JSON (even with zero value characters). Counting
allocated cell slots reduced the same reply to 2,011,034 bytes, with a visible
limit notice, while still allowing ten fully dense 500 × 100 sheets or many more
sparse sheets. No PDF or Office archive limit was
increased. Legacy `.doc`, `.xls`, `.xlsb`, encrypted or corrupt Office files
retain the conversion/error fallback; embedded macros and external links are
not executed. The Office helper has a 20-second host timeout.

## Local, remote and other surfaces

- Native text, Markdown and CSV/TSV use Python 3.8+ on the file's machine. The
  source is sent as code to `python3` (or `python` where that names Python 3),
  with the path as data, so no copy of the large document is brought to the
  window machine and no helper installation or persistent index is required on
  the remote machine. A host without Python retains the old native small-file
  read/edit support; larger previews explain the Python dependency. Remote
  native text is always read-only, even if small enough for an editor buffer.
- Linux was exercised with actual helper subprocesses. The same Python path is
  platform-neutral, including Windows UTF-8/newline handling, but macOS, Windows
  and a real remote connection have not been exercised here. Office continues to
  use its local `python3` helper. Native PDF still requires local Linux/macOS
  Python and Poppler; Windows and remote native PDFs use the existing fallback.
- The web **Task Files** panel is not the native Document pane. It reads from the
  task's worktree on its machine (`service/worktree.ts`, `machine.exec`, `wc -c`
  and `head -c`): **400,000 file bytes** as a read-only text prefix, with a
  truncation label, NUL-based binary detection and no CSV/Markdown/Office/PDF
  mode or editor. Web code highlighting has a separate 300,000-character
  threshold. It supports Find within that text prefix, not native document-mode parity.
- Native **Changes** previews are Git output (2,000,000 bytes command cap, 400,000
  bytes for new text files, 1,500 lines and 4,000 characters per line). Web task
  diff truncates at 400,000 JS string units. Neither is a file-edit or document
  preview budget; these paths are unchanged.
- Native and web artifact recipe images have a 4 MiB per-file publish limit,
  200 files and 64 MiB per artifact version. Recipe PDFs have a 25 MiB publish
  limit, separate from the native raster helper. The web PDF.js viewer has a
  four-million-pixel canvas, device scale capped at two, a 16-million-pixel
  source-image threshold, 20-second load and 15-second render timeouts. See
  [PDF preview](pdf-preview.md). Chat images/clipboard use their own attachment,
  media and transport paths; no upload or attachment limits have changed.

## Measurements and regression checks

Reproduce the local Linux measurements with `bun scripts/measure-document-preview.ts`.
It creates nonprivate, variable-length CSV and TSV records (Unicode, quotes and
multiline values) in a temporary folder and removes them. Times cover the actual
Python helper process including startup, not GUI paint, remote latency or data
transfer. Peak RSS is the helper's Linux process high-water mark.

| Synthetic fixture | Records | Initial index scan | Peak scan RSS | Jump to near end |
| --- | ---: | ---: | ---: | ---: |
| 25.04 MiB CSV | 262,145 | 1.032 s | 11,252 KiB | 0.042 s |
| 25.04 MiB TSV | 262,145 | 1.116 s | 10,520 KiB | 0.043 s |
| 31.85 MiB CSV | 332,801 | 1.326 s | 11,288 KiB | 0.053 s |
| 3.81 MiB dense CSV | 2,000,000 | 5.196 s | 11,096 KiB | 0.038 s |

Ordinary scans returned about 7–8 KiB of JSON including the index and first
page; the dense scan returned about 21 KiB. Opening source and reading a middle
source page took roughly 0.03–0.05 s; a 25 MiB ordinary scan plus source-open was
about one second. These are observations on the development host, not latency
guarantees. There is no retained process-sized spreadsheet in the UI.

`service/document-preview.test.ts` runs the real helper on generated file bytes,
including both editor boundaries, large CSV/TSV, exact counts, first/middle/last
pages, wide and long records, malformed data, row/file limits, UTF-8 page
reassembly and stale versions. `service/document-tabs.test.ts` exercises actual
controller methods with real file/helper I/O at the host boundary, including
navigation, Save/draft exclusion, dirty growth, discard, remote routing and late
close. The 2 MiB regression fails against the original pane with the documented
1 MiB native read cap and passes on the new pane. `test/test_office_preview.py`
checks the sparse output guard and the existing Office content/size guards;
PDF regression tests are unchanged. In an isolated native check, the new document renderer materialized the last
page of a real 25 MiB CSV, a middle source page and a bounded Markdown excerpt.
The checker builds eager elements in a hidden window, not their final pixels.
Host-boundary controller tests and these checks are not proof of native painting,
remote connectivity or platform-specific installers.
