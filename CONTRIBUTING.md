# Contributing to the yurtools fork

This fork is developing the account-aware workspace described in
[the plan](docs/fork-plan.md). Fork-specific features are not implemented yet.
Please keep changes focused so upstream improvements remain practical to merge.

## Branches and upstream

- `main`: the fork's documented baseline and reviewed changes.
- `feat/workspace-ui`: integration branch for the planned workspace changes.
- `upstream/main`: the original project's history, fetched from
  `https://github.com/eliasstravik/shepherdr.git`.

After cloning the fork, add upstream once:

```bash
git remote add upstream https://github.com/eliasstravik/shepherdr.git
git fetch upstream
git switch feat/workspace-ui
```

Create focused branches from the integration branch and target pull requests back
at `yurtools/shepherdr`, choosing the appropriate base explicitly. The default
branch is `main`; do not accidentally open a fork-specific pull request upstream.

Review upstream commits and merge them into a clean local branch, resolve conflicts,
and run the applicable checks before pushing. Do not force-push shared branches.
Keep version strings and release tags unchanged until a release is explicitly planned.

## Development

Read [AGENTS.md](AGENTS.md) and [docs/develop.md](docs/develop.md) before changing
runtime code. Shared code belongs in `lib/` or `core/`; regenerate mod copies with
`bin/sync-shared` rather than editing the copies.

Install dependencies before service or web work:

```bash
bun install --frozen-lockfile
bun web/build-plugins.ts
```

For runtime changes, run the checks appropriate to the touched components:

```bash
python3 bin/sync-shared --check
python3 -m unittest discover -s test
bun test service core web
bunx tsc --noEmit -p .
bun run build
```

The detailed JavaScript and shell syntax checks are in
[docs/develop.md](docs/develop.md) and the existing
[Check workflow](.github/workflows/check.yml). Documentation-only changes need
working local links, accurate feature status and a clean `git diff --check`.

## Trying an installer change

Use a fresh scratch root, never the live Herdr configuration:

```bash
scratch_root=$(mktemp -d)
./install.sh --root "$scratch_root" --dry-run --yes
```

A subsequent scratch install uses `./install.sh --root "$scratch_root" --yes`.
It may build the web app; see the inherited installer guide for its dependencies.
Never run Herdr or the task service with a changed HOME or HERDR_APP_HOME, and
never start another Herdr window for a test. Do not run
`herdr-app check shepherdr-settings`: its initialization can synchronize live
settings to other machines.

For account changes, verify two independent profiles through the full session
lifecycle without copying authentication between them. For file changes, verify
two spaces with different roots and external file edits. Follow the acceptance
checks in the plan; a settings label alone does not prove the agent changed.

## Issues and pull requests

Use this fork's [issue tracker](https://github.com/yurtools/shepherdr/issues) for
workspace requirements, regressions and implementation proposals. Include the
commit, platform, steps and expected behavior. Refer to profiles by labels;
do not attach credentials or authentication files.

For behavior reproduced on an unchanged upstream checkout, link an existing
upstream issue where possible. Keep this fork's account and UI requests here.
Pull requests should explain the resulting behavior, validation and limitations.
