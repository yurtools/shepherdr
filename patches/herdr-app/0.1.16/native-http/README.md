# Native image transport integration

This focused host integration completes the emphasis, code-line-ending and
reference-image repairs in the parent packages. It does not install or update
the app by itself. No version or release identity is changed.

## Owning layer and diagnosis

The official Linux v0.1.16 application constructs GPUI without an HTTP client.
`gpui_platform::application()` delegates to `Application::with_platform`, whose
default is `NullHttpClient`. The unchanged shell document-image loader obtains
its transport from `cx.http_client()`. Consequently even a permitted ordinary
inline image cannot load; adding reference image nodes alone cannot complete
installed image acceptance. The native before case and a synthetic loopback
endpoint reproduced this gap during the combined installation work.

`runtime.patch` adds one application startup hookup and a small `document_http`
factory (`client.rs`). It uses the matching published
`gpui-pre-reqwest-client` **0.3.8**, from the GPUI snapshot of
Zed `279fe070bb389b79652e52065b2f001edcc0b11b`. Its immutable crate checksum is
`894b8d8618c92cbd4da28a04dd3fcf3c0e0607074fa99416a864ac9b63b18aae`.
The patch includes the resolved host lockfile and regenerated third-party
notices; existing dependency versions are retained. `manifest.json` pins the
source before and after this additional integration.

The application-wide client also serves existing GPUI HTTP image callers,
including native Markdown in chat, history, artifacts and Office previews.
JavaScript fetch and unrelated networking code are not changed. The factory
adds no credentials, cookie store or authorization headers. No user setting,
font family, URL grant or capability is changed.

The shell image loader and capability implementation remain byte-for-byte
unchanged. Absolute HTTP(S), authorized GET, per-hop redirect authorization,
HTTPS downgrade rejection, the redirect limit, 8 MiB response bound, 30-second
loader timeout, view/policy asset ownership and disposal remain there. The
matching transport honors `RedirectPolicy::NoFollow`; the regression verifies
this with real endpoints, rather than relying solely on its source.

## Reproduce the combined regressions

Use the exact official source pinned by the parent manifests and a **new** work
directory. Python 3, Cargo/Rust, `patch`, a Linux font backend and optional Vulkan
rendering are required. The runner verifies inputs, copies them to scratch and
reuses the accepted font, adapter, state and image-loader tests. It does not
launch Herdr, load live mods, touch app configuration or install anything.

```bash
python3 patches/herdr-app/0.1.16/native-http/verify.py \
  /path/to/official-v0.1.16 /path/to/new-combined-check --pixels \
  --target-dir /path/to/task-owned-cargo-target \
  --control-dir /usr/share/fonts/TTF
```

The optional control directory must contain the eight DejaVu Sans/Sans Mono
Regular, Bold, Oblique and BoldOblique files used by the accepted font harness.
These are read-only test inputs, not installed runtime dependencies. Omit
`--pixels` for real model/shaping/network checks without GPU frames; omit
`--control-dir` to run the accepted core Geist checks without those controls.
`--prepare-only` writes the scratch source and harness without running Cargo.
The combined harness has its own committed lock and uses at most two Cargo jobs.

Before patching, the same tests must expose the missing real HTTP client,
missing selected emphasis face, joined lone-CR code rows and discarded reference
images. After patching, they run together. `loader_regressions.rs` uses the
production factory and unchanged loader against an actual loopback server:
permitted PNG decoding, denied initial GET, a permitted redirect, a denied
redirect target that must receive **no request**, and the streamed 8 MiB bound.
The accepted timeout, stale completion, policy replacement, disposal and native
pixel fixtures run too. The small immutable policy holder and existing fake
replies in those earlier fixtures remain test boundaries; installed-window
acceptance and the full production JS runtime are separate checks.

The HTTP baseline constructs the actual GPUI `Application` builder with a test
platform and no event loop. A scratch-only accessor exposes the client selected
by that builder. This avoids the headless test context's built-in fake 404
client. The passing case uses the same builder with the production factory.

## Build and install boundary

Apply the three parent patches first, copy their tests, fixtures and font assets
as their READMEs describe, then apply this `runtime.patch` with `patch -p1`.
Preserve all assets and licenses. The production source must stay separate from
the verifier's instrumented scratch source. Use the official host build inputs:
Rust 1.95.0, Zig 0.16.0 and Ghostty commit
`291fd050b9e9c293c8adb6a140742649b7e42d3a`; a source archive omits that submodule.

```bash
export CARGO_BUILD_JOBS=2
cargo build --release --locked -j 2
cargo test --release --locked -j 2 --bins \
  --test skill --test notices --test colrv1 --test shot_pixels -- --test-threads=2
```

The omitted `commands` integration test invokes an app command with an alternate
app home; it is unsuitable for this person's installation constraints. The
selected Linux pixel tests use a headless renderer. Use the host's documented
JavaScript tests too. A completed build/test exit and binary checksum are required;
an interrupted run is incomplete evidence. Run a final production build after
tests before selecting the executable to install.

Before installation, compare the installed/running executable with the pinned
official release and preserve any newer or customized host. Save a durable
private backup of the executable, launcher, notices, settings, layout metadata,
persisted chat/document drafts and current tab/agent ownership. Recheck for an
updater stage and core-update marker. Do not run the upstream Linux installer:
it repoints the launcher to a source build directory.

Keep the existing stable launcher and executable location. Stage the completed
binary beside the live executable, retain its mode/ownership, fsync it, then
rename it atomically into place. Install its matching notices. A normal source
build does not enable the release updater. The font faces are embedded; do not
install them globally or replace live mods/settings.

Activation uses the supported `app.quit` cleanup, then opens the stable launcher
only after the old app process exits. Never stop or update the core. Establish
the active host's quit hooks and draft preservation before doing this; if safe
activation cannot be established, stage the installation and ask about the
specific remaining disruptive action. Restore the backed-up binary/notices by
the same atomic method for rollback, followed by a graceful app relaunch.

Record built, installed and running hashes separately. Check real native
emphasis, the supplied reported line privately, EOL rows, reference images,
ordinary breaks and Source/Preview/reload, and compare tab/agent ownership.
Interactive clipboard behavior that was not exercised must remain explicitly
unproven. Web or headless screenshots do not replace installed-window proof.
