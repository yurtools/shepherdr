# Shepherdr — yurtools fork

A Linux-focused workspace fork of [Shepherdr](https://github.com/eliasstravik/shepherdr),
built on [Herdr](https://herdr.dev). The goal is a central agent conversation with
Chat / Terminal switching, reliable Codex account selection, and a separate file
pane with Source / Preview views.

**Status: development implementation on `feat/workspace-ui`.** The runtime is based
on upstream Shepherdr 3.1.35. Named accounts, separate document panes, side-by-side
agent views and per-space session history are implemented and verified in the
native Linux UI. There is no fork-specific release yet.

[Roadmap](docs/fork-plan.md) · [Contributing](CONTRIBUTING.md) ·
[Issues](https://github.com/yurtools/shepherdr/issues) ·
[Upstream](https://github.com/eliasstravik/shepherdr)

## What this fork is for

| Area | Target behavior | Status |
| --- | --- | --- |
| Chat / Terminal | Switch Chat / Terminal, use Wide / Comfortable, and show existing agents beside each other | Verified on Linux with the existing running agent |
| Codex profiles | Use separate named accounts, preserving the selected profile through launch, resume, fork and restart | Implemented on the working branch |
| Space Assistant | Choose its agent/profile in space settings; show the assignment in chat | Implemented on the working branch |
| Chat controls | Model, Thinking level and Permissions dropdowns bound to the assigned agent | Implemented on the working branch |
| Files | Keep a persistent tree rooted at the selected space's project folder | Implemented on the working branch |
| Documents | Open files in a separate pane, keeping the tree visible | Implemented on the working branch |
| Markdown and CSV | Switch between editable source and rendered Markdown or a CSV table | Implemented on the working branch |
| Source code | Native editor language hints for Java, Bash, YAML and Helm templates | Grammar support varies with Herdr |
| Office files | Read-only Word and Excel previews | Later extension |

The agent is assigned when a regular agent pane opens, or in the space's Assistant
settings. The chat composer does not need another agent selector. Each Codex
profile keeps its own login and state.

## Get the development source

```bash
git clone https://github.com/yurtools/shepherdr.git
cd shepherdr
git switch feat/workspace-ui
```

`main` contains the fork's documented baseline. `feat/workspace-ui` is the working
branch for the workspace features in the [usage guide](docs/workspace.md).
Upstream history remains available at [eliasstravik/shepherdr](https://github.com/eliasstravik/shepherdr).

For development, start with [Contributing](CONTRIBUTING.md) and the
[implementation plan](docs/fork-plan.md). The inherited runtime requires macOS or
Linux, herdr-app 0.1.12+, herdr-core 0.1.17+, Python 3.8+, Git and a signed-in agent
CLI. Bun builds the service and web app. The fork's initial validation target is
Linux; this does not claim new cross-platform validation.

## Installation and updates

The working branch includes an installer for the development build. The existing
[installation guide](docs/install.md) describes the inherited Shepherdr runtime,
including its services, helpers and agent hooks. Install from `feat/workspace-ui` for the workspace changes described in the
[usage guide](docs/workspace.md); `main` remains the earlier documented baseline.

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
