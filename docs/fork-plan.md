# Workspace UI fork plan

This fork extends Shepherdr's existing Chat/Terminal workflow for Linux. Keep the
upstream implementation and make focused changes that can be reviewed and tested
independently. The requirements below are implemented on `main`;
see [the usage guide](workspace.md) for behavior and limits, including Office previews.

## Baseline and maintenance

- Start from upstream Shepherdr 3.1.35, commit
  `abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e`.
- Keep `main` as the fork's implemented workspace and reviewed changes; develop
  further changes on focused feature branches. Track original history via `upstream/main`.
- Keep the original MIT license and attribution.
- Review upstream changes before merging them into `main`.
- Audit installer and update repository references before installing a fork build,
  so an update cannot silently replace the fork with an upstream release.
- Use scratch-root installs and isolated test fixtures during development.
  Installing the fork into the active Herdr configuration is a separate step.

## Account-bound agents and chat controls

- Support multiple named Codex profiles with independent logins and state.
- The selected program/profile determines the agent when opening a regular chat.
  For the space Assistant, choose the agent/profile in the space configuration.
- Show the assigned agent/profile as a label, not another composer dropdown.
- Provide Model, Thinking level and Permissions dropdowns. Their options must
  reflect the assigned agent's actual capabilities, and selections must affect
  the agent rather than merely change a displayed setting.
- Preserve the assigned profile through launch, resume, fork, restart and model
  changes. Workers inherit the Assistant profile unless explicitly overridden.
- Switching between Chat and interactive Terminal must retain the same running
  session. Keep thinking and tool activity collapsible.
- Read profile commands and locations from configuration. Do not commit machine
  paths, credentials, authentication files or personal account settings.

## Files and a separate document pane

- Keep Files as a persistent tree. Selecting a file must not replace the tree.
- Resolve the tree root from the selected space's project folder, independently
  of the focused chat or document pane. Remember tree state per space.
- Open files in a separate document pane, with an explicit action to open another
  pane when needed.
- Support ordinary text files and highlighted source. Language targets
  include HTML, CSS, TypeScript, JavaScript, Java, SQL, Bash, XML, JSON, YAML,
  Helm, Liquibase, Python and Terraform. Use a lexical Highlight view independently
  of installed editor grammars; keep Edit available.
- Markdown supports Source / Preview in the document pane.
- CSV supports Source / Preview, with the preview displayed as a table and proper
  handling of quoted fields, delimiters and multiline cells.
- Keep source edits and previews consistent, and handle unsaved edits and external
  file changes without silently overwriting content.
- Provide bounded local DOCX content and Excel OOXML worksheet previews. Keep
  these read-only and document cached-formula, layout and legacy-format limits.
- Reference project files from Files, document toolbars and an `@` picker in Chat.
  Preserve each target pane's draft, account and space, and never auto-send.

## Side-by-side views and session history

Implemented on `main`:

- **Wide / Comfortable** controls Chat's reading width.
- **Beside…** opens an extra view of the space Assistant or a running agent,
  retaining its account and original tab. Extra views switch independently between
  Chat and Terminal; closing one leaves the original agent running.
- **Features / Sessions** sits below **Spaces**, with a draggable divider.
  Both follow the selected space; Sessions uses its configured project folder.
- Searchable **Closed / All** lists show saved local Codex conversations from the
  primary home and named profiles. Clicking a row resumes or focuses its conversation;
  **Open…** opens the read-only preview dialog with Resume/Beside actions.
  Refresh uses an icon.
- History checks for a running session before reopening it, focusing its existing
  view or adding another view instead of launching a duplicate agent.

- **Agents** opens a right-hand panel with Open/Beside actions for existing
  Assistant and worker sessions, without changing Sessions below Spaces.

General history indexing for other CLIs or remote logs remains outside the current
implementation. Named Feature records also retain Claude sessions captured by a live view.

The current development branch adds independent Feature Assistants with stable IDs,
shared Worker/Reviewer settings, per-feature task ownership and the space
Assistant's Codex account by default, with a selectable Feature role override. It also adds persistent per-space browser pages, web-chat
shortcuts and **+ → Manage…** for agent/shortcut configuration. These are native
local-space features; see [the workspace guide](workspace.md) for controls and limits.

## Scoped approval handling

Implemented: approval defaults and role overrides in Settings → Agents; Ask me,
Approved rules, Assistant review and Codex Auto-review. Exact/prefix rules retain
account, folder, scope and expiry, with history and revocation. Assistant review
uses request-bound tickets and a configurable policy; native review starts with
interactive Codex sandboxing. See [approval behavior and limits](approvals.md).
Autopilot remains a separate scheduling feature.

## Acceptance checks

1. Configure two independently signed-in Codex profiles. Verify normal agent tabs
   and the per-space Assistant select the intended account; model, thinking and
   permission changes retain that account and conversation.
2. Switch Chat / Terminal and Wide / Comfortable. Verify the same agent process
   continues running and thinking/tool activity remains collapsible.
3. Open the Assistant and another agent using **Beside…**. Switch each view's mode
   and close an extra view; the original tabs and agent processes must survive.
4. Use two spaces with different project roots. Verify Files stays a tree,
   documents open separately, and Markdown/CSV Source / Preview, edits, external
   changes and recovered drafts behave as documented.
5. Verify Sessions follows the selected space and its folder override. Switch
   spaces while loading history; late results must not replace the new list.
   Search, filter and preview without starting an agent.
6. Resume saved conversations from both Codex accounts in a new tab and beside an
   existing pane. Verify the exact session/account and avoid duplicate processes
   when the session is already running.
7. Run applicable upstream checks and inspect the native UI before installation.
   Do not run a settings-mod check that can synchronize real settings to other
   machines. See [Contributing](../CONTRIBUTING.md) for the safe test workflow.

## Development validation

The `main` branch implements named Codex profiles, account-preserving session
commands, account-bound chat controls, a persistent Files tree, separate
Markdown/CSV document panes, wide Chat, extra agent views and per-space Sessions.
Native Linux checks verified account labels, Source / Preview beside the tree,
space-scoped session lists and account-preserving history actions. Chat / Terminal
switching and the sidebar installation retained existing agent processes. The
development build is installed locally; there is no new release tag.

The additional implementation adds file references, the Agents panel, lexical
source highlighting, DOCX/Excel content previews, scoped approval handling and
Chat measurement/scroll regression fixes. Native inspection verified colored
source, DOCX tables, Excel sheets, the Agents panel and approval controls. Pure
policy and hook tests use isolated requests and accounts; they do not approve
real user tasks. Native hover reproduction and full Office layout fidelity are
not claimed. See the workspace guide for remaining limitations.
