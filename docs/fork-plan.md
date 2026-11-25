# Yurherdr architecture and delivery status

Yurherdr is a development workspace derived from Shepherdr 3.1.35. The project
keeps the inherited runtime and extends it with focused changes. The public name
is Yurherdr; the repository remains `yurtools/shepherdr` and the runtime's
`shepherdr` identifiers remain compatible. See [origins](upstream.md) and
[publishing](publishing.md).

## Product priorities and implemented scope

| Priority | Area | Implemented behavior | Remaining boundary |
| --- | --- | --- | --- |
| 1 | Agent workspace | Terminal-first native openings; same-session Chat / Terminal; collapsible activity; wide chat; extra views beside existing agents | Codex/Claude Code Chat and space roles; other CLI launchers are Terminal only |
| 2 | Features and coordination | Named Feature Assistants alongside the space Assistant; own task ownership; shared Worker / Reviewer settings; sidebar activity includes workers | Local spaces; integration checkout is not created automatically; worker/task worktree settings control code isolation |
| 3 | Accounts and agent controls | Named Codex profiles retained through launch/resume/fork/restart; model/thinking/permissions; Feature role override; skills picker and `/status` | Named profiles are Codex-only; authentication remains in each CLI's account home |
| 4 | Project files and documents | Persistent space-rooted tree; separate text editing and preview panes; read-only PDF pages; indexed CSV/TSV pages and bounded Markdown/source; lexical highlighting; DOCX/Excel content; file references and links; multi-repository native Changes | Bounded [document previews](document-preview.md); large text/table reads need Python on the file machine; native PDF needs local Linux/macOS with Poppler; multi-repository Changes is native-only |
| 5 | Approvals | Role defaults, bounded exact/prefix rules, Assistant review, native Codex handoff, source-labeled history and future rules from history | Codex owns its final native decision; old contextless history is not guessed |
| 6 | Sessions and project instructions | Space-scoped history below Spaces; click to resume/focus; preview/Open dialog; role-specific additions to current global prompts | General remote/non-Codex history indexing remains limited |
| 7 | Browser pages and launchers | Persistent native browser pages, editable URLs, configured chat shortcuts, profile isolation, Manage launchers and system-browser fallback | Launchers do not add role adapters; website verification can fail; pages do not inherit Codex skills or login |
| 8 | Inherited services | Tasks, artifacts, optional Autopilot, voice, other machines and tailnet web access | New native workspace extensions do not imply complete web parity |

These are implementation descriptions, not a new cross-platform certification.
The native workflow has been checked on Linux. Existing tests cover the inherited
runtime plus the account, document, approval, browser and Chat changes; the
inherited macOS and remote code remains subject to its own environment checks.

## Baseline and maintenance

- Starting runtime: Shepherdr 3.1.35, commit
  `abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e`, by Elias Stravik.
- Keep the original Git history, MIT license, Herdr-related license and attribution.
- `main` is the public default branch. Develop further changes on focused branches
  and publish only complete, checked behavior there. `upstream/main` tracks the
  original project's history where available.
- Do not change runtime versions, cut tags or publish releases without an explicit
  instruction. The Unreleased changelog describes Yurherdr additions separately.
- Retain layout/module IDs, CLI names, data paths, role templates, service names and
  installation records during public rebranding. A future migration needs a plan,
  backups, compatibility aliases and rollback behavior.
- Test in scratch roots. Never run another Herdr window or use changed HOME values
  with live Herdr/task helpers. See [contributor rules](../AGENTS.md).

## Runtime organization

Herdr App owns the native window and mods. herdr-core owns the long-lived agent
processes. `mods/chat` reads exact agent logs and renders the conversation; it
switches views without launching another account or claiming a companion's agent.
`lib/` and `core/` hold shared modules, copied through `bin/sync-shared`.
`herdr-task` maintains task records, ownership, scheduling and approval policy.
The Bun service and React web app reuse shared logic, with explicit native/web
boundaries documented in [parity scope](parity.md).

Feature records have durable IDs independent of tabs and panes. Worker ownership
is bound to those records; a working worker keeps the Feature active even when
its coordinating conversation waits. Native terminal status is a word, unlike
`hc get`'s status object, so state interpretation normalizes both forms.

Codex can hold main and internal guardian/review rollouts simultaneously. Log
selection and task resume indexing inspect session metadata and exclude internal
subagent rollouts. Large externally delivered context messages bypass the
composer's paste-to-file behavior, so they fold and expand as bounded rows.
Native row measurement and linked-Markdown preparation are batched to stay within
the host's render budget.

## Acceptance checks

1. Open two independently authenticated Codex profiles. Verify ordinary agents,
   the space Assistant and Feature Assistant select the intended account. Keep it
   through model/permission changes, resume, fork and restart.
2. Switch Chat / Terminal and Wide / Comfortable. Keep the same agent process and
   conversation. Open and close extra views without stopping the original agent.
3. Start named features from + and from a response. Keep the space Assistant for
   discussion, tasks owned by the intended feature, and worker activity visible.
4. Switch between spaces with different roots. Keep Files as a tree; open/edit
   documents separately. Check Markdown/CSV, source colors, Office content limits,
   individual file close, drafts and external edits. For Changes, use sibling repos
   containing identical file paths, worktrees and submodules. Verify discovery stays
   anchored to the space, late replies preserve the selected file, drafts stay per
   repository, and a commit leaves other repositories untouched.
5. Resume/focus sessions from the sidebar with the original account. Keep the
   read-only history preview independent of agent launch.
6. Append space instructions independently for every role. Keep global prompts
   unchanged, exact space/account context intact and resumed context retained.
7. Exercise approval policies with isolated fixtures. Keep rules account/folder/
   scope-bound and never replay an old action when creating a rule from history.
   Show how a decision was made; label a native handoff without inventing its result.
8. Reconnect and resize browser pages without duplicate targets or uncontrolled
   capture restarts. Retain profile isolation and document website verification limits.
9. Replay long worker logs, including a process holding both main and guardian
   files. Render the intended conversation without changing its process ID.
10. Validate source, build and applicable tests, inspect native UI, then install.
    Never check the settings mod through `herdr-app check`: initialization can sync
    live settings to other machines.

See [the workspace guide](workspace.md) for the user-facing controls and
[development](develop.md) for commands and test conventions.
