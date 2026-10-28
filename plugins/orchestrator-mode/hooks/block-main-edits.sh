#!/bin/sh
# PreToolUse: block file edits in the main session; subagents (agent_id set) and non-project paths pass.
# Off switch: CLAUDE_ALLOW_DIRECT_EDITS=1
[ "$CLAUDE_ALLOW_DIRECT_EDITS" = "1" ] && exit 0
input=$(cat)
field() { printf '%s' "$input" | jq -r "$1" 2>/dev/null; }
[ -n "$(field '.agent_id // empty')" ] && exit 0
case "$(field '.tool_input.file_path // .tool_input.notebook_path // empty')" in
  "$HOME"/.claude/projects/*/memory/*|"$HOME"/.claude/plans/*|/private/tmp/claude-*|/tmp/claude-*) exit 0 ;;
esac
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Orchestrator mode: the main session does not edit files. Delegate this change via the Agent tool with model and effort (haiku/low trivial, sonnet/medium focused, inherit/high large), then verify the diff yourself."}}'
