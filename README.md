# Shepherdr — yurtools fork

A Linux-focused workspace fork of [Shepherdr](https://github.com/eliasstravik/shepherdr),
built on [Herdr](https://herdr.dev). The goal is a central agent conversation with
Chat / Terminal switching, reliable Codex account selection, and a separate file
pane with Source / Preview views.

**Status: development implementation on `main`.** The runtime is based
on upstream Shepherdr 3.1.35. Named accounts, separate document panes, side-by-side
agent views, file references, source highlighting and Office content previews
are implemented. Approval settings have automated checks and native UI inspection.
There is no fork-specific release yet.

[Roadmap](docs/fork-plan.md) · [Contributing](CONTRIBUTING.md) ·
[Issues](https://github.com/yurtools/shepherdr/issues) ·
[Upstream](https://github.com/eliasstravik/shepherdr)

## What this fork is for

| Area | Behavior | Status |
| --- | --- | --- |
| Chat / Terminal | Switch views of the same running agent; collapse thinking and tool activity | Implemented; live switching verified on Linux |
| Side-by-side views | Show existing agents beside each other, including from the Agents panel; adjust Chat width | Implemented; native Linux workflow verified |
| Codex profiles | Use separate named accounts, preserving the profile through launch, resume, fork and restart | Implemented; account lifecycle covered by automated tests |
| Space Assistant | Choose its agent/profile in space settings; show the assignment in chat | Implemented; account selection verified in the Linux UI |
| Chat controls | Account-bound Model, Thinking and Permissions; scoped approval defaults in Settings → Agents | Implemented; account-bound controls and approval policy paths tested |
| Files | Keep a persistent tree rooted at the selected space's project folder | Implemented; switching between space roots verified on Linux |
| Documents | Open files separately; copy paths or reference files in a chat draft | Implemented; separate-pane workflow verified on Linux |
| Markdown and CSV | Switch between editable source and rendered Markdown or a CSV table | Implemented; Source / Preview verified in the Linux UI |
| Sessions | Find saved conversations below Spaces; preview, resume or open beside with the original account | Implemented; local Codex sessions across configured accounts |
| Source code | Highlighted source and a separate Edit view for the requested languages | Implemented; lexical colors include Helm, Liquibase and Terraform |
| Office files | Read-only DOCX content and Excel worksheet previews | Implemented; local OOXML files, with documented limits |

The agent is assigned when a regular agent pane opens, or in the space's Assistant
settings. The chat composer does not need another agent selector. Each Codex
profile keeps its own login and state.

## Get the development source

```bash
git clone https://github.com/yurtools/shepherdr.git
cd shepherdr
git switch main
```

`main` contains the implemented workspace features in the [usage guide](docs/workspace.md).
Use focused feature branches for further development.
Upstream history remains available at [eliasstravik/shepherdr](https://github.com/eliasstravik/shepherdr).

For development, start with [Contributing](CONTRIBUTING.md) and the
[implementation plan](docs/fork-plan.md). The inherited runtime requires macOS or
Linux, herdr-app 0.1.12+, herdr-core 0.1.17+, Python 3.8+, Git and a signed-in agent
CLI. Bun builds the service and web app. The fork's initial validation target is
Linux; this does not claim new cross-platform validation.

## Installation and updates

The `main` branch includes an installer for the development build. The existing
[installation guide](docs/install.md) describes the inherited Shepherdr runtime,
including its services, helpers and agent hooks. Install from `main` for the
workspace features described in the [usage guide](docs/workspace.md).

Development installs use a scratch root, as described in
[Contributing](CONTRIBUTING.md). Changes to an active Herdr installation are a
separate step after validation. Update from the intended checkout and branch;
do not replace a fork checkout with an upstream clone to update it.

## Documentation

- [Workspace UI usage and account configuration](docs/workspace.md)
- [Implementation plan and acceptance checks](docs/fork-plan.md)
- [Contribution and fork maintenance workflow](CONTRIBUTING.md)
- [Upstream provenance and inherited documentation](docs/upstream.md)
- [Code layout and upstream development checks](docs/develop.md)
- [Inherited installation guide](docs/install.md)
- [Inherited settings](docs/settings.md) and [add-ons](docs/addons.md)

## License and attribution

MIT licensed. Shepherdr was created by Elias Stravik; the original copyright and
[license](LICENSE) are retained. This is an independent fork maintained under
[yurtools](https://github.com/yurtools), not an official Herdr or upstream Shepherdr
release. Herdr-related licensing is retained in [LICENSE-herdr](LICENSE-herdr).
