# Native Markdown emphasis: Herdr App v0.1.16 patch

This is a tested **host-runtime patch**, awaiting a later approved host build and
installation. Merging this caller repository alone does not change the running
app. No app, service, mod, settings or installed font was changed during this work.

## Diagnosis and repair

Document Preview calls `TextView.markdown` without choosing a font. The host's
window inherits `settings.ui_font_family`, whose default is Geist. Read-only
configuration evidence for the reported case had no UI-font override. The
supplied document's standalone strong line parses correctly; its bytes were not
changed or included here.

The exact v0.1.16 sources apply `Strong` → `TextMark.bold()` → weight 700.
`CosmicTextSystem` then selects among the available faces. The host bundles only
Geist Regular. In the real Linux backend, requests for bold, italic and bold
italic all select that Regular face. Both native `div` bold and Markdown bold
produce pixels identical to their regular controls in the headless harness.

`runtime.patch` adds three unmodified official Geist 1.8.0 static faces to the
existing bundle: Bold, Italic and BoldItalic. It also adds a Linux host regression
that asserts four distinct, correctly weighted/styled faces. The existing Regular
file and OFL remain byte-for-byte unchanged. See `manifest.json` for immutable
font URLs, checksums, the release archive checksum and exact runtime source hashes.
The added fonts retain their embedded license and `fonts/OFL.txt`.

This repairs Geist's face inventory at its owner. It preserves selected font
families, normal text, theme colors, document IDs and source/save paths. Bold and
italic text can have different metrics and wrapping after the repair. Other
native callers and UI labels using Geist receive the same correct faces; there
is no Preview-only override or Markdown parser replacement.

## Reproduce safely

Requirements: Linux, Rust/Cargo, Python 3, `patch`, and the exact unpacked official
[Herdr App v0.1.16 source](https://github.com/herdrdev/herdr-app/tree/v0.1.16).
Use a **new scratch directory** for the second argument. The script verifies the
input and assets, copies source before patching, and refuses an existing output
or one inside the input. It has no install, app-launch or configuration operation.
Cargo uses a task-local target and at most two jobs; the first build may download
locked dependencies into Cargo's normal cache.

```bash
python3 patches/herdr-app/0.1.16/verify.py /path/to/official-source /tmp/markdown-font-check
```

For native GPU frame comparisons, add `--pixels`. For the test-only static
family, code-font and Unicode fallback controls, also supply a directory holding
DejaVu Sans and DejaVu Sans Mono's Regular, Bold, Oblique and BoldOblique TTF files:

```bash
python3 patches/herdr-app/0.1.16/verify.py /path/to/official-source /tmp/markdown-font-pixels --pixels --control-dir /path/to/test-fonts
```

These controls are read into the isolated font database. They are **not a runtime
installation dependency of this repair**. The core Geist regressions also pass
with no system fonts or control directory. `--prepare-only` prepares files without
building or running tests.

The harness compiles the actual bundle declaration from `src/settings.rs`, plus
the host's vendored GPUI, Markdown adapter and Linux text backend. It uses its own
committed Cargo lock; the renderer/parser/font dependency versions match the
host lock (GPUI 0.3.8, markdown 1.0.0, cosmic-text 0.19.0, swash 0.2.10,
zed-font-kit 0.14.1-zed, ttf-parser 0.25.1). It does not load Herdr mods or open an
OS window. `--pixels` uses the host's real WGPU headless renderer and GPU readback,
not HTML, a mocked TextView, or a simulated font selector.

The runner requires the unchanged bundle to fail on the actual current bold
glyph's selected weight, then requires the identical assertion to pass after the
patch. Each scene checks its **current shaped glyph runs**. Unique words avoid
reusing a previous cached line as evidence; captured frames separately test
identical visible text with style-only, same-length changes. A diagnostic run
captures the unchanged pixels without treating absent emphasis as a pass.

Coverage includes both strong delimiters, italic, bold italic, nested and mixed
spans, escaped markers, bold links/code, UTF-8 glyph indices and a real fallback,
same-length replacements, reloads, Source/Preview remounts, and native div bold.
Separate caller tests in `service/document-tabs.test.ts` verify scratch-file UTF-8
bytes, drafts, guarded saves and reload conflicts; their UI stand-ins prove state
preservation, not native rendering. `test/test_markdown_font_patch.py` checks the
binary fonts' real OpenType styles and license/checksum integrity.

## Applying later

After approval, use a clean host source tree that matches the manifest. Apply
`runtime.patch` with `patch -p1`, and copy the three `fonts/Geist-*.ttf` files to
`assets/fonts/`. Preserve the existing `assets/fonts/OFL.txt`. The preparation
script produces exactly this tree for review. A full host build/install belongs
to the host's normal workflow; this repository does not ship the app executable.
The additional host unit test is
`settings::tests::bundled_ui_font_has_real_emphasis_faces` (Linux).

## Remaining acceptance boundaries

- The supplied running window has not received this patch. Reopen the supplied
  document after an approved host installation and confirm its strong line,
  edits/reload, Source/Preview, narrow/wide layout and light/dark themes.
- Headless native frames prove the tested rendering path, not an installed-window
  screenshot or the full host build. macOS/Windows native acceptance remains open.
- Custom UI families still depend on their own available faces. The bundled
  variable mono fonts still select their nominal weight in this backend; variable
  axis/synthetic-weight support is outside this focused Geist repair. The code
  regression uses the Linux theme's static mono control, not those variable fonts.
- Fallback fonts and non-Latin scripts depend on the platform's available
  coverage. The added official faces omit U+2028, U+2029 and U+3003 present in the
  existing Regular file; those characters retain the backend's normal fallback
  behavior. No general cross-script emphasis guarantee is claimed.
- Shared chat/history/artifact/Office views need a later native smoke check.
  Line-ending and reference-image behavior is unchanged and outside this task.
