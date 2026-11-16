# Workspace UI development build

The implementation is available on `main`. It is based on upstream 3.1.35;
there is no new tagged release. The additional source and Office previews are included.

## Everyday workflow

Select a space in the left sidebar. **Sessions** below it lists that space's saved
conversations; the tab bar holds the open tabs. The **Files** button opens the
project tree. File contents open in a separate document pane.

| Action | Control |
| --- | --- |
| Use the same agent as chat or a terminal | **Chat / Terminal** in its pane header |
| Change the conversation width | **Wide / Comfortable** in the Chat header |
| Show the Assistant or another running agent alongside | **Beside…** in a pane header |
| Reopen a closed Codex conversation | **Sessions → conversation → Resume** |
| Resume a conversation alongside the current pane | **Sessions → conversation → Beside** |
| Edit or render Markdown / CSV | Open it from **Files**, then choose **Source / Preview** |

The **Agents** button opens a right-hand panel listing the space's Assistant and
running agents, including task workers. **Open** focuses their existing view;
**Beside** shows the same session alongside the current pane. It does not launch
another agent. **Sessions** below Spaces remains the saved local Codex history.

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
