# Markdown reference images: Herdr App v0.1.16 patch

This package is a **host-runtime patch awaiting an approved build and
installation**. A merge in this caller repository does not change the running
app. Document Preview calls `TextView.markdown`; Herdr App owns the parser,
native image nodes, policy loader, asynchronous assets and disposal.

## Repair

The official adapter silently discards markdown-rs `ImageReference` nodes.
`runtime.patch` resolves them through the existing `NodeContext.link_refs` map
and emits ordinary `ImageNode`s, preserving alt text, definition title and the
reference's original UTF-8 source span. Full, collapsed and shortcut references
use the parser's normalized identifier, with no Markdown preprocessing or
second parser. Undefined references retain markdown-rs's literal/fallback
semantics, even if the alt text names another existing definition.

Definitions are collected recursively before inline conversion so forward and
container definitions work. Duplicate labels retain the first definition, as
the parser specifies. Images within reference links receive the resolved outer
link as well. Text, emphasis, source mapping and adjacent images retain the
existing image/text split and rendering paths.

The existing background parser normally reparses only the last block on append.
When the old document or new suffix contains definitions, it now reparses the
complete Markdown so a new definition can resolve earlier literal text and a
later image can use an earlier definition. Such a result is marked as a full
parse for row invalidation and selection remapping. Streams without definitions
keep their incremental path. The parsed definition context is retained with its
document and replaced on a new document; stale-result guards stay in force.
Documents containing definitions consequently cost a full parse on each append.

The shell image loader is unchanged: absolute HTTP(S) and authorized GET only,
no implicit credentials, every redirect reauthorized, no HTTPS downgrade,
maximum ten redirects, 8 MiB response body and 30-second request timeout.
Reference images use the same per-view/per-policy successful/failed asset cache
and owner-release cleanup as inline images. No file, data or relative/local
image access is added to the script-facing TextView.

## Reproduce without touching the app

Requirements: Linux, Python 3, Rust/Cargo, `patch`, and the exact unpacked
[official Herdr App v0.1.16 source](https://github.com/herdrdev/herdr-app/tree/v0.1.16).
`manifest.json` records the release archive checksum and hashes of the exact
source used, including the unchanged policy loader. The verifier rejects
mismatched inputs and existing/nested output directories, then copies to a new
scratch tree. Cargo uses two jobs and a task-local target. Its first run can
download locked dependencies into Cargo's cache.

```bash
python3 patches/herdr-app/0.1.16/reference-images/verify.py /path/to/official-source /tmp/reference-image-check --pixels
```

Omit `--pixels` for adapter/state/policy-loading assertions without GPU frames.
`--prepare-only` copies the pristine source and harness without compiling or
applying the patch. Optional `--target-dir /path/to/task-owned-cache` reuses
only build output outside the input source. No script here installs, launches,
restarts or changes Herdr, its configuration, fonts, documents or mods.

The runner first requires the unchanged adapter to fail the same image-node
assertion it will run after patching. Scratch-only wrappers expose the real
private adapter/state tests; they replace no production parsing or loading
logic. The conventional regression sources are `regressions.rs` and
`state_regressions.rs`. The existing adapter regressions run too.

The harness compiles the actual host-vendored GPUI/Markdown adapter and the
unchanged shell `materialize/text_view.rs` and `capability.rs`. It substitutes
a small immutable policy holder for the shell's JS interpreter/host-module
registry, and fake HTTP replies for network transport. The host's identical
`url` 2.5.8 type is imported directly instead of through reqwest's reexport.
An opaque filesystem handle stand-in panics if reached; none of these image
tests exercises or needs filesystem capability operations. Grant decisions use
the real host `Capabilities` implementation; image decoding, asset caching,
timeouts, completion notifications and disposal use the real loader and GPUI.
This is not a test of JS policy construction, mod initialization or an installed
app. `--pixels` uses the real WGPU headless renderer with synthetic PNG replies,
not a web view or a mocked TextView.

The same missing-image assertion fails before patching and passes afterward.
All ten new adapter/state groups and 65 existing adapter tests pass. The four
existing loader grant/redirect/body-boundary tests pass, as do the reference
image denial, timeout, failed decoding, stale completion, policy replacement
and disposal fixtures. In both scrolling modes, all four permitted image forms
produce byte-identical native WGPU frames after the patch. These are headless
Linux native pixels, not an installed-window screenshot.

## Apply later

In a clean matching host tree, apply `runtime.patch` with `patch -p1`, then copy
`regressions.rs` to
`vendor/gpui-kit/crates/base/src/text/format/reference_images_tests.rs` and
`state_regressions.rs` to
`vendor/gpui-kit/crates/base/src/text/reference_images_state_tests.rs`.
The conventional tests live in `text::format::markdown::reference_images_tests`
and `text::state::reference_images_state_tests`. No complete host runtime is
vendored here. A host build/install is separate work requiring later approval.
The patch also applies without fuzz alongside the accepted emphasis and code
line-ending patches in either order. The image regressions have additionally
been checked with the accepted code-line changes in the same scratch source.

## Remaining acceptance

- The running native window has not received this patch. Interactive links,
  source selection/copy, reload, Source/Preview and shared native callers need
  later approved installation and native acceptance.
- Headless Linux GPU frames, when requested, are distinct from installed-window
  proof, macOS/Windows acceptance and a full host/JS runtime build.
- Fake HTTP fixtures prove the actual loader boundaries, not live remote image
  servers, real network timing or all image formats. The private supplied report
  and screenshots are not included; they concern the earlier emphasis task.
