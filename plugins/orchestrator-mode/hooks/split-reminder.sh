#!/bin/sh
# PreToolUse (Agent|Task): nudge when one subagent brief bundles many items (non-blocking).
# Triggers at >= 8 list items or > 4000 chars. Subagents (agent_id set) are skipped.
# Always exits 0, never blocks; fails open without jq. Off switch: CLAUDE_ALLOW_DIRECT_EDITS=1
[ "$CLAUDE_ALLOW_DIRECT_EDITS" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
[ -n "$(printf '%s' "$input" | jq -r '.agent_id // empty' 2>/dev/null)" ] && exit 0
prompt=$(printf '%s' "$input" | jq -r '.tool_input.prompt // empty' 2>/dev/null)
[ -n "$prompt" ] || exit 0
items=$(printf '%s\n' "$prompt" | awk '/^[[:space:]]*```/{f=!f;next} !f' | grep -cE '^[[:space:]]*([-*][[:space:]]|[0-9]+[.)])')
len=$(printf '%s' "$prompt" | wc -m | tr -d ' ')
if [ "$items" -ge 8 ] || [ "$len" -gt 4000 ]; then
  jq -n --arg n "$items" --arg l "$len" '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:("Orchestrator mode: this brief bundles " + $n + " items (" + $l + " chars). If parts are independent, split them into vertical slices, spawn them in one message, and give each writer its own worktree. Keep it as one only if it cannot be split.")}}' 2>/dev/null
fi
exit 0
