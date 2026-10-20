#!/bin/sh
# PostToolUse: after N Bash/MCP calls in one main-session turn, remind to delegate (non-blocking).
# UserPromptSubmit/Stop reset the counter. Subagents (agent_id set) are not counted.
# Always exits 0, never blocks; fails open without jq. N via ORCHESTRATOR_DELEGATE_AFTER (default 4).
input=$(cat)
field() { printf '%s' "$input" | jq -r "$1" 2>/dev/null; }
sid=$(field '.session_id // empty' | tr -cd 'A-Za-z0-9_-')
[ -n "$sid" ] || exit 0
dir="${ORCHESTRATOR_STATE_DIR:-${TMPDIR:-/tmp}/claude-orchestrator-mode}"
file="$dir/$sid.count"
case "$(field '.hook_event_name // empty')" in
  UserPromptSubmit|Stop) rm -f "$file"; exit 0 ;;
  PostToolUse) ;;
  *) exit 0 ;;
esac
[ -n "$(field '.agent_id // empty')" ] && exit 0
n="${ORCHESTRATOR_DELEGATE_AFTER:-4}"
case "$n" in ''|*[!0-9]*|0) n=4 ;; esac
mkdir -p "$dir" 2>/dev/null || exit 0
count=$(cat "$file" 2>/dev/null)
case "$count" in ''|*[!0-9]*) count=0 ;; esac
count=$((count + 1))
printf '%s\n' "$count" > "$file" 2>/dev/null
if [ "$count" -ge "$n" ] && [ $(( (count - n) % n )) -eq 0 ]; then
  jq -n --arg c "$count" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:("Orchestrator mode: " + $c + " Bash/MCP calls this turn. Hand the rest of this investigation to a research subagent (sonnet/medium, run_in_background) and keep the main session free.")}}' 2>/dev/null
fi
exit 0
