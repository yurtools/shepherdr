# Yurherdr

Chat, agents, terminals and project files in one Herdr App window.

**Yurherdr is a personal development workspace built on [Herdr App](https://herdr.dev).**
It started as a fork of [Shepherdr](https://github.com/eliasstravik/shepherdr),
created by Elias Stravik, and grew into yurtools' own IDE-style workspace for
working with coding agents. It retains Shepherdr's task orchestration and adds
named feature conversations, separate Codex accounts, document panes and browser tabs.

**Development build, based on Shepherdr 3.1.35.** The features below are implemented.
Linux is the validation target; inherited macOS support is not a new validation claim.
There is no Yurherdr release tag or version bump yet. The repository remains
[`yurtools/shepherdr`](https://github.com/yurtools/shepherdr); its name has not changed.

[Usage](docs/workspace.md) · [Install](docs/install.md) · [Approvals](docs/approvals.md) ·
[Contributing](CONTRIBUTING.md) · [Issues](https://github.com/yurtools/shepherdr/issues)

## What Yurherdr does

Features are ordered by their importance to the daily workflow.

| Area | What you can do | Current scope |
| --- | --- | --- |
| Agent workspace | Switch Chat / Terminal for the same running agent; open agents beside each other; collapse thinking and tool activity | Codex/Claude Code Chat and space roles; other CLI launchers are Terminal only |
| Features and coordination | Keep a space Assistant for discussion; give each named Feature Assistant its own conversation, tasks and worker updates | Local spaces; persistent task ownership; shared Worker / Reviewer settings; activity includes running workers |
| Codex accounts and controls | Choose separate named logins; set Model, Thinking and Permissions for the assigned account | Named profiles are Codex-only; retained through launch, resume, fork and restart; skills picker and `/status` |
| Files and documents | Set the space folder; keep the project tree visible while files open in separate panes; refer to files from Chat | Editable text; Markdown / CSV modes; source highlighting; individual file close; native multi-repository groups, diffs and commits |
| Approvals | Choose who resolves requests; save expiring command rules; inspect who decided and why | Per-role/per-space Ask me, rules, Assistant review or Codex Auto-review; account/folder binding; future rules from history |
| Sessions | Find closed conversations below Spaces; click to resume or focus; open beside another conversation | Local Codex history across configured accounts; account retained |
| Space instructions | Append project-specific instructions to the global role prompt | Separate additions for Assistant, Feature Assistant, Workers and Reviewer; fresh starts use them, existing contexts are retained |
| Browser tabs | Open editable URLs or configured web-chat shortcuts; retain pages and browser profiles | Native local spaces; website logins are separate from Codex; normal-browser fallback for verification loops |
| Reports and remote access | Use inherited task tracking, artifacts, optional voice, Autopilot and a tailnet web app | Autopilot belongs to the space Assistant; native extensions have limited web parity; inherited remote support |

Source highlighting includes HTML, CSS, TypeScript, JavaScript, Java, SQL, Bash,
XML, JSON, YAML, Helm, Liquibase, Python and Terraform. DOCX and Excel OOXML previews
are read-only content views. They do not reproduce full Office page layout or
recalculate formulas. See [document limits](docs/workspace.md#files-and-documents).

## Install the development build

Requires Herdr App and herdr-core, Python 3.8+, Git and a signed-in agent CLI.
Bun builds the service and web UI. [Optional dependencies](docs/install.md#requirements)
cover browsers, remote access and voice.

```bash
git clone https://github.com/yurtools/shepherdr.git
cd shepherdr
git switch main
./install.sh --dry-run
./install.sh
shepherdr doctor
```

Select the **shepherdr** layout with **Ctrl+Shift+L**. The layout ID, CLI commands,
service names and storage paths retain their existing names for compatibility.
Current installations may still label their settings **Shepherdr**. These are
Yurherdr's inherited runtime identifiers, not a second product to install.

For updates, pull the intended checkout and run `shepherdr update`, then
`shepherdr doctor`. Read [the upgrade guide](docs/upgrading.md) before changing
an existing installation. Personal key bindings and edited role prompts are preserved.

## Documentation

- [Workspace guide: features, accounts, files, sessions and browser tabs](docs/workspace.md)
- [Installation](docs/install.md), [settings](docs/settings.md) and [add-ons](docs/addons.md)
- [Approval behavior and history](docs/approvals.md)
- [Architecture, implementation status and acceptance checks](docs/fork-plan.md)
- [Development](docs/develop.md), [web app](docs/web.md) and [web parity limits](docs/parity.md)
- [Origins, licensing and the Yurherdr name](docs/upstream.md)
- [Gallery publishing and repository naming](docs/publishing.md)

## Origins and license

Yurherdr is derived from Shepherdr 3.1.35, with its Git history and original
copyright retained. Elias Stravik created Shepherdr; yurtools maintains these
workspace extensions. [LICENSE](LICENSE) remains MIT, and Herdr-related licensing
is retained in [LICENSE-herdr](LICENSE-herdr).

Yurherdr is an independent project, not an official Herdr or Shepherdr release.
The desktop Gallery is the appropriate listing for this layout and its mods;
it is not a Herdr TUI plugin. [Read the Gallery recipe](RECIPE.md).
