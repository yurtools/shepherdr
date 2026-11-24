# Native Chat history preparation

The native Chat timeline consumes a completed `PreparedHistory` snapshot. Cold
render queues preparation and shows the opening notice, Find and the composer.
An unchanged or hover render reuses the snapshot's rows, keys, index, estimates,
search matches, media references and card strips. It does not parse the history.

`core/chat-preparation.js` owns the cooperative transaction and prefix indexes;
`mods/chat/main.js` supplies its native presentation inputs and row generator.
Shared copies are generated with `bin/sync-shared`.

## Work and commit boundaries

| Stage | Work outside render |
| --- | --- |
| Conversation reconstruction | Decode eight log records, then yield through the view's async context. Build a fresh Conversation before publishing offsets. |
| History metadata | Yield between source entries, artifact-version matches, news entries and merge-sort copies/comparisons. |
| Message presentation | Resolve media, split Markdown/code and calculate folding for one source message; yield between source messages and expanded rows. |
| Geometry | Yield per spaced row and per key/estimate/index entry. Collect search results and media/card references in this pass. |
| Measurements | Update one height and prefix index in logarithmic work. Select eight missing neighbours through an index; locate still-settling rows through a timestamp range index, with no expiry sweep. |
| Media loading | Request image references in batches of eight and artifact previews individually, with yields and owner checks. |

Each history callback advances at most thirty-two generator steps. It also checks
a three-millisecond clock target between steps. Individual string operations and
one message's media/split/fold transformation are atomic; this is a work-count
bound and a cooperative time target, not a preemptive wall-clock guarantee.
Native layout of visible Markdown remains the host's work. Measure preparation
and actual layout separately; a successful helper replay cannot certify a live
frame or sustained recovery.

A running pass finishes when new text arrives. The newest source queues one
successor, so streaming cannot repeatedly discard progress through stable rows.
Each source Conversation remains immutable while a pass reads it. Native log
tailing reconstructs its successor in bounded record batches. Pending sends and
written answers are settled from the current outbox at the synchronous commit
boundary, after the last yield. A failed reconstruction or settlement leaves the
previous records and read offsets intact for retry.

## Invalidation and lifetimes

Conversation identity and presentation have different lifetimes. Changing the
agent, log, route or task binding discards the snapshot. Width/zoom, Find,
task/news/mention inputs, fold/open/result revisions and request-bound approval
changes cancel obsolete preparation but retain the last complete timeline until
its replacement commits. Cold conversation opens still show the opening notice.

Native action and measurement callbacks require the exact current snapshot and
presentation, including between invalidation and the next draw. Retaining a card
on screen does not let an old approval action run. Hover and scrolling remain
available during preparation. A deferred virtual-list callback paints its captured
rows even after a successor commits, satisfying the host's one-element-per-row
contract; only the current presentation updates range/scroll estimates. Reset,
close and genuine conversation changes also reject that old frame. Row view IDs
use the captured layout generation and content revisions, not a later frame's.

Quiet task and reach polls used to replace equal objects. Since presentation
comparison used those identities, the next draw discarded the complete history
and showed Opening again. A list callback deferred across that invalidation or a
new snapshot returned an empty array for a nonempty requested range. The focused
replay in `service/chat-flicker.test.ts` reproduces both failures in the actual
native methods/callback. It establishes these JavaScript failure paths, not the
frequency of their interleaving in the live native scheduler.

Task/reach loaders now retain equivalent inputs, comparing their JSON data
outside render, and reject replies from an abandoned agent/process. Discovering
the same process's initial log does not discard its in-flight metadata loads.
Task progress still updates news/cards; retained linked Markdown depends on task
references, folders, titles and archive state rather than progress. Renaming a
task still updates its links. No poll interval or preparation budget changed.

Host `shared()` reads marshal fresh objects. Context comparison therefore uses
scalar signatures for this conversation's relevant screen cards and machine
names, rather than shared-object identity. Worker cards include `requestHash`
and their approval status/reason, including updates made in place.

Question and secret card owners expose a scalar revision for actual local UI
mutations (clicks, keyboard steps/picks, Other input, detail expansion, scope and
save/error states). Those revisions queue a successor snapshot without hiding or
replacing the current native input. Unchanged render reads no question answers or
masked values. Own, worker and Codex keyboard sinks also validate their snapshot
before delivering a cached key event.

Reset cancels queued history callbacks and detaches the transaction in constant
work. Close does the same before the existing hook handoff and linked Markdown
cleanup; history snapshots own no native child handles. Old reads and callbacks
cannot publish after reset, close or a conversation change.

## Verification and installation handoff

`service/chat-preparation.test.ts` exercises the full row path, including cold and
unchanged preparation, fresh source objects, streaming fairness, invalidation,
failure/retry and native-shaped shared reads. Its synthetic golden snapshot was
generated with the pre-change implementation and covers media, code, folding,
news/artifact joins, cards, action bands, pending and replied messages.
`service/chat-read-transaction.test.ts` covers read failures, stale reads and
outbox changes during reconstruction. `core/chat-preparation.test.js` covers
fractional/nonfinite geometry inputs, selection parity and indexed settling/expiry.
`service/chat-flicker.test.ts` covers long synthetic history, equivalent real poll
results, retained timelines during resize/stream/status changes, deferred frame
cardinality, stale actions/generations, scroll-state preservation and visible
preparation errors. These tests use inert host handles: they cannot prove native
layout, paint, pixel anchoring or scheduling. The web chat uses keyed React rows
and does not consume the native `Preparation` lifecycle; native-only fixes do not
imply a web behavior change.

Private conversation replays must use the verified agent's authoritative FIND
result. Keep raw logs, extracted items and full-window captures outside Git and
published proof. Treat recorded commands as inert strings. A native scratch check
must use trusted extracted helpers, static data and inert lookups/actions; never
initialize real Chat or the settings mod. `herdr-app check` does not await timers
or root close, so explicitly exercise cooperative work in its scratch harness and
keep the measurement scope stated.

Installation belongs to the coordinating Assistant. After exact-head CI passes,
use the normal installer, then verify the same live agent through repeated fresh
Chat opens, stream updates and several reload intervals. Retain Terminal as the
fallback. If rollback is necessary, the coordinating Assistant should reinstall
the previous main revision through that same normal path; do not replace a log,
change accounts or clear history/settings to obtain a passing view.
