# Find in Chat

Use **Ctrl+F** (or **Cmd+F** in the web app on Mac) within a conversation. The
web Chat header also has a Find button for touch users, including a task or
subagent's own chat. Type the words or punctuation to find. The counter is an
**occurrence** counter, not a count of messages. Enter/F3 moves forward to the
next occurrence, Shift+Enter/Shift+F3 moves back, and the arrows wrap at either
end. Escape or Close removes the search and its highlights.

- Find is literal and case-insensitive, using Unicode case folding and original
  text offsets. Regex-like characters, backslashes, Markdown code, and Unicode
  text have no special search syntax. Matches are non-overlapping.
- It searches the loaded retained conversation, including the person's prompts,
  agent replies, launch/agent briefs, and retained fenced code. Inline Markdown
  text can match across emphasis, links and code spans. The web app also indexes
  displayed card titles, attachment filenames and captions; filenames are shown
  when needed. Waiting/unsubmitted messages and secret inputs are not indexed.
- An occurrence in a rendered diagram's original code opens a read-only source
  view for Find. If only a displayed label matches (for example, a line break
  represented by `<br>` in the source), the preview stays and its matching label
  is shown with highlighted text. Neither view counts both representations of the
  same diagram. Source-only Markdown matches, such as a link destination, have
  a clearly labelled source view/readout while the original message stays.
- A matching folded message opens as needed. The original manual fold/diagram
  choices are preserved on close. In the web app the selected text range is
  scrolled into view, including a range far down one fenced block. Native Chat
  divides long plain text, complete Markdown blocks and matching code into
  manageable virtual rows, and displays the exact selected occurrence with its
  surrounding words in the Find bar. A giant single rich block (such as a table)
  can still only be scrolled to its row: the readout gives its precise match.
  Native tables, task lists and other rich blocks that the native HTML path
  cannot faithfully render keep their original Markdown and show a highlighted
  match excerpt rather than changing their format.
- The existing Copy actions always use the original message or exact fenced
  source, not the search representation. Find does not change retained logs,
  messages, roles, accounts, or task/Feature ownership.

## Earlier history

The counter applies only to loaded history. **Search earlier** brings in one
more log page (up to 200 records); it does not silently scan an entire log. A
new page or streamed reply updates the count without selecting a different
existing occurrence. Closing Find clears its query; a replacement conversation
cannot inherit the previous conversation's selected occurrence.

Search retains at most 20,000 navigable occurrences, scans up to 256 Ki UTF-16
code units per text run, and limits a query to 4,096 code units. When a limit is
reached the bar explicitly labels the count as partial. Native search and the
web reader bound earlier-page retention to 10,000 log records (ordinary recent
history remains bounded by the existing reader). The original log is not
truncated. Historic lines not retained by the provider, deferred tool-output
bodies, hidden approval inputs and binary attachment contents are outside Find.
For links and other Markdown, rendered text takes precedence; the source
fallback is used when the literal query occurs only in source.

## Implementation and checks

`core/chat-find.js` defines literal matches, ranges, selection and limits.
`core/chat-find-markdown.js` prepares a parsed, escaped rich-text representation
for the native HTML TextView's mark spans. The original Markdown is never edited;
its Copy and navigation identities remain in the timeline. The web app indexes
real mounted text nodes in bounded passes; CSS Highlight ranges preserve the
DOM and selection, with a separate active color. The web CSS Highlight API is
required for colored text ranges.

The repository checks exercise matching, Unicode offsets, Markdown spans,
source/diagram fallback, virtual-row preparation, retained links, paging,
streamed records, stable selection, and limits. To exercise native eager
materialization without installing into the live home or starting another
window, copy `mods/chat` into a scratch folder, rename its `main.js` to `chat.js`,
copy `test/fixtures/chat-find-native.js` as `main.js`, then run
`herdr-app check <scratch> --print-spec`. The fixture does not initialize Chat.
This checks materialization, **not** native pixels or interactive deferred
layout.

For real web interaction using synthetic messages, build the branch, start the
loopback-only fixture `bun test/fixtures/chat-find-web.ts web/dist`, and open
`http://127.0.0.1:19559` in the task browser. Run
`bun test/fixtures/chat-find-browser.ts <task-browser-CDP-url> http://127.0.0.1:19559 <scratch-shots-dir>`
against a fresh fixture. It exercises actual range selection and scrolling in
Chromium, mobile and desktop layout, earlier/history updates and closing Find.
No real conversation or agent is involved.
