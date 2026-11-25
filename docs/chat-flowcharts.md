# Inline flowcharts in Chat

Both the person's messages and the agent's ordinary Markdown replies can contain
a fenced `mermaid` block:

````markdown
```mermaid
flowchart TD
  A([Start]) --> B{Ready?}
  B -->|Yes| C[Publish]
  B -->|No| D[Revise draft]
  D --> B
```
````

Chat draws the flowchart in place. **Show source** replaces the picture with
the original Mermaid text; **Show preview** restores it. **Copy** copies the
original source in either mode. Wide or tall drawings scroll within the card,
so labels remain readable on narrow panes and phones. Ordinary code blocks
and the message's own Copy and other actions are unchanged.

## Syntax and boundaries

The same text-only subset of Mermaid runs in native Chat and the web app:

- `flowchart` or `graph` with directions `TD`, `TB`, `BT`, `LR`, `RL`
  (top-to-bottom by default).
- Nodes with bare identifiers or labels in brackets, parentheses, braces,
  stadiums, circles, subroutines, cylinders and hexagons. Quoted labels,
  `<br>` label breaks, and wrapped long labels are supported.
- Directed, undirected, bidirectional, dotted and thick edges, chained edges,
  loops, `-->|label|` and `-- label -->`, newline/semicolon-separated
  statements and plain `%%` comments.
- Top-level Markdown backtick or tilde fences, including longer matching
  fences. An unfinished fence shows its text and waits for the closing fence;
  it does not attempt layout.

This is not the complete Mermaid language. Subgraphs, classes, custom
styling, click/URL actions, configuration/front matter, arbitrary HTML, other
diagram types and syntax outside this subset remain copyable source with a
reason the preview is unavailable. A malformed graph does not show a partial
diagram. Native messages still awaiting delivery use the existing pending
message row until the log supplies the confirmed message.

The preview is bounded to 4,000 source characters, 20 nodes, 28 edges, 100
characters per label, 240 routed points, and a 3,600-unit drawing extent.
At most 12 diagrams are laid out per message; further fences show source.
Oversized source is shown up to 4,000 characters/120 lines with a note; Copy
still gets all of it. The drawing viewport is at most 420 px high. Horizontal
overflow stays inside the card rather than enlarging the pane.

## Implementation

`core/chat-fences.js` recognizes fences and keeps source separate from Markdown
and media extraction. `core/chat-flowchart.js` parses only the supported data
grammar, maps node IDs to internal numeric IDs and passes fixed, bounded graph
inputs to [Dagre](https://github.com/dagrejs/dagre) 1.1.5 (Graphlib 2.2.4).
The layout uses longest-path ranking and fixed initial ordering rather than
iterative crossing minimization.
The vendor file is the exact pinned upstream browser bundle with its MIT
license and a small ESM wrapper, allowing it to run without Node or a DOM in
the native mod. The package/lock and a test verify the bundled version and
license; to update it, replace the upstream distribution between
`const module = ...` and `export default module.exports` and keep the license
and version comment current. Then run `bin/sync-shared`.

There is no Mermaid runtime, external renderer, browser launch, arbitrary
SVG/HTML injection or evaluation of message text. Both surfaces use only
known shapes, numbers and literal labels from the shared geometry. The
web draws React SVG elements with CSS theme colors; the native mod uses
GPUI's `PathBuilder` and `window.paint_path` plus text and layout elements.
The latter are available in Herdr App 0.1.16 / gpui-shell 0.7.1.

Native layout happens during cooperative history preparation, not a virtual
row's paint. Geometry from unchanged rows is reused across snapshots; the
shared source cache holds at most 96 entries and only plain data. Measurement
uses a height-only placeholder rather than constructing paths. Source switches
use the list's existing click routing; no per-row callbacks, subprocesses,
temporary graphics or retained native paths. Web source/copy state lives in
the card; its resize observer and feedback timer are cleaned up when the card
leaves the view. Both renderers use their current theme at paint time.

## Isolated checks

The ordinary repository checks include the shared grammar, source preservation,
media/fence handling, limits, geometry, native history preparation and click
routing, and the web's SVG/escaped fallback contract.

To exercise the actual native path/element materializer without starting
another Herdr App or installing any mod, use the synthetic fixture:

```sh
scratch=$(mktemp -d)
mkdir -p "$scratch/core/vendor"
cp test/fixtures/chat-flowchart-native.js "$scratch/main.js"
cp mods/chat/flowchart.js "$scratch/"
cp core/chat-flowchart.js "$scratch/core/"
cp core/vendor/dagre.js "$scratch/core/vendor/"
printf '%s\n' '{"place":"none","title":"Synthetic flowchart fixture"}' > "$scratch/mod.json"
herdr-app check "$scratch"
```

The hidden check materializes eager elements but does not prove native paint,
deferred list layout, pointer interaction or macOS. Do not install the branch
in a live home or open another window just to obtain a screenshot.

For the real web Chat with synthetic messages only, build the branch and run
`bun test/fixtures/chat-flowchart-web.ts "$PWD/web/dist"` (loopback port
19444). Open `http://127.0.0.1:19444` in the task browser. The fixture serves
the built app and a minimal chat WebSocket, not the real service. The
`/fixture/complete` endpoint sends the closing fence for the incomplete
message, exercising the real update path. Check **Show source**, **Copy** and
**Show preview**, horizontal scroll, light/dark media and a phone-sized
viewport. No live account, log or data is used.

## SHEP-44 validation

On Linux with Herdr App 0.1.16 and Bun 1.4.4, the final implementation passed
shared-copy, JavaScript, shell, JSON and TypeScript helper checks, TypeScript
typechecking and both Vite builds. The full guarded Bun run passed all 1,131
tests; Python discovery ran 876 tests with two skips and exited zero.
Scratch-root installer dry-run, install, doctor and uninstall passed. The
first sandboxed Bun run could not open its isolated loopback/Unix sockets;
the same suite passed on the guarded rerun without removing test isolation.

The native synthetic fixture passed the actual Herdr hidden check. The
production web build rendered the agent's branching flowchart and the user's
wide graph, retained ordinary fenced code, displayed malformed and incomplete
source, and changed the incomplete block into a diagram on the WebSocket
update. At 390 px width, an emulated touch swipe scrolled the graph to its
right edge without widening the page. Light/dark and desktop/phone resize
were inspected; switching source and pasting the Copy result into the
synthetic composer reproduced the original 123 characters exactly.

Native on-screen paint, native pointer scrolling/copy in an actual
conversation, macOS and physical phone hardware remain unverified. The
branch was not installed in the live window.
