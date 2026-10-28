#!/bin/sh
hook="$(cd "$(dirname "$0")" && pwd)/../hooks/block-main-edits.sh"
fail=0

check() { # name, expect(deny|none), input, [env]
  out=$(printf '%s' "$3" | env $4 sh "$hook"); rc=$?
  case "$2" in
    deny) printf '%s' "$out" | grep -q '"permissionDecision":"deny"' && [ $rc -eq 0 ] ;;
    none) [ -z "$out" ] && [ $rc -eq 0 ] ;;
  esac
  if [ $? -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

check "memory path passes" none "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$HOME/.claude/projects/x/memory/a.md\"}}"
check "scratchpad passes" none '{"tool_name":"Write","tool_input":{"file_path":"/tmp/claude-1/scratch/a.txt"}}'
check "main edit denied" deny '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/a.php"}}'
check "subagent passes" none '{"agent_id":"abc","tool_name":"Edit","tool_input":{"file_path":"/repo/src/a.php"}}'
check "notebook denied" deny '{"tool_name":"NotebookEdit","tool_input":{"notebook_path":"/repo/a.ipynb"}}'
check "garbage fails closed" deny 'garbage'
check "off switch passes" none '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/a.php"}}' CLAUDE_ALLOW_DIRECT_EDITS=1

exit $fail
