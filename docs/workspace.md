# Workspace UI development build

This guide describes the current development checkout, based on upstream 3.1.35.
There is no new tagged release. The additional source and Office previews are included.

## Everyday workflow

Select a space in the left sidebar. **Features / Sessions** below it follows the
selected space; the tab bar holds the open tabs. The **Files** button opens the
project tree. File contents open in a separate document pane.

| Action | Control |
| --- | --- |
| Use the same agent as chat or a terminal | **Chat / Terminal** in its pane header |
| Change the conversation width | **Wide / Comfortable** in the Chat header |
| Show the Assistant or another running agent alongside | **Beside…** in a pane header |
| Reopen a closed Codex conversation | **Sessions → click a conversation** |
| Resume a conversation alongside the current pane | **Sessions → Open… → conversation → Beside** |
| Edit or render Markdown / CSV | Open it from **Files**, then choose **Source / Preview** |

The **Agents** button opens a right-hand panel listing the space's Assistant and
running agents, including task workers. **Open** focuses their existing view;
**Beside** shows the same session alongside the current pane. It does not launch
another agent. **Sessions** below Spaces remains the saved local Codex history; **Features** is the default tab for named feature work.

## Features

A space keeps its main Assistant for discussion and coordination. Each named
feature has an independent Feature Assistant that can start and supervise workers.
Both use the shared Worker, Reviewer, review, worktree and task settings.

- **+ → Start feature…** asks for a name and opens its conversation. Its agent
  starts with your first message.
- The flag beside a reply's Fork action starts a feature with the chosen reply
  as its objective and bounded supporting context up to that point. It starts
  the feature agent, which generates its title using the normal signed-in CLI;
  no API key is required. The original Fork action retains its existing behavior.
- **Shepherdr settings → Agents → Feature Assistant** chooses its model,
  thinking level, permissions and instructions; the space can override these.
  Features inherit the space Assistant’s account until you configure a Feature
  Assistant agent/account override. The account picker is available alongside its model.
- **Features** below Spaces lists the selected space's features with the
  Assistant icon and existing status colors. Click to focus or resume one;
  **+** starts another. The check mark marks it Completed, and **All** includes
  completed features with a restore action. This changes organization, not task
  acceptance or merge status.
- Closing a feature's Chat view leaves its record and workers available.
  Its recorded account, session, role and task ownership survive reopening.
  Feature task news and delegated approval reviews return to the owning feature,
  including after a feature agent restarts. Space Autopilot continues to belong
  to the main Assistant. Existing tasks are not transferred when a feature starts.

Feature records are machine-local `data/workspace-features.json` in Herdr's app
folder. Native Feature creation currently supports local spaces. Existing remote
Assistant and task behavior is retained. Ordinary Sessions history still indexes
Codex logs; named feature records also retain Claude sessions captured by a live view.

## Browser tabs and web-chat shortcuts

Use **+ → New browser tab…** for an editable URL, or choose a configured web-chat
shortcut such as ChatGPT. Each opens in its own workspace tab. The browser viewer
provides Back, Forward, Reload, a **URL** button and **Ctrl+L / F6** to edit the address.
The **Window** action opens the same browser profile in a full browser window when
sign-in or another site feature needs it. Clipboard text uses the desktop clipboard;
file selection in the viewer uses Zenity on Linux when installed (otherwise use Window).

Tabs retain their current URL and browser target in `data/workspace-browsers.json`.
Herdr keeps their tab order and selection. Viewer terminals survive an app restart;
if core recovery restores a dedicated viewer terminal as a shell, the tab watcher
restarts that viewer and loads its saved URL. Closing a workspace tab closes its
view; login profiles are retained. No browser or ChatGPT authentication is copied
from either Codex account.

Pages with the same profile share browser cookies within a space. Different spaces
are isolated by default. In a shortcut's Profile field, use a different name for a
separate login, or explicitly use `shared:name` to share that named profile across
spaces. Several pages in a profile have independent Chrome targets: navigating one
must not navigate its neighbors.

These are actual websites. A ChatGPT page uses the website's selected mode and
account; it is not a Codex agent and has no automatic local skills or project-file
access. Website login requirements still apply. ChatGPT account sign-in itself has
not been automated or asserted by the local browser fixtures.

## Manage the + menu

**+ → Manage…** edits Agents and Web chats. Agent entries update `programs.json`
without changing account wrappers or credentials. Disable hides an entry from this
menu; Remove deletes a custom override and keeps the entry hidden if it is built in.
Configured launchers appear first in a scrollable list, including named-account
wrappers such as Codex (Account 2). The editor has persistent field labels and a live
icon preview. Names, executable arguments and icons are editable. Web-chat entries have a name,
URL and browser profile. Shortcuts and hidden agents are saved in
`data/workspace-launchers.json`. Changes appear when reopening the menu.

## Skills, commands and clipboard menus

In a local Codex Chat, type **$** or **/$** for the assigned account's skills, including shared
user and project skills. **/skills**, or **/ → Skills**, opens the same picker. Disabled skill entries
in that account's config are omitted. **/status** is handled as a native CLI command
before reply quotes, task references or approval-card answers can alter it, and
shows its result in Terminal. In a not-yet-started conversation, it opens the agent
terminal first; enter `/status` once startup or folder trust is complete. Interactive
CLI menus continue to use Terminal.

Right-click the Chat input for **Cut / Copy / Paste / Select all**. Operations keep
the captured selection and do not edit a draft that changed while the menu was open.
Reply menus offer selected-text Copy and Copy message. Selected text is captured
before the popup takes focus. The native SDK exposes it only through Copy: a prior
text clipboard is restored until you choose an action, but opening this menu with
a non-text clipboard can replace it with the selection. Keyboard Copy avoids this
menu snapshot. Terminal menus offer
Copy, Paste and Select all; Cut is disabled because terminal output is read-only.
When right-click belongs to a terminal program, **Shift+right-click** opens Herdr's menu.

## Named Codex accounts

Account definitions live on each machine in
`~/.config/herdr-app/data/agent-profiles.json`. They are configuration, not source:
never commit authentication, personal home paths or this machine's profile file.
A role stores only the profile ID; the machine resolves its own definition.

```json
{
  "profiles": [
    {
      "id": "secondary",
      "name": "Codex (Account 2)",
      "agent": "codex",
      "home": "/path/to/secondary-codex-home"
    }
  ]
}
```

Use an absolute path to an existing, separately signed-in Codex home. Profiles use
that home's config, skills, MCP settings and model cache. Named profiles clear
inherited API-key and shared-database overrides before starting Codex. This keeps
separate ChatGPT logins separate; the account definitions contain no credentials.

In **Space settings → Agents**, select Codex and choose the account beside the
Assistant's model control. The account is assigned there, not in the chat composer.
A worker inherits the Assistant's account unless its role explicitly selects
another account. The regular Herdr program entries still determine which account
opens when starting a normal agent tab.

The chat composer shows the assigned account as a label, with separate **Model**,
**Thinking** and **Permissions** dropdowns. For a running agent, make the selections
and press **Apply** while it is idle. Applying these controls restarts the CLI
resuming the same conversation; simply switching **Chat / Terminal** does not
restart it. Model and reasoning options come from that account's Codex model cache.
If the cache is not available yet, start that CLI normally so it can populate it.

The installer records question-card hooks for configured Codex homes inside its
installation root. A profile outside that root needs its hooks configured
separately. Scratch-root tests never install hooks into an external home.

## Files and documents

**Files** stays as a tree for the selected space. **Folder…** assigns an explicit
local project root for that space, saved in `data/workspace-folders.json`. Switching
chat or document focus does not change it. Expanded folders and the selected file
are remembered per space/root.

Click a file to open it in a separate document pane. Further files open as tabs in
that pane. **+ Pane**, or Shift-click on a file, requests an additional pane.
Use **×** on a document tab to close just that file. Other tabs and the Files tree
stay open. Unsaved edits are kept as a recoverable draft; reopen the file to
continue editing. Closing the last file closes its document pane and returns the room to the remaining panes. If draft
storage fails, the file stays open with an error. Let an in-progress Save finish
before closing its tab. The command `workspace-document.close-file` closes the
active file.

- Markdown: **Source / Preview** switches between the editor and rendered content.
- CSV / TSV: **Source / Preview** switches between raw text and a table. Choose
  Auto, Comma, Tab or Semicolon for the delimiter. Arrow controls move through rows.
- Text and code: **Highlight / Edit** for HTML, CSS, TypeScript, JavaScript, Java,
  SQL, Bash, XML, JSON, YAML, Python and Terraform/HCL. Helm YAML and `.tpl` files
  color embedded `{{…}}` templates. Liquibase changelogs use their XML, YAML,
  JSON or formatted-SQL highlighting. The read-only Highlight view supplies its
  own lexical colors, so it does not depend on Herdr editor grammars. Edit uses
  the native editor. These are source colors, not semantic analysis, validation,
  autocomplete or an IDE language service.
- Word: read-only `.docx` content preview with headings, paragraphs, basic emphasis,
  bullets and tables. Page layout, images, comments and tracked-change fidelity
  are not reproduced.
- Excel: read-only `.xlsx`, `.xlsm` and `.xltx` worksheet tables with sheet buttons,
  sparse cells, cached formula values and common date formats. Formulas are not
  recalculated; missing cached values are identified. Charts, images, formatting,
  merged-cell layout and macros are not rendered or executed. Use **Reload preview**
  after saving changes in Office. Office preview is local-only; open a local copy
  of a remote file. Legacy `.doc`, `.xls` and `.xlsb` show a conversion instruction.

**Save** or Ctrl+S writes a local file only when its disk contents still match the
version loaded. Unsaved drafts are kept under `data/document-drafts/` and recovered
when reopening that file. A conflicting external change leaves the draft intact;
**Discard draft and reload** explicitly accepts the disk version. Clean views
refresh automatically. Remote text files are read only. Office files have no Edit or Save action.

Ctrl+Shift+P selects Preview; Ctrl+Shift+O selects Source in a document pane.
The equivalent commands are `workspace-document.preview`,
`workspace-document.source`, and `workspace-document.save`.

The editor accepts text up to 400,000 characters. CSV preview is bounded to 500
rows and 100 columns, showing up to 40 rows per page; Source retains the full file.
The tree retains the inherited limits of 500 entries per folder and 5,000 total.
Highlight shows at most 12,000 lines while Edit retains the full loaded source.
Office parsing is bounded to 64 MiB of uncompressed archive members, 16 MiB per
member and 400,000 output characters. Excel previews include at most 100 sheets,
500 rows and 100 columns per sheet, with 40 rows per page. A notice identifies
truncation. Open oversized or layout-sensitive documents in their usual app.

## Refer to project files in chat

Right-click a file in **Files** to copy its project-relative or absolute path, or
choose **Reference in chat**. The document toolbar provides **Copy path** and
**Reference in chat** too. If several chats are open in that space, choose the
target by its title and account. The file is added as an attachment to that pane's
existing draft; it is not sent automatically and does not change its agent/account.

In Chat, use **@ File** or type `@` after whitespace at the caret to open the project
file picker. Search by path, then Enter to choose or Escape to close. The picker
uses the selected space's Files root, respects Git ignores in a repository and
lists up to 5,000 files. Search is limited to that listing. Direct references from
Files are available for files outside the listing. The `chat.project-files`
command opens the same picker from the focused chat.

References use the file on disk, including unsaved document edits only after you
save them. Files on the agent's own machine retain their path; local attachments
for a remote agent follow the existing upload flow. A file on another remote
machine must first be copied to a location the target agent can access.

## Approval defaults and remembered decisions

Open **Shepherdr settings → Agents** (or the same tab in Space settings) and scroll
to **Approvals**. The default remains **Ask me**. Choose a default and optional
Assistant, Workers and Reviewer overrides. These settings are separate from the
chat composer's execution Permissions and from **Autopilot**. See
[approval modes, rules and limits](approvals.md) for the complete workflow.

## Installation and optional mods

Use [the contributor workflow](../CONTRIBUTING.md) for checks and a scratch-root
install before deploying into a live Herdr configuration. From the fork checkout,
update and review the installation with:

```bash
git switch main
git pull --ff-only
python3 bin/shepherdr install --source "$PWD" --yes --keys keep --dry-run
```

Apply the reviewed development build to the current user's Herdr installation:

```bash
python3 bin/shepherdr install --source "$PWD" --yes --keys keep
python3 bin/shepherdr doctor
```

The explicit source selects this checkout. **--keys keep** preserves conflicting
personal shortcuts. Pick **Shepherdr** in Herdr's layout selector if it is not
already active. The installer backs up replaced files and keeps personally edited
layouts, writing the incoming version beside them as `.new`; see the
[installation guide](install.md) before resolving a layout conflict. Keep using
this fork's intended branch for updates; there is no fork release tag yet.

The built-in Chat and document panes cover the Agent Chat and standalone Markdown
preview use cases. Those optional panels are not required; remove duplicates only
after verifying their replacements. Blueprint remains an independent optional mod;
the fork does not bundle or remove it.

## Chat width and agents beside each other

Chat uses the pane width by default. Click **Wide** in its header to switch to the
narrower **Comfortable** reading width, or click **Comfortable** to use the full
width again. The choice is remembered across chats; row measurements, message
actions and the composer use the same width. Click the chevron on a thinking or
tool-activity row to expand or collapse its details.

Click **Beside…** in any pane header and choose the space's Assistant or another
running agent. The new pane shows that existing session; it does not launch
another agent or change accounts. Repeat from either pane for more agents.
Selecting an agent already shown in the current tab focuses that view.

Each extra view has its own Chat / Terminal switch and **×** button. Closing it
leaves the agent and its original tab running. Closing or ending the original
agent still ends that session; extra views then show an ended-session notice.
Extra Chat views have separate drafts. Model/Thinking/Permissions changes apply
to the same underlying agent and preserve its original Chat ownership; if its
original tab is in Terminal mode, switch that tab to Chat before applying changes
from an extra view. A not-yet-started Assistant starts on the first message using
its configured space account.

Settings account/model menus and Chat dropdowns anchor to the control pressed,
independently of where the previous context menu was opened.

Chat row measurements now ignore small size jitter, stop remeasuring settled
rows, and change their render revision when reply content changes. Hover updates
only when crossing to another message. Scroll following uses the viewport's
position instead of treating a partially visible final reply as the bottom.
Expanded replies retain their natural height in the hidden measurement area.
A one-line native Markdown placeholder cannot shrink a long reply’s scroll range;
the estimated space stays available until the content finishes laying out.
Markdown inside Chat leaves scrolling to the conversation list.
Show more / Show less refreshes that message’s cached views, and callbacks from
an earlier pane width or fold state cannot overwrite current measurements.
Native checks cover repeated expansion and narrowing beside file preview.
Regression tests cover these paths; the exact long-conversation mouse-hover
scenario still needs confirmation in everyday use because the native automation
interface cannot synthesize that pointer interaction.

## Closed conversations

**Sessions** lives in the sidebar directly below **Spaces** and follows the selected
space. Drag the divider to adjust their heights. Search or filter the list, then
click a conversation to preview it and use its resume controls. The list refreshes
automatically about every 30 seconds; **Refresh** updates it immediately. Switching
spaces also updates the list and clears its search. In a collapsed sidebar, the
clock button opens session history.

The session preview shows this space’s saved Codex conversations. **Closed** is the default; **All** also shows conversations that are
still running. Search by conversation title, tab name, account or folder. Each
row identifies its account and last activity; the right side previews recent
messages without starting an agent or showing thinking/tool output.

**Resume** opens the same conversation in a new Chat tab using its original
Codex account. **Beside** resumes it alongside the pane from which Sessions was
opened. For an already-running conversation these actions focus its original
chat or add an extra view, rather than launch another process. Resumed sessions
are ordinary agent chats and do not replace the space’s current Assistant.

History includes saved logs that predate this feature, from the primary Codex
home and the named profiles configured for this machine. Folder history includes
sessions in the project folder and its subfolders. Chats observed after this
feature is installed also remember their space and custom tab name, preserving
that association if the project folder changes. Closing a tab ends its process;
its saved conversation remains available here. No authentication files or
transcript copies are put in the history metadata index.

This initial history view supports local Codex conversations. Other CLIs and
remote machines are not indexed yet. Preview is limited to 12 recent sampled
text messages; Resume loads the full conversation through Codex. Saved launch
options are retained when available; folder history restores the recorded model,
thinking level and basic permissions, defaulting to workspace write with approval
when older logs contain no permission metadata. Session availability depends on
the original CLI logs still existing and the original account remaining configured.
