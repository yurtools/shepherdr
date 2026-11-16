# Workspace UI fork plan

This fork extends Shepherdr's existing Chat/Terminal workflow for Linux. Keep the
upstream implementation and make focused changes that can be reviewed and tested
independently. This document records requirements; it does not claim the features
are implemented.

## Baseline and maintenance

- Start from upstream Shepherdr 3.1.35, commit
  `abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e`.
- Keep `main` as the fork's documented baseline and reviewed changes; develop
  workspace features on `feat/workspace-ui`. Track original history via `upstream/main`.
- Keep the original MIT license and attribution.
- Review upstream changes before merging them into the working branch.
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
- Support ordinary text files and highlighted source. Initial language targets
  are Java, Bash and YAML; test Helm's embedded template syntax explicitly.
- Markdown supports Source / Preview in the document pane.
- CSV supports Source / Preview, with the preview displayed as a table and proper
  handling of quoted fields, delimiters and multiline cells.
- Keep source edits and previews consistent, and handle unsaved edits and external
  file changes without silently overwriting content.
- Office previews are a later extension: worksheet data for Excel and readable
  document content or converted pages for Word. Distinguish these read-only
  previews from source editing and full Office layout fidelity.

## Implementation order and acceptance checks

1. Reproduce the Assistant chooser behavior and trace account/profile handling
   across all launch and session-management paths. Prove two independent profiles
   work in the same project, including Chat/Terminal switching. If this requires
   invasive changes to task orchestration, reassess extracting standalone mods.
2. Fix space-root resolution and introduce the separate document pane. Verify two
   spaces with different project roots, persistent tree state, text and Markdown.
3. Add CSV table previews and source highlighting, then verify editing, external
   changes and reopening documents. Evaluate Office readers afterward.
4. Run the applicable upstream checks and inspect the native UI before a live
   installation. Do not use a settings-mod check that can synchronize real
   settings to other machines.

The initial fork setup changes documentation only. No runtime fixes, release,
service activation or live Herdr installation are included in that setup.
