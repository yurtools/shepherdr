# Chat image paste

Native Chat's Ctrl+V and Cmd+V bindings and its context-menu Paste action use
one clipboard extraction path. An offered bitmap attaches even when its copy
also supplies text or HTML metadata. The composer keeps its existing text and
quote for an image paste. Text-only paste replaces the captured selection as one
edit. Copied local file URLs remain file attachments; malformed and non-local
URLs are not treated as local paths.

Extraction captures the draft, agent and account. Duplicate notifications during
one extraction are ignored. If the draft or target changes before it finishes,
the extracted temporary files are removed and a notice asks the person to paste
again. Send waits for extraction. Each image gets a distinct local file, including
consecutive pastes within the same second. The existing preview, remove, draft
and attachment delivery paths handle it from there.

The web composer retains real clipboard File payloads alongside text/HTML. Its
preview uses the device's local file; upload begins only after Send. HTML image
URLs alone are never fetched. A browser cannot read copied local file URLs as
files unless the browser supplies a File payload.

## Native host dependency

Herdr App 0.1.16's installed `gpui-kit.d.ts` exposes
`Context.read_from_clipboard()` as text-only and `TextareaState.on("paste_other")`
as an event for a paste without text. Neither exposes bitmap bytes. The installed
`herdr.d.ts` declares `feedbackPasteImage()` as frame-only; ordinary Chat mods
cannot use it. Chat therefore uses external OS readers, through the established
`herdr.exec(command, arguments)` interface:

| Desktop | Reader | Formats |
| --- | --- | --- |
| Wayland | `wl-paste` from wl-clipboard | PNG, JPEG, WebP, GIF, BMP, TIFF; local `text/uri-list` files |
| X11 | `xclip` | The same MIME formats, from the `clipboard` selection |
| macOS | `osascript` with AppKit | Copied file URLs, PNG, or TIFF converted to PNG |

The reader must be installed and connected to the same desktop as Herdr App.
A missing reader or failed/unsupported image read produces a visible error.
Ordinary text can still paste when the image reader is unavailable. A known
image read failure retains the draft rather than substituting metadata text.
The current Linux development host has neither clipboard reader installed; this
task does not install packages or change desktop clipboard settings.

Only an explicit Paste reads the current clipboard. No history or PRIMARY
selection is read. Image bytes go directly into local `data/chat-attach` files
with private file permissions. Clipboard text and URLs are arguments/data,
never shell source. Native delivery transfers to another machine only when the
person sends, using the existing `hc put` attachment path.

## Regression evidence and boundaries

`service/chat-image-paste.test.ts` runs the actual native methods with substituted
host boundaries. `test/test_chat_clipboard.py` runs the actual Linux extraction
commands against byte-backed reader fixtures and verifies identical local and
simulated remote delivery bytes. The fixtures cover screenshot-only and mixed
metadata offers, copied URLs, missing/unsupported/failed formats, collision-free
names, removal, duplicate notifications and changed draft/agent/account targets.
`web/plugins/chat/paste.test.ts` checks real PNG bytes through browser File naming.
The mixed metadata assertions fail on the pre-fix `origin/main` source.

These tests are not native OS clipboard or native visual proof. The task proof
records isolated web UI observations separately. Actual native shortcuts,
macOS AppKit conversion, a real remote agent and installed CLI ingestion require
an activated branch with its desktop reader available; no live activation or
remote deployment is part of this change.
