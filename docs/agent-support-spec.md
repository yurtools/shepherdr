# Kimi, Goose and OpenCode support specification

**PLANNED — no runtime support is delivered by this document.** Audited
2026-11-18 at `4d6e286caf48`. Owns only feature
`ec1ad42543a840a2be6234ec544a7b7a` (Add kimi, opencode and goose).
See the [implementation plan](agent-support-plan.md) for proposed work and gates.

## Outcome and scope

People should choose Kimi, Goose or OpenCode in **Everywhere** and **Space
settings**, and use the selected engine throughout an agent's life. Adding an
engine to a dropdown is insufficient: first-class support requires the host,
Chat, task runner and settings to agree about the running session and its rights.
Existing [settings](settings.md), [workspace](workspace.md) and
[fork boundaries](fork-plan.md) remain the description of shipped behavior.
Today Codex and Claude Code support Chat/roles; other configured CLI launchers
open terminals. None of the three additions is certified here.

Required surfaces are ordinary agent launches, new spaces, Assistant, Feature
Assistant, Workers, Reviewer, Backup, task add/edit/start/resume/switch/fix/merge
recovery, visible reviewer/helper children and automation. Include role prompts,
space instructions, model/provider controls, approvals, session recognition,
history, send/interrupt/restart/fork, readiness and failure recovery.

## User and compatibility contract

1. **Inheritance:** a task's explicit choice wins over its effective space role;
   a space role wins over a retained legacy machine override, then Everywhere,
   then the established default. Show the effective choice and its source.
   Reset removes the local override; it does not write a copy of the parent.
   Preserve legacy machine layers without introducing a new machine-level Agents UI.
2. **Whole role choices:** resolve engine, provider/model, permissions and identity
   together. Do not inherit a Codex model, profile or permission into Goose.
   Native/service currently resolve whole role objects while Python merges their
   fields; implementation must reconcile this with compatibility fixtures before
   changing existing behavior. Preserve an explicitly chosen primary Codex account.
3. **Feature inheritance:** an unset Feature Assistant follows the space Assistant;
   an explicit Feature role/record keeps its own choice. Both coordinating roles
   share the space's Workers and Reviewer. Opening an old Feature retains its
   saved session/account rather than adopting today's defaults.
4. **Prompts:** append the role's space addition to its current global role prompt
   on a fresh launch. Clearing an addition changes only that addition. Keep global
   templates, repository instructions and task briefs intact; deliver task scope,
   ownership, progress, proof, review and completion instructions through each
   adapter's verified prompt channel. Resume retains context. Session notes,
   reactions/settings notices and compaction reinjection must be supported without
   duplicate briefs or replacing the resumed conversation.
5. **Persistence:** retain existing settings keys and Codex/Claude selections,
   unknown fields, exact model IDs, pinned/recent picks and saved unsupported
   selections. A missing catalog entry is not permission to replace the selection.
   Distinguish “not listed”, “unavailable”, “not checked” and “unsupported version”.
   Discovery failure must not overwrite preferences. Use a reversible migration
   with old-file fixtures and an explicit older-client write policy.
6. **Availability:** check the machine and account that will run the agent.
   Missing CLI, missing provider configuration, expired login, locked keyring,
   offline machine and unsupported adapter are distinct states with a useful next
   action. Never install, log in, change settings or switch account/engine/model
   as an automatic repair. A saved unavailable choice remains visible; launch is
   blocked with a reason. Unknown readiness is not “signed out”.
7. **Identity:** persist a non-secret binding to engine/version family, machine,
   provider/configuration or endpoint identity, account binding, folder and session.
   Provider name alone is not an account. Preserve this binding on resume, restart,
   fork, history and role/task handoff; refuse ambiguous ownership. Reuse the
   engine's existing account setup. Named profiles remain **Codex-only** until a
   separate, evidence-backed contract exists; do not copy credentials or export
   account homes with synchronized role settings.
8. **Permissions:** advertise actual engine/model capabilities. Keep execution
   permissions separate from Yurherdr approval policy and Autopilot. Do not map
   similarly named “auto”, “plan” or “full” modes across engines. Changing engine
   requires an explicit supported target permission choice; incompatible controls
   explain why. No implicit YOLO/autoapprove, expanded directory grants, lost deny
   rules or broad permission defaults on restart/resume. Reviewer eligibility
   requires a demonstrated restrictive execution policy, including shell/MCP/hooks;
   a planning prompt alone does not prove read-only operation.
9. **Reviewer/Backup:** replace the two-engine “other CLI” assumption with explicit
   eligible selections and visible resolution. Preserve the legacy Codex↔Claude
   automatic pair for old unset records only, with its result explained. For a new
   engine, require an explicit reviewer when Review is on and an explicit backup
   target (or Off). An explicit unavailable reviewer must block review, never use
   the worker or a different model silently. Backup is a distinct, bounded handoff,
   never a claim to resume another engine's session; show the target identity and
   effective permissions, preserve task ownership, avoid repeated takeover loops.
   The exact backward-compatible storage/UI is a discovery decision in P0.
10. **Session continuity:** Chat/Terminal and Beside are views of the same process
    and session, including pending approvals and drafts. Switching views must not
    spawn, reload, resume or replace that process. Same-engine restart may replace
    a process only through the exact session binding; cross-engine change is an
    explicit new session with a handoff. Preflight the replacement before stopping
    the old agent, report failures and preserve recoverable work. Fork creates a
    distinct session without changing the original, and retains the live-task
    shared-worktree warning. Unsupported actions are disabled with a reason, not
    guessed flags, another session or a generic shell fallback.

## Capability and evidence matrix

All upstream evidence below was read on **2026-11-18**. These are documented
upstream abilities, **not Herdr integration results**. Minimum supported versions
must be selected and exercised in P0; observed release numbers are not certification.

| Surface | Kimi | Goose (Block-origin project) | OpenCode | Required Yurherdr result |
| --- | --- | --- | --- | --- |
| Version family | Legacy Python CLI archived; successor Kimi Code CLI observed 2.6.3 | Observed release v1.60.1 | Observed release v2.3.2; V1 also exists | Detect exact family/version; never treat executable name as a protocol guarantee |
| Structured interface | Successor `kimi acp`; legacy `kimi --wire` is a separate contract | `goose acp` over stdio | `opencode acp`; server API is an alternative | P0 proves host transport, prompt, status and approval integration |
| Model/provider | Successor aliases bind provider/model; declared thinking capabilities | Provider and model are separate choices | ACP uses `provider/model` with model variants | Discover in the selected execution context; preserve raw IDs and account binding |
| Reasoning/speed | Successor model metadata declares supported efforts; legacy thinking flags differ | No common effort/Fast contract established here | ACP effort option exists only for models with variants | Show only advertised controls; a faster model ID is not a universal Fast flag |
| Sessions/history | Successor session IDs, main/subagent wire event files; ACP load/resume/fork | SQLite sessions since 1.10; CLI list/export/resume/fork | Server-owned sessions/database; ACP load/resume/fork/cancel | Exact session ownership, bounded history and normalized events; no “newest log” matching |
| Permissions | Successor has distinct ask/auto/yolo/plan behavior | Autonomous, Manual and Smart modes; autonomous default | Agent rules and policies; ACP permission requests | Safe explicit selection, real approval handoff and reviewer restrictions |
| Same process Chat/Terminal | Not proven | Not proven | Not proven; shared server adds ownership questions | Blocking host gate, even if ACP works in another editor |

**Kimi evidence and boundary.** The [legacy repository](https://github.com/MoonshotAI/kimi-cli)
is archived; its [final changelog](https://moonshotai.github.io/kimi-cli/en/release-notes/changelog.html)
reports 1.52.0 and download/run behavior when invoked bare. The
[successor changelog](https://moonshotai.github.io/kimi-code/en/release-notes/changelog.html)
reports 2.6.3 (2026-11-17). Plan successor support as the recommended target; P0
must decide whether legacy versions are blocked or separately supported. Never
probe a bare `kimi`. Legacy [Wire documentation](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html)
describes JSON-RPC protocol 1.10; it is not evidence for the successor's transport.

The successor [command reference](https://moonshotai.github.io/kimi-code/en/reference/kimi-command)
documents `--session <id>`, `--model <alias>` and non-interactive stream JSON;
non-interactive prompts use automatic permission behavior, so they are not a safe
drop-in for interactive roles. [ACP](https://moonshotai.github.io/kimi-code/en/reference/kimi-acp)
documents initialize, load/resume/fork/cancel, configuration options, permission
requests and client filesystem/terminal reverse calls. P0 must negotiate only
client abilities Herdr can safely fulfill. [Session storage](https://moonshotai.github.io/kimi-code/en/guides/sessions)
separates `agents/main/wire.jsonl` from subagents under `KIMI_CODE_HOME`.
[Model configuration](https://moonshotai.github.io/kimi-code/en/configuration/config-files)
declares aliases, provider routing and supported efforts; catalog/config output
must be filtered to non-secret metadata. [Approval behavior](https://moonshotai.github.io/kimi-code/en/guides/interaction)
is engine-specific and must be checked against the selected version.

**Goose evidence and boundary.** Official [Block documentation](https://block.github.io/goose/index.html)
now leads to [goose-docs.ai](https://goose-docs.ai/), whose repository is
[aaif-goose/goose](https://github.com/aaif-goose/goose); its
[release list](https://github.com/aaif-goose/goose/releases) showed v1.60.1.
[CLI commands](https://goose-docs.ai/docs/guides/goose-cli-commands/)
document `goose session --resume --session-id <id>`, `--fork`, JSON session
list/export, `goose run` structured output and `goose acp`. The exact ACP
discovery, cancel, fork and event schemas still need the P0 fixture/host spike;
CLI fork does not establish ACP fork. [Logging](https://goose-docs.ai/docs/guides/logs/)
uses `sessions/sessions.db`, not a fresh JSONL transcript per session.
[Configuration](https://goose-docs.ai/docs/guides/config-files/)
binds active provider and per-provider model; [ACP setup](https://goose-docs.ai/docs/guides/zed/)
supports process provider/model overrides. Discover a provider/model pair, not a
fabricated universal slash ID. [Permission modes](https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/)
include autonomous defaults and classification limits. [Provider setup](https://goose-docs.ai/docs/quickstart/)
offers model discovery, but a safe non-interactive catalog contract remains open.

**OpenCode evidence and boundary.** The [release list](https://github.com/anomalyco/opencode/releases)
showed v2.3.2 on 2026-11-18. Current [CLI documentation](https://opencode.ai/docs/cli/)
describes a shared user server owning sessions and configuration, with explicit
private-server options; do not apply V1 storage assumptions to V2.
[Commands](https://opencode.ai/docs/cli/commands/) document model listing,
specific-session continuation, JSON output and session export.
[ACP](https://opencode.ai/docs/cli/acp/) documents provider-qualified models,
model-dependent efforts, load versus replay-free resume, fork, cancellation and
permission requests. It requires the saved directory for load/resume/fork.
[Policies](https://opencode.ai/docs/policies) constrain per-agent permissions and
can hide a configured provider. The [server API](https://opencode.ai/docs/api)
exposes session and provider operations, some experimental. Choose and pin one
host contract in P0; neither database access nor a server endpoint proves Herdr
can attach a terminal to the same live agent.

## Parity boundary

| Surface | Planned acceptance boundary |
| --- | --- |
| Native and web Everywhere/space role settings | Same engine availability, inheritance/reset, exact model/provider preservation and truthful unsupported controls; include Feature role configuration |
| Native and web Chat/task actions | Same normalized messages/activity/status, approvals and supported send/interrupt/restart/fork behavior through the service/host contract |
| Native new-space and regular launcher menus | Separate terminal-only launchers from certified role/Chat engines; no duplicate engine entries or changed launcher IDs |
| Feature conversations, Beside and Chat/Terminal | Extend existing native workflows; this feature does not create a new web Feature or terminal workspace |
| Saved-session sidebar | Extend the existing local native history workflow per certified engine, including preview and exact resume; remote/general web history remains explicitly unsupported unless separately proven |
| Other machines/platforms | Preserve synchronized choices, but enable operation only where version/adapter/identity checks pass; no fleet-wide support claim from local tests |

## Acceptance matrix

Run each applicable row for **each new engine**, with Codex/Claude regression
fixtures. A gate may leave an operation visibly unsupported, but that engine
cannot be called fully first-class while a required role/lifecycle row is blocked.

| ID | Pass condition | Evidence required in implementation |
| --- | --- | --- |
| A1 | Everywhere, two spaces, legacy machine layer, Reset and task override resolve identically in JS/service/Python; unavailable saved values survive | Shared resolution vectors, migration and UI tests |
| A2 | All roles and ordinary/new-space launches use the chosen engine/model/provider/account; Feature keeps its override and shared Workers/Reviewer | Captured launch contract plus later native/service smoke checks |
| A3 | Fresh role prompts contain global + correct space additions; resume/compaction/notes do not duplicate or lose task rules | Prompt fixtures and isolated transcript replay |
| A4 | Catalog offline/refresh, custom IDs with slashes/colons, stale models and same model name under two providers preserve exact values; unsupported effort/Fast has no invented effect | Catalog/serialization/validation tests |
| A5 | Missing/old CLI, account/provider unavailable and unknown status explain the blockage without fallback or credential disclosure | Failure fixtures; later controlled CLI checks |
| A6 | Recognition, log/event discovery, user/assistant messages, reasoning/activity, tool start/result, subagents, cancel/error and pending approval normalize correctly | Versioned redacted real-event fixtures and bounded-reader tests |
| A7 | Send once, interrupt, resume, restart, fork and history target exact identity; Chat/Terminal/Beside keep the original process/session | Host integration traces and native observation; fork/duplicate-session guards |
| A8 | Task add/edit/start/resume/switch/fix, failed-check/merge recovery, helpers, review rounds and automation preserve ownership and policy; busy/background work is not falsely idle/ready/stalled | Task/subprocess fixtures with fake hc/gh; later isolated end-to-end run |
| A9 | Approvals allow/deny/cancel reach the right request; restrictive reviewer cannot write/run side-effect hooks; unsupported handoff is explained; backup is bounded and explicit | Positive/negative permission tests, replay and controlled native verification |
| A10 | Native/web parity boundaries and platform/host minimums are documented accurately; old records remain readable on supported upgrades | Service/UI regressions, compatibility report and human-readable support table |

## Open decisions and non-goals

P0 must identify the herdr-core/Herdr App owner, supported versions and extension
points: their process/adapters are outside this repository. It must resolve how a
structured ACP process and a terminal view share one live agent, which catalog and
account metadata are safe to query, and which engines can meet reviewer safety.
Record outcomes per engine, including explicit blocked capabilities and external
work/version requirements. Do not assume a generic ACP bridge answers these.

This feature does not create provider account profiles, move authentication,
install/upgrade CLIs, import conversations between engines, enable vendor-native
schedulers/swarms, redesign settings/README, rename `yurtools/shepherdr`, change
internal `shepherdr` paths/mod/layout IDs, remove attribution/history, or publish
a release. No implementation tasks are created by this planning work.
