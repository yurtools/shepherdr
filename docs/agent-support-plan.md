# Kimi, Goose and OpenCode implementation plan

**PLANNED — proposed briefs only; no implementation tasks have been created.**
Feature `ec1ad42543a840a2be6234ec544a7b7a`; source audit 2026-11-18,
base `4d6e286caf48`. The [specification](agent-support-spec.md) defines behavior,
upstream evidence, acceptance IDs A1–A10 and non-goals. This plan changes no runtime,
settings, account or installed CLI. Retain the existing repository identity,
compatibility paths and upstream history; leave README untouched.

## Current source map and concrete gaps

Paths below are canonical sources unless explicitly called a generated copy.
Follow the named symbols rather than relying on line numbers as code moves.

| Area | Actual source and entry points | Gap to address |
| --- | --- | --- |
| Engine/control logic | [core/agents.js](../core/agents.js): `NAMES`, `DEFAULTS`, `parseDefaults`, `current`, `menuFor`, `typedModel`, `modelSections`, `permAcross`, `argvFor`, session/resume/fork helpers, `liveTaskAgent` | Two engines; non-Claude branches generally mean Codex. Typed IDs exclude `/` and `:`; effort defaults and permission conversion must not leak into new engines |
| Account profiles | `profileLaunch` in core/agents.js; [lib/agent.js](../lib/agent.js): `profiles`, `profilePick`; Python `profile_launch` in settings.py | **core/agent-profiles.js does not exist at this baseline.** Profiles are implemented in these files and are Codex-only; do not invent a shared profiles file or extend profiles without a contract |
| Shared settings | [core/settings.js](../core/settings.js): `choicesFrom`, `roleSel`, `otherCli`, `chooseModel`; [lib/settings.js](../lib/settings.js): `loadChoices`, `lastUsed`, `settingsRows`, `modelButton`; [lib/coordinator.js](../lib/coordinator.js): `shepherdrLayers`, `shepherdrFor`, `createSpace` | Lists only Claude/Codex; unknown last-used models reset to defaults; “other CLI” is binary. Native whole-role inheritance differs from Python field merging |
| Native settings/start menus | [mods/shepherdr-settings/main.js](../mods/shepherdr-settings/main.js), [over.js](../mods/shepherdr-settings/over.js), [mods/newspace/main.js](../mods/newspace/main.js), [mods/chat-models/main.js](../mods/chat-models/main.js), [mods/workspace-launchers/main.js](../mods/workspace-launchers/main.js), [lib/features.js](../lib/features.js) | Native `otherCli()` duplicates binary logic; Backup is an on/off control. Feature overrides merge with Assistant choices and explicitly clear inherited profile when appropriate; cross-engine options need isolation |
| Native launch/restart | [mods/chat/main.js](../mods/chat/main.js), [mods/coordinator/main.js](../mods/coordinator/main.js), [restart.sh](../mods/coordinator/restart.sh), lib/agent.js, [lib/companions.js](../lib/companions.js) | Host `knownAgents`/launcher recognition is not proof of Chat/role support. Restart contains broad multi-CLI log search, whereas Chat uses exact recognized logs; new adapters must share exact identity |
| Feature persistence/launchers | [mods/workspace-launchers/bin/workspace-state](../mods/workspace-launchers/bin/workspace-state), [lib/workspace-store.js](../lib/workspace-store.js), lib/features.js, [service/spaces.ts](../service/spaces.ts): `execTemplate` | Retain Feature IDs, captured settings/session/account and existing launcher wrappers. Service template override accepts only Claude/Codex and may retain template command when selected CLI is absent |
| Service/settings/actions | [service/agents.ts](../service/agents.ts): defaults/cache/menu/choices/change/restart; [service/settings.ts](../service/settings.ts): `pick`, `role`, `agents`, role writes; [service/actions.ts](../service/actions.ts): `knownAgents`, model-pin/restart/fork paths | Two-engine lists and action allowlists; role/action regex rejects provider-qualified IDs. Role writes reconstruct a small object and omit profile/provider extensions. Cache is machine+engine, insufficient for multiple account/provider contexts |
| Web controls | [web/src/Settings.tsx](../web/src/Settings.tsx), [screens/Role.tsx](../web/src/screens/Role.tsx), [restart.tsx](../web/src/restart.tsx), [web/shared/types.ts](../web/shared/types.ts) | Share capability data and errors; Role caches menus and assumes common effort/Fast/permission fields. Preserve unsupported selections and invalidate menus on execution-context changes |
| Live control and transport | [core/live-switch.js](../core/live-switch.js), [core/send.js](../core/send.js), [core/chat-view.js](../core/chat-view.js), [service/hub.ts](../service/hub.ts), [service/chats.ts](../service/chats.ts), [service/compat.ts](../service/compat.ts) | Non-Claude live-switch dispatch means Codex. Host owns processes/status/send; replace guessed UI commands with certified per-engine operations. Keep send-once, parked ownership and approvals intact |
| Logs and saved history | [core/chat-reader.js](../core/chat-reader.js): `KINDS`, `kindOf`, `ChatReader`; [core/chat-log.js](../core/chat-log.js): `FIND`, `LOG`, `Conversation`; [lib/session-history.js](../lib/session-history.js); [mods/workspace-sessions/bin/herdr-sessions](../mods/workspace-sessions/bin/herdr-sessions); [mods/workspace-sessions/main.js](../mods/workspace-sessions/main.js) | Chat recognizes two engines and reads JSONL offsets. Non-Codex parse dispatch means Claude. Saved history is local Codex with account-home+session keys. Goose DB and OpenCode server data require a bounded source abstraction, not JSONL filename matching |
| Task configuration/commands | [settings.py](../mods/tasks/bin/herdr_task/settings.py): `settings_for`, `argv_for`, `worker_pick`, `task_settings`, `reviewer_command`; [cli.py](../mods/tasks/bin/herdr_task/cli.py); [commands.py](../mods/tasks/bin/herdr_task/commands.py): add/edit/start and `start_again` | `argv_for` returns only `[agent]` for other engines, dropping model/effort/permissions. Reviewer generation supports two engines and may change CLI/model when unavailable; task override validation and brief wording must use resolved capabilities |
| Task launch/prompts/hooks | [launch.py](../mods/tasks/bin/herdr_task/launch.py): `own_argv`, `resume_argv`, `brief`, `handoff`, `launch`, `REVIEWERS`; [templates.py](../mods/tasks/bin/herdr_task/templates.py); [space_instructions.py](../mods/tasks/bin/herdr_task/space_instructions.py); [assistant_settings.py](../mods/tasks/bin/herdr_task/assistant_settings.py); [mods/chat/session-note.sh](../mods/chat/session-note.sh) | Resume and permission hooks know Claude/Codex; reviewer command/label allowlists do too. Prompt delivery and notes on start/resume/compaction need engine-specific channels, including reviewer/helper visibility and restrictive launch policy |
| Task recovery/readiness | [sessions.py](../mods/tasks/bin/herdr_task/sessions.py), [agents.py](../mods/tasks/bin/herdr_task/agents.py), [takeover.py](../mods/tasks/bin/herdr_task/takeover.py), [provider.py](../mods/tasks/bin/herdr_task/provider.py), [revive.py](../mods/tasks/bin/herdr_task/revive.py), [automations.py](../mods/tasks/bin/herdr_task/automations.py), [tick.py](../mods/tasks/bin/herdr_task/tick.py), [core/bg-jobs.js](../core/bg-jobs.js) | Two-engine session/status/error assumptions; installed/auth checks and backup pair are binary. Dead shells, background work, stalled prompts, provider failures and crash revival must not produce false Ready or duplicate agents |
| Approval and install wiring | [lib/approval.js](../lib/approval.js), [mods/tasks/bin/herdr_task/approvals.py](../mods/tasks/bin/herdr_task/approvals.py), [service/codex-ask.ts](../service/codex-ask.ts), [mods/chat/ask-hook.sh](../mods/chat/ask-hook.sh), [bin/shepherdr](../bin/shepherdr) | Existing native Codex decision handoff is Codex-specific. Installer/session hooks must not be cloned onto new CLIs without an equivalent contract |
| Canonical distribution | [lib/COPIES](../lib/COPIES), [bin/sync-shared](../bin/sync-shared) | Future edits belong in core/ or lib/; regenerate mod copies. Any new shared module needs its actual consumers listed, plus tests/check |

## Sequence, sizes and critical path

Sizes are relative scope: **S** bounded change, **M** one subsystem, **L** several
subsystems/fixtures, **XL** external host work with uncertain scope. They are not
calendar estimates. P2–P4 are per-engine briefs, each to be applied separately to
Kimi, Goose and OpenCode; one blocked engine need not stop another's validated
work. Keep unproven capabilities disabled until their gate passes.

| Order | Proposed brief | Size | Depends on |
| --- | --- | --- | --- |
| P0 | Establish versioned host/CLI contracts and compatibility decisions | M discovery; external implementation may be XL | None |
| P1 | Add capability/identity schema and safe settings resolution | L | P0 contract decisions |
| P2 | Implement one engine's host adapter and launch/prompt/approval contract | L or external XL | P0; P1 interface |
| P3 | Normalize one engine's events, history and session operations | L | P1, that engine's P2 |
| P4 | Extend one engine through task roles, recovery and automation | L | P1–P3 for that engine |
| P5 | Expose certified engines in native settings and launch flows | M–L | P1; P2–P4 gates for each enabled engine |
| P6 | Extend service/web controls and explicit parity boundaries | L | P1–P4; shared P5 control data |
| P7 | Verify compatibility, native workflows and publish truthful support docs | M | P5, P6 and all claimed engine gates |

**Critical path:** P0 → external host delivery if needed → P1/P2 contract →
P3 → P4 → P5/P6 enablement → P7. P1 can prepare disabled schemas after P0;
native/web UI shells can proceed after the schema is settled but cannot advertise
working support early. P7 waits for every engine included in a full three-engine
support claim. Do not schedule a fixed completion date before P0 identifies host
ownership and same-process transport feasibility.

## Proposed task briefs

### P0 — Establish the host contract before adding engine choices

**Goal:** determine whether each engine can operate as a Herdr agent, beyond a
terminal launcher. **Files/evidence:** service/hub.ts, core/chat-reader.js,
core/agents.js, docs/install.md, host API/type documentation supplied by the host
owner, and the spec's dated primary sources. herdr-core and Herdr App adapter
implementations are not included in this repository; obtain their source/version
contract through a separately authorized discovery task, not guessed file names.

**Done:** a per-engine version/transport table covers detection, launch, prompt
delivery, exact account/session binding, events/log access, status/turn completion,
send/cancel, approvals/questions, resume/fork, restrictive reviewer/helper roles,
session notes and same-process Chat/Terminal. Decide Kimi successor versus legacy,
OpenCode V1/V2 and shared-server ownership, Goose keyring/catalog/ACP limits,
backup storage/defaults, old-client write policy and whole-role migration. Assign
every external gap an owner/dependency and required minimum version. A bare CLI
or ACP demo in an editor does not pass the continuity gate.

**Verification:** inspect pinned upstream source/help/schema and record versions;
design redacted fixtures and a host contract harness. A later authorized isolated
CLI spike must demonstrate any uncertain claims, including two configurations of
the same provider. Do not read auth files, install/migrate tools, run bare legacy
Kimi, or probe authenticated agents as part of this planning task.

### P1 — Make capabilities and settings lossless across all resolvers

**Goal:** define one explicit descriptor per engine with version range, operations,
role eligibility, control/catalog capabilities, readiness and non-secret identity.
**Files:** core/agents.js, core/settings.js, lib/agent.js, lib/settings.js,
lib/coordinator.js, lib/features.js, service/settings.ts, web/shared/types.ts and
herdr_task/settings.py. New modules, if chosen, require lib/COPIES entries.

**Done:** unknown engines return unsupported rather than entering Codex/Claude
branches. JS/service/Python consume common resolution vectors; whole-role choice,
Feature primary-profile clearing, task override precedence, legacy machine
layers and Reset pass A1. Round-trip exact provider/model IDs and extensions
without the current 60-character/slash restrictions or shell interpolation.
Validate bounded strings/structured values at both action and persistence
boundaries. Retain unlisted and unsupported known values; reject unsafe execution
instead of rewriting them. Preserve old Codex/Claude behavior with a reversible
migration and older-reader/writer policy. Codex named profiles stay isolated.

**Verification:** core/agents.test.js, core/settings.test.js, service/settings.test.ts,
test/test_account_profiles.py and new cross-language vectors, including partially
specified legacy role objects, empty/null/false, unavailable accounts and refresh
failure. A1/A4/A5; no live settings writes.

### P2 — Deliver a certified engine adapter (repeat per engine)

**Goal:** bridge the P0 contract into the host and launch paths without changing
accounts or permissions. **Files:** host-owned files identified in P0;
lib/agent.js, core/agents.js, service/agents.ts, service/spaces.ts,
mods/coordinator/restart.sh, mods/chat/main.js, herdr_task/launch.py and
bin/shepherdr only for proven hook/install wiring.

**Done:** launch arguments or protocol requests include exact model/provider,
folder, account binding and supported controls. Discovery caches are keyed by
machine/version/config/account/provider, with freshness/error state. Use
non-secret allowlisted metadata only; never publish whole config or catalog
output that may contain credentials. Kimi maps aliases/capabilities for the chosen
family; Goose preserves a provider+model pair; OpenCode preserves provider/model
and variants. A stale model remains saved but a rejected launch is explained.
Global+space prompts and task instructions reach the correct role. Approval
requests retain request/session IDs and deny/cancel behavior. Unsupported native
handoff/reviewer restrictions are blocked explicitly. No automatic installs,
auth repairs or permissive fallback. Same-process terminal access is proven or
this adapter remains terminal-only/disabled for first-class roles.

**Verification:** host contract harness with redacted versioned events, launch
captures and negative permission tests; later authorized isolated CLI/native
smokes. A2–A5/A7/A9. Do not enable a reviewer using a mere plan-mode label.

### P3 — Carry events and exact sessions through Chat and local history (per engine)

**Goal:** keep process/session identity while displaying and controlling agents.
**Files:** core/chat-log.js, core/chat-reader.js, core/chat-view.js,
core/live-switch.js, core/send.js, core/bg-jobs.js, lib/session-history.js,
lib/companions.js, mods/chat/main.js, mods/workspace-sessions/main.js,
mods/workspace-sessions/bin/herdr-sessions, service/chats.ts, service/compat.ts,
service/agents.ts, herdr_task/sessions.py and revive.py.

**Done:** use a bounded event/history source abstraction where the engine has a
database/server rather than a JSONL offset stream. Select the exact main agent;
keep subagent streams distinct, correlate tool calls/results, preserve activity,
messages, errors and approval state, handle truncation/rotation/reconnect and
unknown events. Never read the newest unrelated log or mutate vendor databases.
History keys include engine/machine/config/account/session, preview is read-only,
and live sessions focus existing views. Send once, interrupt, restart, resume and
fork are individually capability-gated. Failed resume never silently creates a
new account/session. Chat/Terminal and extra views preserve the process; closing
an extra view does not end it. Cross-engine change is an explicit handoff.

**Verification:** A6/A7, real-event fixture replay; core/chat-log.test.js plus new
reader/adapter tests, service/chat-log-selection.test.ts, service/chats.test.ts,
service/send-once.test.ts, service/session-history.test.ts,
test/test_session_history.py, test/test_restart.py and Chat switch regressions.
Native observation must prove process continuity; mocked UI tests alone cannot.

### P4 — Support all task roles and recovery paths (per engine)

**Goal:** task commands and automation use the same resolved identity/capabilities.
**Files:** herdr_task/{cli,settings,commands,launch,sessions,agents,takeover,
provider,revive,automations,tick,assistant_settings,reactions,space_instructions,
templates,approvals}.py, templates/{assistant,feature,worker,reviewer}.md,
mods/chat/session-note.sh and approval adapters established in P2.

**Done:** cover add/edit validation, queued/direct start, resume/switch, fix,
failed-check/merge-conflict recovery and scheduled/event automation. Keep task and
Feature ownership, worktree and parent/helper labels, visible reviewer children,
reviewed-commit gates, progress/proof/ready flow and review rounds. Replace binary
reviewer/backup selection with the spec's explicit policy; old automatic pair
behavior is limited to compatible unset records and explained. No dropped
options in `argv_for`, implicit model change or silent same-worker review.
Restrictive reviewer launches and helper permission allowlists follow certified
capabilities. Missing/unknown auth cannot be inferred from an executable alone.
Bound backup attempts; preserve original log/handoff and effective permissions.
Busy tools/background jobs, held approvals, startup, provider outages and dead
shells yield correct status, with no false readiness, stalls or revival loops.

**Verification:** extend test/test_herdr_task.py classes `ReviewerLine`,
`ReviewerFlags`, `ReviewAsAHelperAgent`, `WorkersOwnHelpers`, `BackToWork`,
`OwnBackgroundWork`, `NoFalseNeedsYou`, `Scheduled`, `Revive`, `LostLogs`,
`AssistantSettings`, `CodexAsksOnTheCard`, `TaskFlow` and `ReadyMergeGit`;
test/test_space_instructions.py, test/test_feature_ownership.py and
service/task-agents.test.ts. Use fake hc/gh and throwaway task/git stores; stub
live-agent/helper checks on real finish paths. A3/A5/A8/A9. Later end-to-end
tests need separate authorization and isolated cores, never people's tasks.

### P5 — Expose supported choices consistently in native settings and menus

**Goal:** people can choose a certified engine everywhere they choose a role or
launch an agent. **Files:** lib/settings.js, lib/coordinator.js, lib/features.js,
mods/shepherdr-settings/{main,over}.js, mods/newspace/main.js,
mods/chat-models/main.js, mods/workspace-launchers/main.js,
mods/workspace-launchers/bin/workspace-state and native Chat/role controls.

**Done:** Assistant/Feature/Workers/Reviewer/Backup at Everywhere and space scope,
new-space defaults and normal launches share effective settings and availability.
Show exact unavailable saved choices, inheritance and Reset; distinguish missing
CLI from terminal-only adapter. Controls follow model/engine capabilities, with
safe explicit permission choices. Keep launcher IDs/wrappers and account homes;
do not promote a terminal launcher just because it is installed. Prompt editors
keep global files and each role's space additions independent. Menus handle long
provider IDs, search, pinned/recent items, no catalog and refresh errors.

**Verification:** A1–A5/A9; service/settings-menus.test.ts,
service/model-menu-perms.test.ts, service/workspace-panes.test.ts,
service/features.test.ts, service/space-instructions.test.ts and extracted native
method/render tests. Later inspect actual native settings and Chat; never run
`herdr-app check shepherdr-settings` (its init synchronizes live settings).

### P6 — Match the service/web settings and supported lifecycle controls

**Goal:** web users see the same effective engine and receive truthful operation
results, within the spec's parity boundary. **Files:** service/{agents,settings,
actions,spaces,compat,chats}.ts, web/src/Settings.tsx,
web/src/screens/Role.tsx, web/src/restart.tsx and web/shared/types.ts.

**Done:** replace action/role engine allowlists and model regex assumptions with
validated capabilities; retain provider/account fields on writes, invalidating
context-specific catalogs. Match inheritance/reset, unavailable selection,
prompts, Feature role configuration, reviewer/backup policy, approvals and
restart/fork restrictions. Backend validates capabilities even if a client sends
a disabled action. Preserve the existing native-only Feature/Beside/history
workflows rather than claiming new web workspace parity. Offline/mixed-version
machines preserve settings and explain unsupported operation.

**Verification:** A1/A4/A5/A7/A9/A10; extend service/settings.test.ts,
service/settings-guard.test.ts, service/model-menu-perms.test.ts,
service/task-agents.test.ts, service/approval-ui.test.ts and
service/chat-approval-race.test.ts. **service/agents.test.ts does not exist** at
this baseline: add focused coverage for `Agents` menu/change/restart rather than
claiming an existing suite. Add web interaction coverage and later desktop/phone
screenshots against a bounded stub, followed by host integration checks.

### P7 — Verify the claimed support and document its actual limits

**Goal:** enable each engine only after its acceptance evidence exists.
**Files:** the new/extended tests above, lib/COPIES, bin/sync-shared,
docs/settings.md, docs/workspace.md, docs/parity/settings.md, docs/install.md and
these planning documents' eventual status notes. No README redesign or release.

**Done:** attach an A1–A10 report per engine/version/platform/host combination;
include Codex primary/named-profile and Claude regressions. Exercise two spaces,
two provider/account contexts with colliding model names, unknown selections,
offline discovery, restrictive review, prompt delivery and all task recovery
paths. Inspect native continuity and web behavior. List unsupported operations
and external minimum versions plainly; incomplete required rows remain planned.
Apply reversible migration/rollback checks and review older-client writes. Do
not install/deploy fleet-wide or change this task's inherited roles to test.

**Verification:** run applicable checks below and document real CLI/native proof
separately from mocks. No release, tag, acceptance or publication is part of this
brief; an implementation delivery requires its own approval workflow.

## Verification commands and fixture boundaries

For **this documentation task**, check local links/source symbols, external
primary links, planned status, scope, dependency order, A1–A10 coverage and
`git diff --check`. Do not run unrelated runtime suites or live Herdr tests.

For **future implementation**, run from the repo root after dependency setup in
[develop.md](develop.md) (`bun install --frozen-lockfile`, then
`bun web/build-plugins.ts` before types/build). Focused examples:

```bash
bun test core/agents.test.js core/settings.test.js core/chat-log.test.js
bun test service/settings.test.ts service/settings-guard.test.ts service/task-agents.test.ts service/model-menu-perms.test.ts
bun test service/session-history.test.ts service/chat-log-selection.test.ts service/chats.test.ts
python3 -m unittest discover -s test -p test_herdr_task.py
python3 -m unittest discover -s test -p test_account_profiles.py
python3 -m unittest discover -s test -p test_session_history.py
python3 -m unittest discover -s test -p test_space_instructions.py
python3 -m unittest discover -s test -p test_restart.py
```

Fixtures must be version-labeled and redacted from actual upstream event shapes;
include tool start/result, approval allow/deny/cancel, interrupted turn, partial
record, malformed/unknown event, stale catalog, account mismatch, lost session,
concurrent main/subagent streams and active background work. Existing
core/chat-log.test.js builds Claude/Codex event records inline; retain those
regressions. service/session-history.test.ts exercises the native module with
stubs, not proof of a general web history UI. Python tests import home_guard and
must run with `discover -s test` or from test/. Never manually change HOME or
HERDR_APP_HOME for Herdr/task commands. No auth files or credentials in fixtures.

After editing canonical shared sources, run `bin/sync-shared` and then the
applicable repository checks from [CONTRIBUTING.md](../CONTRIBUTING.md) and
[Check workflow](../.github/workflows/check.yml):

```bash
bin/sync-shared --check
python3 -m unittest discover -s test
bun test service core web
bunx tsc --noEmit -p .
bun run build
git diff --check
```

Use the JavaScript syntax loop in develop.md; run **bash -n on every changed
shell script**, including scripts intended for macOS bash 3.2 (sh -n alone is
insufficient). Installer changes use `./install.sh --root <scratch>` and
`cd test && python3 -m unittest test_install`. Do not deploy with `herdr-task
--on`, start another window or test the settings mod's init. Native/real CLI
verification belongs to a later authorized environment; this plan has not proved
runtime implementation, host compatibility or real native behavior.

## Short brief and next proposed task

Add Kimi, Goose and OpenCode as complete agent integrations, starting with a host
contract check. Then share capability-aware settings, preserve exact accounts
and sessions, extend task/recovery flows, and expose the certified choices in
native and web controls. Keep unsupported operations visible and safe. The main
risks are host ownership, same-process terminal access, Kimi's replacement CLI,
provider/account discovery and restrictive reviewer permissions.

**Next proposed task: P0, “Establish versioned Herdr host contracts for Kimi,
Goose and OpenCode.”** Its deliverable is a per-engine go/blocked matrix and
external dependency list, not new dropdowns or runtime enablement.
