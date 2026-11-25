# Yurherdr workspace guide

Yurherdr is an IDE-style development workspace derived from Shepherdr 3.1.35.
This guide describes implemented behavior; there is no new tagged release. The
repository is still `yurtools/shepherdr`. Commands, storage paths and some current
UI labels retain Shepherdr names for compatibility; see [origins](upstream.md).

## Everyday workflow

Select a space in the left sidebar. **Features / Sessions** below it follows the
selected space; the tab bar holds the open tabs. The **Files** button opens the
project tree. File contents open in a separate document pane.

New native agent views open in **Terminal**, including task workers, space
Assistants, Feature Assistants, resumed sessions and **Beside** views. Use the
existing **Chat / Terminal** switch to change views of the same running agent.
Opening an already-open view focuses it and keeps its current selection.

Feature status includes its live workers, so a waiting Feature Assistant with a
working worker shows **Working · 1 worker**, rather than Paused. Worker Chat selects
the main CLI conversation even when Codex also holds internal Auto-review logs.
Large incoming context messages fold like long replies; expanded text is divided
into bounded rows, keeping the full message available for Copy.

Use **Ctrl+F** to find literal words and punctuation in the current Chat. Find
counts each matching occurrence, highlights it, opens folded text or diagram
source when needed, and can load earlier pages. The web Chat header also has a
Find button. See [Find in Chat](chat-find.md) for navigation and search limits.

Chat previews supported Mermaid flowcharts inline in both user and agent
messages. **Show source / Show preview** switches views; **Copy** keeps the
original Mermaid text. See [inline flowcharts](chat-flowcharts.md) for supported
syntax, web/mobile behavior and fallback limits.

For a mistaken prompt sent to the wrong agent, use the guided **Discard mistaken
turn…** action on supported Codex history, or withdraw an unsent held message.
See [discarding a mistaken turn](chat-context.md) for the exact context boundary,
provider support and what is not undone.

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

The space Assistant is the ongoing conversation about the whole project. A
Feature Assistant leads one named change: it keeps a separate objective and
conversation, breaks the work into tasks, starts and supervises workers, receives
their results and coordinates review. You can keep several features open side by
side without mixing their conversations or task ownership.

For example, **CSV export** can coordinate an API worker and a UI worker while
**Accessible filters** develops independently. Return to either feature to see its
own discussion, tasks and worker updates. Both reuse the space's Worker, Reviewer,
review, worktree and task settings, while the Feature Assistant's own agent,
account, model and prompt can be configured separately.

Feature conversations do not automatically create separate integration worktrees.
Use the worker/task worktree settings to isolate code changes when features run
in parallel; the feature's recorded project folder remains its starting context.

- **+ → Start feature…** opens a compact form with a **Feature name** field.
  Press Enter or **Create feature** to start its Assistant in Terminal using
  its configured account and instructions.
- The flag beside a reply's Fork action starts a feature with the chosen reply
  as its objective and bounded supporting context up to that point. It starts
  the feature agent, which generates its title using the normal signed-in CLI;
  no API key is required. The original Fork action retains its existing behavior.
- **Yurherdr settings → Agents → Feature Assistant** chooses its model,
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
  If a reboot leaves a restored Feature Chat without its agent (or with only
  a shell), selecting that tab resumes the saved conversation with its original
  account in the same pane. The selected tab is checked at startup; other chats
  wait until selected. A deliberately stopped agent stays stopped until Resume
  or an explicit reopen. Reopening from Features also restores its last view
  when known. A missing saved session or account is reported rather than replaced.
  Older records with no recoverable session are not treated as newly created
  features; creating a new feature is an explicit separate action.
  Feature task news and delegated approval reviews return to the owning feature,
  including after a feature agent restarts. Space Autopilot continues to belong
  to the main Assistant. Existing tasks are not transferred when a feature starts.

Feature records are machine-local `data/workspace-features.json` in Herdr's app
folder. Native Feature creation currently supports local spaces. Existing remote
Assistant and task behavior is retained. Ordinary Sessions history still indexes
Codex logs; named feature records also retain Claude sessions captured by a live view.

## Review completed work

**Review** opens a task’s evidence without approving it. The final button says
**Accept & merge** when its branch still needs merging, or **Mark done** when the
output only needs completion recorded. Both use the same acceptance checks; a
merge must succeed before its task finishes. The card names the merge destination.

**Later** keeps the task Ready and unaccepted, with its branch, pull request,
proof and dependencies intact. It moves to **Deferred** and leaves the active
green counts. Review it there, or choose **Restore to review**. Reloading and
unrelated updates preserve Later. A new Ready cycle after further work brings it
back; questions and errors still surface.

**Review ready (N)** opens a list in the owning Assistant’s conversation. A Feature
Assistant covers only its saved feature; the space Assistant’s list explicitly
covers the whole space. Ordinary agent chats have no invented review scope.
Select individual rows or **Select all eligible active**; Deferred rows need an
explicit selection. Each row links to its evidence and proof. The final button
states the chosen consequences, such as **Merge 2 and complete 1**.

The selection stays fixed while tasks are checked and accepted one at a time.
Changed work or destinations require a fresh review. Base advances caused by
previously selected successful merges can continue, with fresh checks for the
next task. Results distinguish completed work, waiting merges and refusals;
refresh the review to inspect and retry remaining work. Retrying a recorded
acceptance does not accept it twice.

## Browser tabs and web-chat shortcuts

Use **+ → New browser tab…** for an editable URL, or choose a configured web-chat
shortcut such as ChatGPT. Each opens in its own workspace tab. The browser viewer
provides Back, Forward, Reload, a **URL** button and **Ctrl+L / F6** to edit the address.
The **Window** action opens the same automated browser profile in a full browser
window. **System browser** opens the current URL in your normal desktop browser,
using that browser's login; it does not share the workspace's isolated profile.
Use System browser if a site repeatedly asks for human verification. The embedded
viewer uses automated Chrome, which some sites' verification checks do not support;
opening its Window is not guaranteed to resolve that limitation. Verification must
be completed by you, and is not automatically solved by Yurherdr.
Clipboard text uses the desktop clipboard;
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

Launchers and space roles have different support. **+** can open other installed CLIs
in terminals, while full Chat and Assistant/Feature/Worker/Reviewer selection currently
supports Codex and Claude Code. Kimi and OpenCode role adapters are not implemented;
named account profiles are Codex-only. Adding a launcher does not add a space-role adapter.

If a launcher says **Not installed** while its command works in a terminal, the desktop
app may have a different executable search path. Set an absolute executable path in
**Manage…** or correct the app's launch environment. Installing a second copy is not
required when the executable already exists.

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
Reply menus offer **Copy message** for the complete message and a **Ctrl+C**
(**Cmd+C** on macOS) hint for copying a selection directly. Herdr's current mod
SDK cannot read the rendered text selection or dispatch the native Copy action;
a JavaScript action with the same name does not invoke it. Opening this menu
never reads or changes the clipboard. Clipboard menu text/selection snapshots
stay in the originating Chat view; only action IDs are shared between mods.
Terminal menus offer
Copy, Paste and Select all; Cut is disabled because terminal output is read-only.
When right-click belongs to a terminal program, **Shift+right-click** opens Herdr's menu.

## Space-specific instructions

In **Yurherdr settings → Agents**, choose a space in **Applies to**, then use
**Space instructions** beside Assistant, Feature Assistant, Workers or Reviewer.
The multiline field saves automatically, including when changing scope or closing
Settings. **Clear** removes only that space’s addition for that role.

The effective prompt is always **the current global role prompt + the space’s
additional instructions**. Global prompt files keep being edited under
**Everywhere → Edit instructions**; adding space instructions does not modify
those files or another space. Global changes are picked up on the next fresh start.
Existing conversations and resumed sessions retain their current context.

Assistant/Feature starts, fresh Assistant restarts and new task workers receive
these additions. Task handoffs receive the worker addition too. Code-review workers
read the current global reviewer prompt first, followed by a task-specific file
containing the space addition; another space’s reviewer prompt is never substituted
into the global template.

## Links in Chat

Click a project-file link in an Assistant, Feature or agent reply to open it in the
same tab’s document pane, keeping the chat and Files tree available. An existing
document pane in that tab is reused. Relative paths resolve against the agent’s
working folder; absolute paths and local `file://` links are supported. A source
location such as `Foo.java:269`, `Foo.java:269:4` or `Foo.java#L269` opens the editor
at that line (and column, when given). Web links open in the system browser.

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
Worker and Reviewer choices come from the space, then its legacy machine settings,
then Everywhere. Each role is a whole choice: selecting plain Codex uses the default
account, even when an inherited role or Assistant uses a named account. Resetting a
role (unset or null) inherits the role above; unset fields inside a chosen role use
CLI defaults. If no Worker choice exists, the space Assistant's choice is used,
then Claude's defaults. Feature Assistants share these Worker/Reviewer choices;
their own account never replaces them. The regular Herdr program entries still
determine which account opens when starting a normal agent tab.

Tasks retain their space ID, including across project-folder changes and worktrees.
Without a space ID, a folder identifies a space only when exactly one matches.
Task agent/model/effort overrides win; changing CLI resets incompatible role fields.
Queued starts keep their captured Worker command; edits to the task's agent choices
refresh it unless it was an explicit custom command. Moving a queued start to a
different space resolves that space's Worker. Reviewer settings and notes are read
when the brief is built. A missing or deleted named profile blocks launch rather
than selecting another login; remote starts resolve only destination-local profiles.

Resume, switch, fix and crash recovery retain the recorded session's account and
launch choices. An explicit account change starts a new session with a handoff.
New tasks use current settings. An automatic Reviewer fallback to the worker's CLI
also keeps the worker's account, and the brief explains the fallback. Explicit
plain or named Codex Reviewer choices select their own account. A missing named
reviewer never falls back; an unavailable model can fall back to that same account's
default model. Reviewers remain read-only regardless of role permission settings.

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

**Files** stays as a tree for the selected space. In **Space settings**, the
**Project folder** field accepts a path or **Browse…**; **Save folder** validates an
existing local directory and updates both Herdr's space folder and the saved Files
root. **Files → Folder…** uses the same save path. Remote-space folder editing is
not currently offered. Running agents and existing Feature records keep their
folders; new Assistants and new Features use the new root, including before Files
has mounted. The override is saved in `data/workspace-folders.json`. Switching
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

- Markdown: **Source / Preview** switches between source and bounded rendered content.
  Larger files offer paged read-only source instead of refusing to open.
- PDF: read-only visual pages with previous/next, zoom, Fit, Reload and Open
  original. Local native rendering needs Python and Poppler on Linux/macOS;
  remote files and Windows show a fallback. PDFs never enter the text editor or
  Save path. See [PDF preview](pdf-preview.md) for limits and proof boundaries.
- CSV / TSV: **Source / Preview** switches between raw text and a table. Choose
  Auto, Comma, Tab or Semicolon for the delimiter. Browse row and column pages or
  jump to a row, including in files much larger than the full editor can hold.
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
**Discard draft and reload** explicitly accepts the disk version. Clean full-buffer views
refresh automatically. Large read-only pages ask you to reload if the file changes.
Remote text files are read only. Office and PDF files have no Edit or Save action.

**Find** (Ctrl/Cmd+F in the active document) highlights matching text or cells
and goes to the matching page/sheet. Enter/Shift+Enter or the arrows step
through matches; Escape closes Find without altering the file. Bounded or
unsearchable previews explain their limits. See [Document Find](document-preview.md#find-within-a-document)
for mode-specific behavior, including searchable PDFs and the web text-prefix limit.

Ctrl+Shift+P selects Preview; Ctrl+Shift+O selects Source in a document pane.
The equivalent commands are `workspace-document.preview`,
`workspace-document.source`, `workspace-document.find`, and `workspace-document.save`.

Full-buffer editing is limited to 400,000 UTF-16 units and 1 MiB of UTF-8. CSV/TSV
preview supports 32 MiB files and up to two million records, with 40 rows and 16
columns per page. Larger text files can be read in approximately 32 KiB source
pages without entering Save. Markdown and source highlighting have separate
render budgets; Office and PDF keep their format-specific guards. Raster images
in Files offer Open original instead of attempting text decoding. The tree
retains the limits of 500 entries per folder and 5,000 total. See
[Document preview limits](document-preview.md) for the detailed budgets,
platform/remote requirements, web differences and measured results.

## Changes across repositories

The native **Changes** panel follows the selected space's saved project folder,
independently of the focused terminal or Feature worktree. It discovers the folder's
own enclosing repository and repositories below it. Select **All repositories** for
collapsible groups, with changed repositories first, or pick one repository to inspect its branch and changed files.
Click a file to see its diff. Identical relative paths in different repositories stay
separate. Empty repositories stay visible with “No uncommitted changes”.

To commit, select one repository, enter its message and press **Commit**. The panel
shows the full destination path and stages/commits that repository's changes only.
Message drafts and repository selection persist separately per space/folder/machine.
Running workers and their worktrees are not selected or changed by the panel.
Tracked submodule references remain in the parent; their checked-out repositories
also have their own groups. Untracked nested repositories are excluded from parent
staging. Already-staged embedded repositories require reviewing the parent's index
before committing. Failed commits can leave files staged, as with ordinary Git.

Changes refresh every ten seconds; discovery runs every minute or immediately with
**Refresh**. Discovery does not follow directory symlinks and skips `.git`, dependency,
cache and build folders. It is bounded to six levels, 4,000 directories and 50
repositories; incomplete discovery is reported. Narrow the space folder to discover
more repositories. Parent staging excludes embedded repos even when discovery skips
their dependency/build folders. The list shows up to
1,000 changed files across repositories; previews are bounded to 1,500 lines.

Python 3 and Git must be available on the space's machine. Remote reads and commits
use the same helper through Herdr's remote execution API, with the same bounds;
remote interactive authentication/signing prompts cannot be answered in this panel.
This extension is native-only; the web Changes panel retains its existing behavior.
If an update preserves your customized layout and writes `shepherdr.json.new`,\n+adopt that layout or change only the `changes` block's content mod to\n+`workspace-changes` in your existing layout.

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

Open **Yurherdr settings → Agents** (or the same tab in Space settings) and scroll
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
personal shortcuts. Pick **shepherdr** (Yurherdr’s compatibility layout ID) in Herdr's layout selector if it is not
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
from an extra view. Opening a new Assistant starts it using its configured space
account and instructions. Older, saved agentless Chat panes still start on their
first message; opening one beside another pane starts/adopts that same slot in
Terminal. An already-running Assistant is adopted without launching another.

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

**Resume** opens the same conversation in a new Terminal tab using its original
Codex account. **Beside** resumes it alongside the pane from which Sessions was
opened. For an already-running conversation these actions focus its original
chat or add an extra view, rather than launch another process. Resumed sessions
are ordinary agent views and do not replace the space’s current Assistant.

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
