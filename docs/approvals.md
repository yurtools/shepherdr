# Approval modes and remembered decisions

Approval handling is configured in **Yurherdr settings → Agents → Approvals** or
**Space settings → Agents → Approvals**. The dialog is wider to fit the controls.
Choose a default and optional Assistant, Features, Workers and Reviewer overrides. Space
settings override the global layer; roles set to Default inherit its mode.
The default is **Ask me**, so installing this build does not enable automatic grants.

For example, keep unfamiliar actions on **Ask me**, remember read-only `git status`
requests with a project-scoped rule, and delegate other worker requests to the
owning Feature Assistant. The reviewer decides allow, deny or ask; it does not
execute the requested operation in its own process. If the reviewer is unavailable
or uncertain, the original request remains for you. Rules, review and history
reduce repeated decisions without making the Assistant's access level a blanket
permission grant to every worker.

## Modes

| Mode | Behavior |
| --- | --- |
| Ask me | Permission cards wait for Allow once or Deny. Saved command rules are paused, except for a task/session where you explicitly remembered a grant. |
| Approved rules | Matching unexpired rules answer the request; unmatched requests still ask you. |
| Assistant review | Matching rules apply first; other execution requests go to the owning Feature Assistant, or the space Assistant for work outside a feature, using the review policy. |
| Codex Auto-review | Matching rules apply first; remaining requests continue through Codex's native Auto-review when that agent was launched with it. Other agents, or an existing Codex not restarted with it, keep manual approval. |

Execution **Permissions** in the composer determine sandbox/access options.
Approval mode determines who answers a permission request. The Assistant's Full
Access setting does not automatically approve a worker's request. **Autopilot**
schedules work and wakes the Assistant; it is independent of this approval policy.

Codex Auto-review takes effect on a new or restarted Codex launch. Yurherdr sets
an interactive `on-request` approval policy and `workspace-write` sandbox,
preserving an explicit read-only sandbox. It removes bypass/never-ask options.
The chosen account and conversation are retained. Native or managed Codex policy
can still deny an action. Native decisions stay in Codex's own flow and are not
copied into Yurherdr's rule history. See the official
[Auto-review documentation](https://learn.chatgpt.com/docs/sandboxing/auto-review).

Tasks can set an explicit override with:

```bash
herdr-task add "Task title" --approval-mode rules
herdr-task edit TASK-ID --approval-mode assistant
```

Accepted values are `inherit`, `manual`, `rules`, `assistant` and `codex-review`.
Inherit uses the configured default/role/space policy. A native review launch
change requires a fresh launch or restart; changing a label does not reconfigure
a running Codex process.

## Remember a command

Execution permission cards provide:

- **Allow once / Deny**: answer just this request.
- **Allow for this task**: remember the exact command (each stage of a supported
  pipeline) for this task/session for 24 hours and answer when covered.
- **Create rule…**: choose a command/stage or a named tool, match, scope, lifetime,
  and allow or deny. **Forever** follows **1 year** in the lifetime choices.
- **Ask Assistant**: delegate this request once, without changing global defaults.

Execution cards show who is handling the request: **Checking saved rules…**,
**Requesting Assistant review…**, **Waiting for Assistant review**, or
**Waiting for your decision**. A known owning reviewer is labeled Feature
Assistant or Space Assistant. A yellow warning sign marks a decision for you;
checking and review have quiet clock and Assistant icons. The text stays visible.
The card briefly explains manual mode, an unmatched rule, an Assistant asking
you, or unavailable/expired review when known. You can still take over manually.
Older machines without status metadata say **Approval status unavailable**.
Native Codex handoffs close with **Sent to Codex Auto-review · final result not
reported**; they do not claim Codex allowed or denied the action.

Prefixes match parsed argument tokens. For example, `git status` matches
`git status --short`, not `git statusx`. Literal assignments stay part of the
prefix: `GIT_TERMINAL_PROMPT=0 git` does not match a different value or bare `git`.
Suggestions retain the executable/subcommand behind assignments and literal
timeouts, such as `timeout 50s hc wait`. A timeout-only prefix, or a prefix that
grants arbitrary shell/interpreter execution behind a wrapper, is refused.
Matching deny rules take precedence over allow rules. Plans and product-choice
questions never receive execution grants and still need their own answer.

| Scope | Boundary |
| --- | --- |
| This task/session | Original account, working folder and descendants, space, and task or session |
| This space | Original account, working folder and descendants, and space |
| Account in this folder | Original account and working folder and descendants |
| Global / Everywhere | All local accounts, folders, spaces, tasks and sessions, for the exact original tool identity |

Per-space managers label Global rules as **inherited in this space**. These are
single rules, not copies; **Revoke everywhere** removes the shared rule. A scoped
deny still outranks a Global allow. Global does not cross machines, change an
approval mode, or bypass sandbox or managed policy. Existing rules keep their
stored scope; installation never promotes them automatically.

Remembering a rule activates Approved rules only for the original task/session
for at most 24 hours, or the rule's shorter lifetime. A **Forever** rule persists
with JSON `expires: 0`; its task/session activation still expires. Global, space
and role modes remain unchanged. After activation expires, **Ask me** pauses all
saved rules, including Global rules. New sessions use their configured mode.

Ordinary evaluation and rule-manager reads physically prune expired saved rules
with an atomic write after re-reading under the writers' lock. Expired temporary
mode overrides are pruned during policy reads as well. Valid rules, unexpired
overrides and audit history are retained. Busy or read-only stores keep their
files intact; expired records still cannot match. An unreadable rule/settings
store leaves the request with the person and a policy-error explanation, rather
than delegating around potentially unseen denies.

## Pipelines

For an ordinary `|` pipeline, every stage needs an applicable allow before the
request can be approved automatically. A deny on any stage wins, even when an
earlier stage has no match. Otherwise unmatched stages use the configured
manual, Assistant or native-review fallback. The card identifies the first
unmatched stage; **Create rule…** selects a stage and saves only its command or
prefix. Saving one stage leaves the request waiting if another is uncovered.
Allow once and explicit Assistant decisions can answer the complete request.

Quoted and escaped pipes inside arguments are literal. Supported `sh`, `bash`
and `zsh` `-c`/`-lc` wrappers are parsed without running them. Empty/malformed
stages, `||`, `&&`, `;`, substitutions, redirections, expansions and other
unsupported syntax cannot become stage-prefix grants. Pipelines containing
such syntax require Allow once or review. A legacy exact payload for a whole
pipeline cannot bypass stage checks. Unrelated exact non-pipeline payload rules
(for example a specific test command with output redirection) retain their
narrow match. Derived arguments are used only for matching; request payloads,
keys, review tickets and the exclusive answer claim retain the original request.

## Named tools

Non-shell execution tools also offer **Create rule…**, including
`mcp__openmemory__openmemory_store_project`. Choose **This tool · any arguments**
explicitly to allow or deny every input variant of that exact tool identity,
then select any scope and lifetime, including Global and Forever. The form shows
both its readable name and full namespace-qualified identity. Other names and
namespaces do not match. A non-shell tool's `input.command` field is never treated
as Bash. Shell tools cannot receive a tool-wide grant.

**Exact payload for this task** remains the separate narrow choice: it hashes the
tool and complete input, retains the original task/session/account/folder, and
does not allow argument variants.

Use **Manage rules…** in Agents settings to inspect and revoke saved rules.
**Approval history…** shows recent local decisions, their source and rationale;
Clear history removes the local audit list. Revoking a rule does not cancel an
action already allowed. History retains at most 500 entries and redacts common
credential arguments; do not deliberately put secrets in rule patterns or rationales.

Rules, history and review tickets are local to the machine. The new rule/review
buttons are disabled on remote permission cards; Allow once/Deny remain available.
Install a compatible build on the requesting machine for its local policy hooks.

## Assistant review

Choose **Assistant review** as a default/role override, or press **Ask Assistant**
on a permission card. The running space Assistant receives the exact request,
account/folder/task context and the review policy. It may allow, deny or ask you,
and must provide a rationale. It cannot review its own request. If it is not
running, the request remains available for manual approval; review never starts
another Assistant automatically.

The review policy field describes what may be approved. The supplied default
limits delegation to necessary reversible project work and asks you about
publishing, deployments, credentials, destructive changes, financial actions,
out-of-project changes and unclear intent. Customize it to your intended scope.
The Assistant's model still makes a judgment; delegation is an explicit choice,
not a deterministic replacement for command rules.

Each review has a private, ten-minute ticket bound to the exact request and the
designated Assistant. Changed, closed, expired or already-answered requests cannot
reuse its decision. The helper records its rationale and answers only that waiting
permission hook; it does not execute the requested command or broaden the agent's
sandbox. If review is unavailable, uncertain or cannot finish, use the original
permission card to decide.

## Exact actions and feature ownership

Allow for this task remembers a simple command as before. For a script, compound
command or non-shell execution request it can instead remember a hash of the exact
tool and complete input payload, scoped to the original task/session, account and
folder. A different payload is a new request. This does not grant arbitrary scripts.
Create rule offers the exact task payload for non-pipeline scripts and the
explicit named-tool option for non-shell tools. Prefix rules never broaden to
shell scripts. Unsupported pipeline syntax disables saving a rule; decide once
or ask for review instead.

Ask Assistant reviews the complete request independently of whether it can become
a command-prefix rule. Workers belonging to a named feature route that review to
its Feature Assistant. An expired or unavailable reviewer leaves the decision with
the person; approval never executes the requested operation as the reviewer.

## History and future rules

Approval history labels decisions by their source: You (once), You (saved rule),
a matching saved rule, or Assistant review. A native Codex Auto-review handoff is
shown as **Sent for review**, with **final result not reported**; it is not recorded
as an allow or deny because Codex owns that final decision.

Use **Create rule…** beside a history entry to review its command, original account
and folder, then choose a command/stage or named-tool match, scope, lifetime and
allow/deny decision.
**Save rule for future requests** creates only a future rule. It never replays or
answers the old request. Exact script/payload matches keep the original
task/session. Explicit named-tool matches can use broader selected scopes.
Redacted entries and older entries without
their original request context cannot be converted; create a rule from a new
approval instead. Newly recorded entries retain bounded rule context after their
requests close, without storing full tool-input payloads.

## Installation and a later migration

The policy helper, task package, native controls and shared status readers must
be installed together from a compatible build. Old scoped records and dated
expiries remain readable. Older builds do not understand the new Global and
tool-wide match kinds; do not apply them with a mixed-version installation.
The web chat reads stage status but rule creation/management remains in the
native Approvals dialog. Linked machines keep their own local rules and hooks.

An explicit inventory migration is separate from installation. Before running
this build's pruning-capable helpers against an existing inventory, preserve a
private byte-identical snapshot, including expired records. Use matching expired
records from that frozen snapshot as inputs before deleting originals. Selected
Global grants must explicitly use Forever, retain their tool identity, and have
duplicate Space grants removed. This implementation does not perform that live
migration or change any saved approval modes.
