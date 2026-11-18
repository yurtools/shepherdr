# Markdown code line endings: Herdr App v0.1.16 patch

This is a **host-runtime patch**, not a change shipped by the caller repository
alone. It needs a later approved host build and installation. No running app,
service, mod, font or setting is changed by this package or its verifier.

The accepted emphasis repair in the parent directory establishes the same
ownership boundary: document Preview passes unchanged text to `TextView.markdown`.
The native parser, code model, selection mapping and GPUI text shaper belong to
Herdr App. Its JavaScript API does not expose an adapter hook that can repair
code boundaries and their original-source ranges together. Rewriting the entire
document before passing it to that API would invalidate source offsets.

## Behavior and copy policy

`runtime.patch` targets the official v0.1.16 vendored `gpui-base` adapter. Only
Markdown `Code` values are normalized to LF in the parsed presentation model.
Backtick/tilde fences and indented code consequently feed identical row boundaries
to the unchanged GPUI shaper for LF, CRLF and lone CR input. Ordinary prose still
uses the existing soft-break, hard-break and paragraph handling.

**Code-only copy deliberately uses LF.** `CodeBlock::code()`, native plain selection,
reconstructed code-only fenced-Markdown selection, code actions and highlighters use
the same LF payload and UTF-8 byte offsets. This changes the former raw CR/CRLF
code-copy payload; it does not promise original code EOLs on the clipboard.
Reconstructed Markdown uses LF fence boundaries and trims trailing code LFs as
before. Source-format Select All still copies the original document verbatim;
whole interior blocks in a wider Source selection likewise retain their original
syntax/EOLs. This existing source-copy exception is tested separately. Non-Markdown
`CodeBlock::from_code` behavior is unchanged.

Source-range selection instead maps back to the original document: a rendered
LF maps to the entire original CRLF pair, lone CR or LF. Unicode byte boundaries
and container prefixes remain in original source coordinates. The document's
stored source, drafts, dirty comparison and guarded saves retain their exact
bytes. The supplied bold report is LF-only; this patch does not explain or repair
that separate symptom.

## Safe reproduction

Requirements: Linux, Rust/Cargo, Python 3, `patch`, and the unpacked official
[Herdr App v0.1.16 source](https://github.com/herdrdev/herdr-app/tree/v0.1.16).
The manifest pins original source hashes and the audit's 39 newline fixtures.
The verifier refuses a mismatched input, an existing output, or output inside
the input. It copies source into a new scratch directory before touching it.
Cargo uses a task-local target and two jobs. It never loads Herdr mods, launches
an app window, installs anything, or reads/writes the person's documents.
The Linux harness discovers available fonts read-only, like the host, and loads
the host's unchanged bundled Geist. It requires an available default code-font
fallback; it does not install a font or test font selection as part of this fix.

```bash
python3 patches/herdr-app/0.1.16/code-line-endings/verify.py /path/to/official-source /tmp/code-eol-check --pixels
```

Omit `--pixels` for model and real native shaping only. `--prepare-only` copies
the pristine source and harness without compiling or applying the patch. The
optional `--target-dir /path/to/task-owned-cache` reuses only Cargo build output
between fresh scratch runs; it must remain outside the input source. The
first build may download the accepted harness's locked dependencies into Cargo's
normal cache. Renderer/parser versions match the host (GPUI 0.3.8, gpui-base
0.7.1, markdown-rs 1.0.0). The verifier reuses the accepted harness lock and takes
the Unicode parser (`unicode-id` 0.3.6) and JSON (`serde_json` 1.0.151) entries
from the exact host lock; this does not substitute the independently released
gpui-kit for the host's modified vendored source.

The verifier first exposes the conventional tests in `regressions.rs` within
the actual private adapter/model scope, then requires the unchanged adapter to
fail its code-EOL assertion. It restores the exact adapter, applies the patch,
and requires the identical tests to pass. Scratch-only visibility wrappers make
the same tests callable from a small harness without compiling the host's whole
application or unrelated test dependencies. They replace no production logic.
`--pixels` also captures the real WGPU headless TextView frames, with the same
view ID across source replacements. It checks LF/CRLF/CR frames for equality.
These are native-renderer frames, not installed-window screenshots or HTML.
On Linux the verified result is: the same audit fixture assertion fails before
and passes after; all ten new regression groups and 65 existing adapter tests
pass; real shaping returns two CR-free rows; and LF/CRLF/CR headless TextView
frames are byte-identical after the patch. The before lone-CR frame joins the
two rows, while the after frame shows them separately.

Coverage includes the unchanged 39 audit fixtures; fenced/tilde/indented code;
quote/list nesting; adjacent prose; Unicode selections; mixed EOLs; blank code
rows; empty/unclosed fences; literal backslashes; global source offsets; explicit
code-copy behavior; and distinct soft/hard/paragraph boundaries. Caller tests in
`service/document-tabs.test.ts` separately test real scratch-file bytes, drafts,
EOL-only dirty/conflict detection and guarded saves with UI stand-ins. Those
stand-ins are not evidence of native rendering.
Model equality also retains source-map differences when mixed EOLs move within
a same-length code block, even though the normalized visible code stays equal.

## Applying later

Use an exact host tree matching `manifest.json`. Apply `runtime.patch` with
`patch -p1`; copy `regressions.rs` to
`vendor/gpui-kit/crates/base/src/text/format/code_line_endings_tests.rs` and
`fixtures.json` beside it as `code_line_endings_fixtures.json`. The additional
tests live under `text::format::markdown::code_line_endings_tests`. A full host
build and installation remain the host maintainer's workflow.

The patch is independent of the parent emphasis/font patch: it touches no fonts,
settings, JS API, GPUI shaper or caller. Both patches can be applied to the same
v0.1.16 tree. Source hashes in this verifier deliberately identify pristine
v0.1.16 input; combined validation must use a separate scratch copy.

## Remaining acceptance

- The running window has not received this patch. Native interactive selection,
  clipboard, Source/Preview, reload, narrow/wide layout and shared native callers
  require later approved installation and acceptance.
- Headless Linux rendering is not macOS/Windows acceptance or a full host build.
  The original private report and screenshots are not included in this package.
- No optional soft-break preference, font/image behavior, web layout or global
  document normalization is introduced.
