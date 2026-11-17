# Approval modes and remembered decisions

Approval handling is configured in **Yurherdr settings → Agents → Approvals** or
**Space settings → Agents → Approvals**. The dialog is wider to fit the controls.
Choose a default and optional Assistant, Workers and Reviewer overrides. Space
settings override the global layer; roles set to Default inherit its mode.
The default is **Ask me**, so installing this build does not enable automatic grants.

## Modes

| Mode | Behavior |
| --- | --- |
| Ask me | Permission cards wait for Allow once or Deny. Saved command rules are paused, except for a task/session where you explicitly remembered a grant. |
| Approved rules | Matching unexpired rules answer the request; unmatched requests still ask you. |
| Assistant review | Matching rules apply first; other execution requests go to the space's running Assistant using the review policy. |
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
- **Allow for this task**: remember the exact plain command for this task/session
  for 24 hours and answer it now.
- **Create rule…**: choose Exact command or Starting with…, task/session, space or
  account-in-this-folder scope, expiration, and allow or deny.
- **Ask Assistant**: delegate this request once, without changing global defaults.

Prefixes match parsed argument tokens. For example, `git status` matches
`git status --short`, not `git statusx`. Compound shell commands, substitutions,
redirections and broad shell/interpreter prefixes cannot be remembered through
this UI. Use Allow once or review each such request. Matching deny rules take
precedence over allow rules. Plans and product-choice questions never receive
execution grants and still need their own answer.

Every rule keeps its account identity and working-folder boundary. Space/task
rules also keep their space and task/session identity. Rules created for one
Codex login do not apply to the other login. Remembering a rule enables Approved
rules only for the current task/session until its expiry; it does not change the
global or space default. New sessions use their configured mode.

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
Create rule remains disabled when no single plain command can be extracted; prefix
rules never broaden to shell scripts. Quoted literal punctuation in a plain command
is accepted, while shell chaining, redirection and expansion remain excluded.

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
and folder, then choose an exact/prefix match, scope, expiry and allow/deny decision.
**Save rule for future requests** creates only a future rule. It never replays or
answers the old request. Scripts and non-command actions can only match the exact
payload in the original task/session. Redacted entries and older entries without
their original request context cannot be converted; create a rule from a new
approval instead. Newly recorded entries retain bounded rule context after their
requests close, without storing full tool-input payloads.
