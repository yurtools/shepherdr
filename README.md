# Shepherdr — yurtools fork

A Linux-focused workspace fork of [Shepherdr](https://github.com/eliasstravik/shepherdr),
built on [Herdr](https://herdr.dev). The goal is a central agent conversation with
Chat / Terminal switching, reliable Codex account selection, and a separate file
pane with Source / Preview views.

**Status: development planning.** The runtime is still upstream Shepherdr 3.1.35.
This fork currently adds documentation and a roadmap; the workspace changes below
are not implemented, and there is no fork-specific release yet.

[Roadmap](docs/fork-plan.md) · [Contributing](CONTRIBUTING.md) ·
[Issues](https://github.com/yurtools/shepherdr/issues) ·
[Upstream](https://github.com/eliasstravik/shepherdr)

## What this fork is for

| Area | Target behavior | Status |
| --- | --- | --- |
| Chat / Terminal | Switch views in the same pane, retaining the running agent; collapse thinking and tool activity | Existing upstream foundation; account handling needs validation |
| Codex profiles | Use separate named accounts, preserving the selected profile through launch, resume, fork and restart | Planned |
| Space Assistant | Choose its agent/profile in space settings; show the assignment in chat | Named-profile support planned |
| Chat controls | Model, Thinking level and Permissions dropdowns bound to the assigned agent | Planned integration and validation |
| Files | Keep a persistent tree rooted at the selected space's project folder | Planned fix |
| Documents | Open files in a separate pane, keeping the tree visible | Planned |
| Markdown and CSV | Switch between editable source and rendered Markdown or a CSV table | Planned |
| Source code | Highlight Java, Bash and YAML, with Helm template support evaluated explicitly | Planned |
| Office files | Read-only Word and Excel previews | Later extension |

The agent is assigned when a regular agent pane opens, or in the space's Assistant
settings. The chat composer should not need another agent selector. Each Codex
profile keeps its own login and state.

## Get the development source

```bash
git clone https://github.com/yurtools/shepherdr.git
cd shepherdr
git switch feat/workspace-ui
```

`main` contains the fork's documented baseline. `feat/workspace-ui` is the working
branch for the account and document-pane changes. Upstream history remains
available at [eliasstravik/shepherdr](https://github.com/eliasstravik/shepherdr).

For development, start with [Contributing](CONTRIBUTING.md) and the
[implementation plan](docs/fork-plan.md). The inherited runtime requires macOS or
Linux, herdr-app 0.1.12+, herdr-core 0.1.17+, Python 3.8+, Git and a signed-in agent
CLI. Bun builds the service and web app. The fork's initial validation target is
Linux; this does not claim new cross-platform validation.

## Installation and updates

There is no installer for the planned workspace features yet. The existing
[installation guide](docs/install.md) describes the inherited Shepherdr runtime,
including its services, helpers and agent hooks. Installing this checkout today
installs that baseline, not the features marked Planned above.

Development installs use a scratch root, as described in
[Contributing](CONTRIBUTING.md). Changes to an active Herdr installation are a
separate step after validation. Update from the intended checkout and branch;
do not replace a fork checkout with an upstream clone to update it.

## Documentation

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
