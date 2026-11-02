#!/bin/sh
# PreToolUse: block file edits in the main session; subagents (agent_id set) and non-project paths pass.
# Off switch: CLAUDE_ALLOW_DIRECT_EDITS=1
[ "$CLAUDE_ALLOW_DIRECT_EDITS" = "1" ] && exit 0
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Orchestrator mode: jq is not installed, so every file edit is blocked. Install jq first (macOS: brew install jq, Windows: winget install jqlang.jq, Linux: your package manager), then restart Claude from a new terminal."}}'
  exit 0
fi
input=$(cat)
field() { printf '%s' "$input" | jq -r "$1" 2>/dev/null; }
[ -n "$(field '.agent_id // empty')" ] && exit 0
# Windows: jq ends lines with \r\n and paths are C:\... while $HOME is /c/...; normalise and also allow $USERPROFILE.
path=$(field '.tool_input.file_path // .tool_input.notebook_path // empty' | tr -d '\r' | tr '\\' '/')
up=$(printf '%s' "$USERPROFILE" | tr -d '\r' | tr '\\' '/')
[ -n "$up" ] || up=$HOME
case "$path" in
  "$HOME"/.claude/projects/*/memory/*|"$HOME"/.claude/plans/*|/private/tmp/claude-*|/tmp/claude-*) exit 0 ;;
  "$up"/.claude/projects/*/memory/*|"$up"/.claude/plans/*|"$up"/AppData/Local/Temp/claude/*) exit 0 ;;
esac
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Orchestrator mode: the main session does not edit files. Delegate this change via the Agent tool with model and effort (haiku/low trivial, sonnet/medium focused, inherit/high large), then verify the diff yourself."}}'
