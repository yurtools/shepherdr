# Add-ons

Everything in Yurherdr is an add-on made of Herdr mods. [`lib/addons.json`](../lib/addons.json) is the list: each
add-on's mods, the layout blocks it fills, its keys, helpers, role instructions and what it needs. The installer
installs all of them (one layout listing gives everything); Yurherdr settings → Window → Add-ons switches the ones
marked below off and on again, at once and on every machine (Everywhere's `off` in `~/.config/shepherdr/settings.json`).

| Add-on | Switch | What it is | Off means |
|---|---|---|---|
| Core | always on | The layout: sidebar (spaces-chat), tab bar (tabs-tasks), pane header (pane-chat), sidebar foot, status bar, toasts, menus and dialogs, Yurherdr settings | — |
| Tasks | always on in 3.1.35 | The Tasks panel, a task's view (files, changes, pull request), the Accept card, `herdr-task`, worker.md and reviewer.md | — |
| Assistants | always on in 3.1.35 | An Assistant per space (coordinator, assistant.md), task news. Needs Tasks | — |
| Chat | always on in 3.1.35 | Agents as a chat, model choice, opened images | — |
| Questions and permissions | always on in 3.1.35 | Question and permission cards from Claude Code and Codex hooks. Needs Chat | — |
| Secrets | always on in 3.1.35 | `herdr-secret`, the masked card, Settings → Secrets | — |
| Keyboard | always on in 3.1.35 | Jump (Ctrl+K), the keys list (Ctrl+Shift+?) | — |
| Artifacts | yes | Agents' reports and draft screens beside the chat, `herdr-artifact` | No Artifacts button in the tab bar |
| Voice and dictation | yes | Calls with Yurherdr (ElevenLabs), dictation (ElevenLabs speech to text, the same key). Needs Chat | No call or mic buttons; their keys do nothing |
| Reactions | yes | React to a message with an emoji. Needs Chat | No smiley on messages (agents' own reactions still show) |
| Task browser | yes | A browser per task you can watch and take over (`herdr-browser`). Needs Tasks | No Browser tab; workers aren't given a browser |
| Autopilot | yes | An Assistant works on its own from its heartbeat. Needs Assistants | No Autopilot switch in the header; no wake-ups |
| Other machines | yes | Keeps herdr-task, its helpers and the role instructions the same on every connected machine, and maps their Assistants. Needs Tasks | Nothing is sent to other machines; the reach map stays on this machine and Find machines is off ([what Yurherdr contacts](install.md#what-yurherdr-contacts)) |
| Usage insights | yes | A private log of how you use Yurherdr, only on your own machines, for your Assistant's tips when you ask ([insights.md](insights.md)) | Nothing is recorded; what was kept stays until you delete it |
| Web | yes | The web app on your tailnet (docs/web.md) | The web app stops and isn't shared; the service keeps its background work |

An add-on can't be turned on while one it needs is off, nor off while an add-on that needs it is on: its line in
Settings says which.

## How a switch works

- The window's mods read shared `addons.off` through `lib/addons.js` (`on("voice")`), so a flip shows at once.
  `tabs-tasks` loads it from `~/.config/shepherdr/settings.json` when Herdr starts.
- herdr-task reads Everywhere's `off` (`addon_off()` in `herdr_task/base.py`) for its background work: Autopilot's
  wake-ups, the task browsers, the sync to other machines.
- An off add-on's keys stay in `keys.json` and do nothing, so turning it back on needs no merge.
- The web app leaves an off add-on's plugins out (its `web` list in `lib/addons.json`); a page open at the flip
  starts again without them.

## Included workspace extensions

Chat, Feature Assistants, Sessions, the persistent Files tree and separate document
panes are part of this development build. Markdown/CSV previews, source highlighting,
DOCX/Excel content views, file references, clipboard menus and approval controls
are described in [the workspace guide](workspace.md). They are not separate TUI
plugins and do not need the removed Agent Chat or standalone Markdown panels.
Blueprint is a separate optional mod; Yurherdr does not bundle or remove it.

The existing add-on switches retain their source IDs and storage. A future split
into separately installable mods would require its own manifests, recipes and
compatibility work; the Gallery currently lists the complete layout.
