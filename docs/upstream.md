# Origins, attribution and the Yurherdr name

## What Yurherdr is

Yurherdr is yurtools' personal development workspace for coding agents in Herdr App.
It began as a focused fork of Shepherdr, then expanded around independent Feature
Assistants, multiple Codex accounts, project files and document panes, approval
controls, sessions and browser tabs. It is an IDE-style workspace built on Herdr's
agent and terminal host, not a fork of Herdr App itself or a claim to have written
Shepherdr's existing orchestration from scratch.

The current implementation is described in [the workspace guide](workspace.md).
Features are presented by usefulness in the daily workflow. This page records
origins separately from that feature description.

## Upstream baseline

[Shepherdr](https://github.com/eliasstravik/shepherdr) was created by Elias Stravik.
Yurherdr's starting runtime is Shepherdr **3.1.35**, commit
[`abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e`](https://github.com/eliasstravik/shepherdr/commit/abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e).
The [baseline README](https://github.com/eliasstravik/shepherdr/blob/abd5a0f1aa6faf2d0ee8d6559dc7f064fdae488e/README.md)
records the inherited Assistants, task orchestration, Chat / Terminal, artifacts,
web app and optional add-ons. Earlier Shepherdr history includes its TUI plugin;
this codebase extends the later native Herdr App layout and mods.

The repository keeps the original Git history. The upstream release entries in
[CHANGELOG.md](../CHANGELOG.md) remain historical records; the Yurherdr additions
are summarized in its Unreleased entry. The inherited runtime version remains
3.1.35. There is no Yurherdr release tag or separate release number yet.

## Naming and compatibility

**Yurherdr** is the public product name. The GitHub repository currently remains
[`yurtools/shepherdr`](https://github.com/yurtools/shepherdr). Renaming that
repository is a separate decision and has not been performed.

| Name or identifier | Current treatment |
| --- | --- |
| Project documentation and Gallery title | Yurherdr |
| GitHub repository and issue links | `yurtools/shepherdr` |
| Layout file and key context | `layouts/shepherdr.json`, `layout:shepherdr` |
| Installer command, services and settings mod | `shepherdr`, `shepherdr.service`, `shepherdr-settings` |
| Existing data, config, browser profiles and web storage keys | Retained in place |
| Upstream names in licenses and historical release notes | Retained unchanged |

These compatibility names prevent a branding change from separating users from
saved sessions, spaces, accounts, role prompts, browser logins or installation
records. Do not mass-replace them. A future internal rename needs explicit data,
service, URL, keybinding and rollback migrations. It is not required to publish
under the Yurherdr name. See [publishing](publishing.md).

## License and independent authorship

The original [MIT license](../LICENSE) permits use, modification and redistribution,
subject to retaining its copyright and permission notice. That notice remains
intact. The [Herdr-related license](../LICENSE-herdr) is retained too. Yurherdr's
name identifies this maintained derivative; it does not remove upstream credit,
transfer ownership of upstream work, or imply endorsement by Herdr or Elias Stravik.

Current guides describe Yurherdr's implemented behavior. The detailed parity
pages are retained upstream comparison notes; their checkmarks do not establish
that every native Yurherdr extension is available on the web or on Herdr TUI.
