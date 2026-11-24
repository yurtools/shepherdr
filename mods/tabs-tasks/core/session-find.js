// Locate the main conversation held by one exact agent process.
// One Codex process can hold its main rollout and guardian/reviewer rollouts.
// File-descriptor ordering does not identify the conversation shown to the user.
export const CODEX_LOG_PICKER = String.raw`
import json, sys
paths = list(dict.fromkeys(line.strip() for line in sys.stdin if line.strip()))
for path in paths:
    try:
        with open(path, encoding="utf-8") as f:
            meta = json.loads(f.readline())
        source = (meta.get("payload") or {}).get("source")
        if isinstance(source, dict) and "subagent" in source:
            continue
    except (OSError, ValueError):
        continue
    print(path)
    break
`;

export const FIND = `
kind="$1"; pid="$2"
procs() { if [ -r /proc/self/stat ]; then cat /proc/[0-9]*/stat 2>/dev/null | awk '{ p = $1; sub(/.*\\) /, ""); print p, $2 }'; else ps -axo pid=,ppid= 2>/dev/null; fi; }
kids() { procs | sort -n | awk -v r="$1" 'function walk(p,  c, m, j) { m = split(k[p], c, " "); for (j = 1; j <= m; j++) if (!(c[j] in s)) { s[c[j]] = 1; print c[j]; walk(c[j]) } } { k[$2] = k[$2] " " $1 } END { s[r] = 1; walk(r) }'; }
for p in "$pid" $(kids "$pid"); do
  if [ "$kind" = claude ]; then
    j="$HOME/.claude/sessions/$p.json"
    [ -f "$j" ] || continue
    id=$(sed -n 's/.*"sessionId":"\\([0-9a-fA-F-]*\\)".*/\\1/p' "$j")
    [ -n "$id" ] || continue
    for f in "$HOME"/.claude/projects/*/"$id".jsonl; do [ -f "$f" ] && { echo "$f"; exit 0; }; done
    echo "pending"; exit 0
  else
    if [ -d "/proc/$p/fd" ]; then
      f=$(for d in /proc/$p/fd/*; do readlink "$d"; done 2>/dev/null | grep '/rollout-.*\\.jsonl$' | python3 -c '${CODEX_LOG_PICKER}')
    else
      f=$(lsof -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p' | grep '/rollout-.*\\.jsonl$' | python3 -c '${CODEX_LOG_PICKER}')
    fi
    [ -n "$f" ] && { echo "$f"; exit 0; }
  fi
done
true`;

