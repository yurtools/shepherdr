# Discarding a mistaken turn

A message sent to the wrong agent is different from a message you only want to hide.
The context that a CLI supplies to its model, not the list of bubbles in Chat,
determines what the agent continues from.

## What you can do now

**Discard mistaken turn…** is available on the latest identifiable user prompt
in a live Codex conversation using paginated history. It is a guided provider
rewind, not a delete button on every bubble.

1. If the agent is still working, use **Stop** and wait for it to stop. The
   action requires an idle or completed terminal and a closed provider turn.
2. If the message is still held by Chat rather than sent, use the **×
   (Withdraw unsent message)** beside the queued message. It does not change any
   conversation history. The web app keeps the row until withdrawal is confirmed
   and will not resend the same successfully withdrawn send ID on a delayed retry.
   A stale or already-claimed queue entry is not a successful withdrawal.
3. Otherwise open the last prompt's **Discard mistaken turn…** action (hold the
   message on a phone). The preview names the prompt and explains the scope.
   **Open Terminal** verifies that the same CLI process and saved conversation
   still have that exact latest turn. It opens the existing terminal, not a new
   worker.
4. In Codex itself, with its composer empty, press Esc twice. Check that the
   highlighted prompt is the mistaken one, then press Enter to rewind. The CLI
   must confirm that the conversation was reverted. Clear the restored prompt
   without sending it. Cancel if the highlighted prompt is different or the CLI
   reports an error. Return to Chat when ready.

This excludes the whole native turn, including its prompt, replies and tool
conversation records. It does **not** undo already-run commands, edits, commits,
approval decisions, external actions or work another agent already performed.
Stop any still-running background work separately. It does not change the
agent's account, permissions, task, Feature, or terminal: the existing CLI
performs the operation. There is no guaranteed undo of a native in-place
revert. Do not confirm it if you need an independently recoverable original.

The action is not offered on older individual messages, injected/ambiguous
prompts, history without the native turn/item identity, turns with more than
one user prompt (including steering, where discarding would also lose the other
prompt), or legacy history. It does not stand in for a general message-delete
operation. For messages queued inside a CLI rather than held by Chat, use the
CLI's own interface; Chat cannot yet verify and withdraw those entries.

After Codex reverts, its saved conversation may use a new physical rollout
segment with a reference to a prefix of an older segment. Chat reads only those
retained byte ranges, resolves the live writer again even if its process did
not change, and keeps the logical session ID for resume and ownership. A missing
or unverifiable lineage (including unsupported compressed base files) reports
**Retained conversation unavailable** instead of displaying a misleading partial
history; use Terminal in that case. The underlying provider files are not edited
by Yurherdr. The separate saved-session history preview still reads bounded
portions of one file; it is not an authoritative model-context preview.

## Provider investigation (25 November 2026)

The installation on the development machine reports **Codex CLI 0.172.0**.
Claude Code was not installed on that machine (`claude --version` was
unavailable); the repository includes Claude transcript fixtures labelled
2.1.314, but those are not a runtime check of an installed Claude version.

| Operation | Verified or documented boundary |
| --- | --- |
| Codex paginated latest-turn discard | App Server `thread/revert` with the exact `beforeTurnId` excludes that turn and all following turns; the logical thread ID stays the same. The actual 0.172.0 terminal double-Esc, Enter, clear-restored-draft workflow was also exercised against a synthetic model. |
| Codex legacy latest-turn discard | `thread/revert` rejects legacy storage, including through the 0.172.0 terminal rewind menu. App Server `thread/fork` before the exact turn works in a new thread; the original is kept and resumable. Automatic migration to that new identity is not implemented. |
| Codex queued submission | The installed App Server lists and deletes an unsent submission by provider ID. This is separate from removing a turn that reached the model; it is not wired into Shepherdr's terminal-owned CLI queue. |
| Codex older single user/assistant item | No arbitrary history-item-remove method in the generated installed protocol, even with experimental fields. The documented `thread/inject_items` can append retained text items to a new thread without running a turn. Both roles and later text were observed in the next model input after a restart, but the new thread's native turn list did not expose these injected items as original turns. Not a shipped feature. |
| Claude Code | Current [checkpointing documentation](https://code.claude.com/docs/en/checkpointing) describes restoring conversation to a checkpoint while keeping code, or separately restoring code. Its selected prompt is returned to the composer, and a subsequent prompt is needed to persist the rewind. [Session documentation](https://code.claude.com/docs/en/agent-sdk/sessions) describes resume and fork. No documented arbitrary single-item omission was found. Runtime exclusion and persistence were not verified here, so no new discard action is offered for Claude. |

Sources: [Codex App Server](https://learn.chatgpt.com/docs/app-server)
(history operations, paginated reads and raw item injection),
[Codex CLI reference](https://learn.chatgpt.com/docs/cli/reference)
(terminal rewind shortcut), [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction)
(opaque compacted input), and the installed CLI's generated experimental
protocol. The CLI's physical storage observed in the scratch profile is JSONL:
legacy rollouts append ordinary response/event records; paginated rollouts also
carry ordinals and may reference prior physical generations by ID and exact
byte/ordinal cutoffs. Claude's existing Chat adapter reads its process's
session ID and project JSONL, where message UUIDs, parent links and tool blocks
are distinct from display offsets.

## Controlled proof

Run at the repository root:

```sh
python3 scripts/probe-chat-context.py
```

The probe uses the installed Codex App Server with a credential-free temporary
profile, project and a loopback-only scripted Responses endpoint. There is no
real model call, live session or historical command execution. It compares
actual outgoing model inputs for an unchanged control with the continuation
after provider-native discard and a server restart. It verifies both completed
and interrupted turns with a synthetic tool call/result, provider-queued
withdrawal, shared Chat parsing of the actual generated rollouts, retained text
roles after single-item omission in a new thread, and a local compaction
summary preceding a mistaken turn (a summary produced after the mistake is
excluded by reverting before that turn). The synthetic compaction summary is
not a test of OpenAI's production encrypted compaction service.

The normal unit checks cover exact/stale selection, ambiguous multi-prompt
turns, idle and session guards, repeated generation boundaries, retained tool
outputs, and held-send cancellation and its retry behavior.

## Why older individual removal is not offered yet

A visible Chat bubble is a projection, not necessarily an atomic provider
input. A reply may span several records, a tool invocation needs its matching
result, or an old prompt can have become part of an opaque compaction summary.
Images, attachments, external instructions and references cannot be recovered
faithfully from cleaned display text alone. A later retained message may quote
or paraphrase the omitted one. This includes information in files, memories,
tool results or other conversations that the agent can obtain again.

A future general exclusion feature would have to construct a new, explicitly
labelled continuation using provider-supported context operations, preview the
exact role-bearing retained items and any dependent records, never replay
historical commands, and keep the original as a recoverable conversation.
For a managed agent it would also need a transaction that transfers the exact
account, permissions, task/Feature, ownership and view identity only after the
new session is validated; on failure the original stays available. Neither
in-place transcript-file rewriting nor a purely cosmetic hide action meets that
requirement. For legacy histories a provider-native prefix fork is preferable
to reconstructing the visible text, but it has the same new-session ownership
and recovery requirement.

A discard is context exclusion at a provider-supported boundary, not data
erasure or a guarantee that the model cannot ever infer or encounter the
information again.
