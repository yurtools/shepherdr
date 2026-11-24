# Available Assistants and background work

The space Assistant and each Feature Assistant coordinate in short turns. They
hand implementation, research, build/test runs, CI and remote waits, and sustained
monitoring to task workers, then end their interactive turn. Research or monitoring
that changes no files uses a task in the existing folder (`--here`), with a finite
stopping condition in its brief. A queued result is a successful handoff, not a
reason to wait or dispatch another copy.

## Supported dispatch contract

1. The Assistant adds a focused task, or uses the existing task for that work.
   `herdr-task start <id> --space <space> --parent <assistant> --json` returns the
   worker address or a queued result. It does not wait for the worker's work.
2. The task launch creates a fresh `hc run --bg` child with `--outlive-parent`,
   task/space/owner labels and, where applicable, the durable feature ID. This is
   an independent worker conversation, never a second process resuming the
   interactive Assistant's CLI session. Worker account, model, effort and
   permissions come from the existing resolved Worker settings; neither role
   silently inherits the Assistant's broader permission mode.
3. Repeated starts still check dependencies, machine holds and folder capacity.
   Only explicit `--now` skips those checks. Queued retries keep their position and
   captured launch arguments. A cancelled queued task does not launch later.
4. The scheduler starts queued work, tracks progress and delivers settled task
   news. News is batched by space and feature. Ownership is rechecked on start or
   resume: a stale parent must still be the appropriate live Assistant, never an
   ordinary worker or another feature/space. A closed Feature Assistant does not
   transfer its tasks or news to the space Assistant. A restarted Feature Assistant
   can be found by its durable feature ID within the original space.
5. The interactive Assistant replies briefly and ends its turn, including after a
   news message or an Autopilot wake. It does not loop over `hc wait`, test runs,
   CI watches or remote polls. Workers keep their task status current and continue
   their long commands independently.

## Approval delivery and limits

A person's configured Assistant review, or an explicit Ask Assistant action,
creates the existing request-bound ticket. `approvals.py` sends it to the owning
interactive Assistant via `hc send`. Feature review requires both the original
space and feature ID. Space review excludes feature terminals. An ordinary worker
cannot submit a ticket assigned to the Assistant. The exact-input hash, original
account/folder/task context, token, expiry, saved-deny and policy rechecks,
exclusive answer claim and audit record remain in force. Questions and plans stay
with the person; this dispatch change adds no review authority or settings.

The transport sends input to one CLI conversation. It has no supported operation
that runs two independent turns concurrently in that same CLI session. If the
Assistant itself is still in a long tool call, folder-trust dialog, permission
prompt, provider stall or other busy turn, `hc send` may queue or refuse the ticket;
it cannot guarantee an immediate judgment. Tickets expire after ten minutes and
retain the existing person-facing fallback. Dispatch plus ending the turn avoids
holding that conversation for the worker's lifetime. Template instructions guide
that choice; they cannot enforce model behavior or preempt an arbitrary CLI tool
call. No parallel approval agent, copied Assistant session, worker self-approval or
new automatic answer to a person's question is introduced.

`service/actions.ts` sends to the selected Assistant terminal and tests its own
turn state, independently of child activity. `service/agents.ts` and `lib/agent.js`
restart or switch the selected conversation; they are not background dispatch APIs
and are unchanged. The existing scheduler, news, held-message and Autopilot paths
continue to deliver events without an interactive wait loop.

## Regression evidence

- `test/test_assistant_dispatch.py`: real throwaway task stores and scheduler
  passes; dependency/capacity retries, queue position, cancellation, feature
  capture before queueing, stale/worker/wrong-space parents and review routing.
- `test/test_launch_settings.py`: launch arguments retain the Worker account,
  model and effort, use a fresh background session and carry task/space/feature
  ownership; the existing permission and account lifecycle checks still apply.
- `service/assistant-dispatch.test.ts`: the actual service send action and Hub RPC
  path deliver a new message to an idle space or Feature Assistant while a fixture
  worker stays active, including when the sender asks to hold messages for busy
  turns. The other feature receives nothing.
- `test/test_assistant_responsiveness.py`: the real permission hook and decision
  helper, using fake hc metadata/transport, deliver a valid ticket and a new chat
  message while the fixture worker stays active. Only the designated owner can
  decide; replay is refused and exactly one audit decision is recorded.
- Existing approval regressions cover changed/closed requests, expiry, policy
  changes, saved denies, account/folder context and competing human decisions.

These are isolated protocol and runtime tests, not native visual proof or a real
model answering a message. No real auxiliary worker was started for this task.
The live native window and local web service were confirmed present, but task
code was not activated there. Native CLI timing, remote delivery and deployment
remain unproven. Updated templates apply to newly started or restarted roles after installation;
existing conversations are not rewritten. No installation or restart was done
for this task. The proof recipe records the before/after runs and full checks.
