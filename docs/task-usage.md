# CPU and memory on Working tasks

The Tasks list and the open task header show the **task's** usage, not the
machine's load or the worker's last command alone. For example, `CPU 230% · RSS
1.2 GiB` means the task used about 2.3 logical cores over the last sample interval
and its processes currently have a combined 1.2 GiB of resident memory.

- **CPU:** 100% is one logical core; several processes or threads can exceed
  100%. The number is the increase in own user + system CPU time divided by
  elapsed seconds, rounded to a whole percent. On Linux, a verified dedicated
  cgroup v2 scope contributes its interval CPU counter (including children that
  exited in the interval); processes outside those scopes contribute their own
  interval CPU. Never add a parent's waited-for-child CPU to a child's CPU.
- **RSS:** sum of resident bytes of the distinct live processes, expressed in
  MiB or GiB, not virtual memory, a memory cap, or unique physical memory. Shared
  pages can appear in more than one process's RSS. Exited processes no longer
  contribute RSS.
- **Ownership:** the machine holding the task list resolves its live terminal
  records by the full `herdr.task` key, checks the terminal's process birth and
  foreground relationship, and includes all descendants, not just direct
  children. Concurrent workers, owned helpers and recorded reviewers are
  combined once. Separate tasks' terminal trees are boundaries. A pre-existing
  daemon used by many builds is not attributed by command name, path, or user.
- **Detached processes:** Linux uses the exact, unique systemd scope already
  created by the low-priority worker launcher, when it can verify membership
  and read the scope. This includes background and reparented children within
  the scope even if their original parent was never sampled. Without a dedicated
  scope (low priority off, missing user systemd, macOS), the sample is the live
  process tree plus previously observed, still-identical descendants across a
  continuing active terminal. It cannot discover an unseen process that escaped
  the tree, attribute work sent to a shared service, or count CPU of tree-only
  processes that both start and exit between samples. Linux uses process start
  ticks; macOS uses libproc's precise birth time, own CPU and RSS. Unsupported or
  unreadable process metadata produces unavailable data rather than a guess.
- **Refresh:** the existing task news pass (scheduler and tick) collects the
  terminal records it already reads, once per host, at most every 12 seconds
  (normally a 15-second tick). It walks the process table only when a Working
  task has a live owned terminal and bounds the scan. Native and web consume the
  same atomic aggregate cache with their existing list refresh. The open native
  task reads the same cache with its existing header refresh. No new monitor,
  launch policy, worker memory cap, or machine start/alert threshold is installed.
- **Unavailable:** `CPU —` while there is no comparable baseline (including
  changed workers/scopes); real zero is `0%`. `Usage unavailable` means no
  matching trustworthy sample; `Usage stale` means its timestamp is over 45
  seconds old or inconsistent with the reader's clock. Queued, stopped, ready
  (not working), done, and other non-Working tasks have no numbers. This is a
  sampled estimate, not a historical total or an enforcement limit.

The public cache is per machine and contains task keys, terminal identities,
aggregate counters and timestamps, not process command lines or environments.
The separate short-lived numeric baseline is discarded when there are no
Working task terminals. A remote host must be running the updated task helper
and have a reachable cache; an older or unreachable host does not produce local
estimates for its tasks.
