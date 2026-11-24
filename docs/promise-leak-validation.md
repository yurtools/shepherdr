# Quiet event waits: design and validation

SHEP-28 / feature `0aa5f18a9693471baa2f43c10ea8b0d1`, checked 2026-11-21.
Base: `765d1549535b6e3c6a88438a3b40164b360897f8` (`origin/main`).
The worktree started clean at that exact tip. No runtime, live installation,
other machine, version, README, or main-checkout changes are part of this patch.

## Design

Command-only loops await `nextCommand()` directly. The host owns and cancels
the pending receive; polling it every five seconds adds no useful work.

`lib/bounded-wait.js` owns mixed event/timeout waits. A WeakMap gives each source
promise one observer, including when two views use that source. Each tick adds
one temporary weak listener and one cancellable `cx.timer.after` timer. Timeout
removes the listener; settlement removes the listener and cancels the timer.
Events remain cached across a timeout boundary until consumed. Results are
`{value}`, `TIMEOUT`, or `DISPOSED`; source rejection throws unless the caller
explicitly supplies recovery. A stale context/timer error is never recovered as
a watch error. Tasks uses its own failure symbol so **every fulfillment**, even
`undefined`, `false`, `null`, or `[]`, still reloads the list.

`clear()` and `dispose()` detach the active wait before cancelling the original
FolderWatch handle. Replacement and queued-event delivery check record identity,
so an old observer cannot clear a replacement or resume a closed view. Voice
starts its watch before navigation and its timeout after navigation, preserving
the original cadence. Hangup disposes its watch immediately.

The source observer captures only an outcome and weak listener slots. It cannot
retain a timer, resolver, view or context. Host cancellation can leave promises
pending forever and skip `finally`; weak listeners allow that abandoned graph
to be collected. A FinalizationRegistry removes its dead slot even if the source
is retained forever. Normal timeout/close/replacement cleanup is synchronous;
it does not depend on finalization. Inbox's module-level start guard is weak too;
its owning view releases its watch, periodic timers and guard on close. Identity
checks prevent a late old cleanup from releasing a newly opened inbox.

## Host ownership and limits

Read-only inspection found the installed binary equal to the retained release
build (SHA-256 `d41409a38b18dad20bcb489ec8b6c0169d72439ceb9b32cf842a4b046d0906d7`).
The build's installation record and pinned source manifest agree. Runtime source
references below are relative to that build, **not files changed by this patch**:

- `src/mods.rs:1205`: FolderWatch and nextCommand register native asynchronous
  work in the current view's scope. Commands await `rx.recv()`.
- `vendor/gpui-kit/crates/shell/src/engine/quickjs/scheduler.rs:1225`:
  cancellation drops the underlying receive/watch future, so an old receive
  cannot steal the replacement's next command. Owner cancellation removes resolve,
  reject and callback roots without settling the JS promise.
- `scheduler.rs:399`, `:413`, `:450`: generation/view cancellation calls
  `cancel_work()` and releases callbacks. `:1320`: explicit FolderWatch.cancel
  normally resolves `[]`; owner cancellation can instead leave it pending.
- `vendor/gpui-kit/crates/shell/src/watch.rs:576`: successful reload releases the
  old application generation without calling its View.close. The release path
  in `engine/quickjs/mod.rs:2142` cancels its owned host work. Therefore reload
  cancels the original native watch future through host ownership, not finally.
- `scheduler.rs:1587` and `typings.rs:3975`: timer handles have `cancel()`;
  cancelling a task/sleep need not settle its promise. `cx.sleep` is unsuitable
  for cancelling a losing timeout.

Existing native tests were run from the retained, prebuilt test executable,
SHA-256 `2762909caf51aa868167f7e8b60f372dbcd583d4a7c60cea059da0aff9f0431c`.
With `HERDR_TEST_TMPDIR=/tmp`, each command below returned **0**:

```sh
"$NATIVE_TEST" --exact mods::lifecycle_tests::focus_command_lets_a_mod_take_arrow_keys --nocapture
"$NATIVE_TEST" --exact mods::lifecycle_tests::explicit_host_cancellation_drops_work_and_settles_once --nocapture
"$NATIVE_TEST" --exact mods::lifecycle_tests::close_is_once_and_awaits_its_promise --nocapture
"$NATIVE_TEST" --exact mods::tests::loading_copies_reclaims_closed_command_channels_without_dispatch --nocapture
"$NATIVE_TEST" --exact files::tests::cancelled_waits_release_quiet_folders_without_stopping_other_callers --nocapture
```

`NATIVE_TEST` was the existing `target/debug/deps/herdr_app-079c5d0d8ee8f046`
under the retained build. These use GPUI test contexts, not a second app window.
The initial focus test without the temp override returned 101 because its default
`/var/tmp` was read-only; the override rerun passed.

`herdr-app status` confirmed an existing window with no reported errors. A new,
side-effect-free fixture in `/tmp/shep28-native-check` imported the actual helper,
started a real scratch-folder watch and real host timer, disposed them, checked
that state/listeners were cleared, and initiated a direct command receive.
`herdr-app check /tmp/shep28-native-check` returned **0**. An earlier async fixture
returned 1 because check renders before its spawned async loop finishes; it was
not treated as event-delivery proof. No production mod init was checked.

**Not proven:** production native UI behavior after installation, a live native
hot-reload/close/reopen sequence of the changed mods, long-running GPUI process
RSS, or older/different host builds. No live installation or additional window
was permitted. Native lifecycle claims combine matching-source ownership
inspection, existing native tests, the safe smoke check, and deterministic loop
fixtures. They are not represented as a live native soak test.

## Regression commands and results

Tests were committed first in `bb137b87`. The first six tests executed the actual
five command-loop bodies and Tasks.watch on the untouched base: all failed with
**3,001 subscriptions per pending source after 3,000 timeouts**, return code **1**.
The final fixture, copied back to a full base archive, fails all nine applicable
before tests for the same reason. The added helper/lifecycle fixtures require
the helper and do not run in the base archive.

Reproduce the before check (no second checkout, no installer handover):

```sh
before=$(mktemp -d)
git archive 765d1549535b6e3c6a88438a3b40164b360897f8 | tar -x -C "$before"
mkdir -p "$before/test/fixtures"
cp test/fixtures/bounded-waits.mjs "$before/test/fixtures/"
(cd "$before" && node --expose-gc test/fixtures/bounded-waits.mjs)
# return 1: 9 failed, 0 passed; 3,001 subscriptions each
node --expose-gc test/fixtures/bounded-waits.mjs
# return 0: 24 passed, 0 failed
```

The after fixture executes all affected loop bodies/methods, without running
their init side effects. It covers thousands of quiet ticks then delivery,
falsey values through Tasks.watch, both timeout-boundary orders, queued events
at close/replacement, rejection/retry, never-settling cancellation, original
handle cancellation, source/folder replacement and late old settlement, inbox
guard ownership and close/reopen, forty simulated host reloads without finally,
independent multiple views, and actual voice heartbeat/alive/navigation behavior.
It checks listener/timer counts as well as source subscription counts.

## Actual-engine memory measurement

The retained QuickJS Rust integration revision is
`96593cd7a54440ac060a391b8baea7e9a3cf1393`, matching the crash diagnosis.
Its `sys/quickjs` submodule is `fd0a0210b7be00957751871e7e01b8291268fc29`.
Tracked engine source is clean; only `.cargo-ok` markers are untracked.
The harness links the **existing release engine archive**, without compiling or
modifying engine sources or rebuilding the installed runtime.

Set `BUILD` to the retained build root (the installation record's build tree):

```sh
QJS="$BUILD/cargo/git/checkouts/quickjs-jit-85f77f3fd15b7d92/96593cd/sys/quickjs"
QJS_ARCHIVE="$BUILD/target/release/build/quickjs-jit-sys-51452bd333f2fd5d/out/libquickjs.a"
python3 scripts/measure-bounded-waits.py \
  --include "$QJS" --archive "$QJS_ARCHIVE" \
  --output /tmp/shep28-memory.csv --metadata /tmp/shep28-memory.json
```

The script's exact build/run inputs are:

```sh
gcc -O2 -I "$QJS" test/fixtures/bounded-wait-memory.c "$QJS_ARCHIVE" \
  -lm -ldl -lpthread -o "$scratch/memory"
"$scratch/memory" lib/bounded-wait.js test/fixtures/bounded-wait-memory.js
```

Compiler: GCC 16.2.1 (20260810). Compile, measurement and plateau assertions all
returned **0**. The C harness evaluates the **unmodified actual helper as an ES
module**, adding only assignments exposing its exports to the driver. It uses
the same 256 MiB heap limit as the diagnosis. Each mode has its own runtime;
fixed batches of 100 operations are followed by GC, finalizer-job draining and
GC again. Samples begin after 1,000 warmup operations. Timers are deterministic
fixtures, not GPUI timers. This measures QuickJS's heap, not Rust/JIT/OS RSS.

Full [CSV](validation/promise-waits-memory.csv) and [input hashes](validation/promise-waits-inputs.json)
are committed. All modes load the helper module so fixed module overhead is
included in both before and after measurements.

| Pattern | 1,000 | 5,000 | 10,000 | 20,000 | 40,000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Repeated race, same pending source | 1,424,640 | 6,544,640 | 12,944,640 | 25,744,640 | 51,344,640 |
| Actual helper, quiet timeouts | 148,352 | 148,352 | 148,352 | 148,352 | 148,352 |
| Actual helper, source replacement | 148,720 | 148,720 | 148,720 | 148,720 | 148,736 |
| Actual helper, repeated dispose | 146,464 | 146,464 | 146,464 | 146,464 | 146,464 |
| Actual helper, discarded views without finally | 148,960 | 148,960 | 148,960 | 148,960 | 148,960 |

Numbers are heap bytes after GC. The race grows by 1,280 bytes per timeout.
The actual timeout helper is flat; replacement varies by only 16 bytes. The
discarded-view run keeps the **same source rooted forever**, drops timer roots
without settling awaits, and asserts that its weak view reference was collected.
The driver also asserts listener/timer cleanup and final false-valued event
delivery. This replaces the diagnosis's conceptual subscribe-once control with
the implementation that ships in this patch.

## Remaining Promise.race audit

Search all authored source, including extensionless executables; generated copies
are listed below. Test fixtures intentionally retain a repeated-race baseline.

```sh
rg -n 'Promise\.race' --glob '!bun.lock' --glob '!docs/**' \
  --glob '!test/**' --glob '!**/*.test.*'
```

| Authored site | Classification and reason left unchanged |
| --- | --- |
| `core/send.js:161` | Reused source, **bounded**: at most 20 races per single send, then awaits that send; not an idle loop. |
| `lib/local.js:26` | One race per fresh health fetch; no retained source reused on subsequent polls. |
| `lib/bridge.js:33` | One race per fresh state fetch; no retained source reused on subsequent polls. |
| `service/agents.ts:159` | One race per fresh send when switching agent settings. |
| `service/main.ts:118` | One startup race for host.start. |
| `service/main.ts:484` | One race per fresh follow.ready created inside follow(); watcher stopped in finally. |
| `service/main.ts:539` | One race per fresh follow.ready for an activity request; stopped in finally. |
| `service/voice-hear.ts:72` | One race per followed chat's priming; chats map prevents repeat subscription while watched. |
| `service/voice-tools.ts:417` | One race per fresh evidence action. |
| `mods/chat/audio.ts:103` | One race per exited audio helper's stderr read. |
| `bin/herdr-browser-view:464` | Shutdown-only waitTold called by quit, followed by process.exit; not a periodic loop. |

Generated remaining races are `mods/chat/core/send.js`, `mods/{chat,tabs-tasks,shepherdr-settings}/local.js`
and `mods/tabs-tasks/bridge.js`. Their classifications are the same as their
authored sources. No unbounded repeated-source race remains in the native mods.
Fresh transport operations can have their own cancellation concerns; this patch
does not claim to change transport lifetimes.

## Repository checks

All commands run from the worktree root. Native tabs fixtures retain their
existing separate-Bun-process isolation; no shared fixture imports were added.

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` then `bun web/build-plugins.ts` | 0 / 0, before types and build |
| `bin/sync-shared --check` | 0; all 459 generated copies match |
| `node --expose-gc test/fixtures/bounded-waits.mjs` | 0; 24 passed |
| `python3 -m unittest discover -s test` | 0; 813 tests, two skips |
| `bun test service core web` | 0; 1,040 passed, zero failures, 141 files |
| `bunx tsc --noEmit -p .` | 0 |
| `bun run build` | 0; app and artifact viewer built |
| Node module syntax, every mods/lib/core JS | 0; 752 files |
| `bun build --no-bundle --target bun` for every mod TS helper | 0; 5 files |
| JSON parse for workflow's keys/layouts/addons/features/mod files | 0; 42 files |
| `bash -n` on every workflow shell script; `sh -n` also where not bash | 0; 8 files |
| Fresh scratch-root dry run, install, doctor, uninstall | 0 / 0 / 0 / 0 |
| `git diff --check` | 0 |

The initial sandboxed Bun run returned 1: local HTTP/Unix sockets were refused
with EPERM, and audio fixtures timed out. The **full unrestricted fixture rerun**
passed all 1,040 tests, including audio; no assertion or timeout was weakened.
The initial sandboxed Python run returned 1 (813 tests; three preview failures,
29 socket errors, three skips), all from refused scratch sockets. The rerun uses
`subprocess.run(..., start_new_session=True)` and reports the actual return code,
not just an `OK` line. The full unrestricted rerun returned **0** (813 tests,
two skips). Fixture home guards remain enabled.

## Authored files versus generated copies

Authored runtime changes: `lib/bounded-wait.js`, `lib/inbox.js`, `lib/COPIES`,
and `main.js` in chat, pane-chat, tabs-tasks, tasks, spaces-chat, coordinator and
artifacts. The seven helper copies and four inbox copies are generated only by
`bin/sync-shared`, including the transitive workspace-status-chat inbox import.
Other authored files are the Python/Node regression fixtures, C/JS memory driver,
measurement script and this validation documentation/data. No layout IDs, mod
names, data paths, feature titles or user-facing design changed.
