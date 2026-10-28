#!/bin/sh
hook="$(cd "$(dirname "$0")" && pwd)/../hooks/delegate-reminder.sh"
export ORCHESTRATOR_STATE_DIR=$(mktemp -d)
trap 'rm -rf "$ORCHESTRATOR_STATE_DIR"' EXIT
fail=0

run() { printf '%s' "$1" | sh "$hook"; }
ev() { # event, session, [extra json fields]
  printf '{"hook_event_name":"%s","session_id":"%s"%s}' "$1" "$2" "$3"
}

check() { # name, expect(none|remind), input
  out=$(run "$3"); rc=$?
  case "$2" in
    remind) [ $rc -eq 0 ] && printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | length > 0' >/dev/null 2>&1 ;;
    none) [ -z "$out" ] && [ $rc -eq 0 ] ;;
  esac
  r=$?
  if [ $r -eq 0 ] && printf '%s' "$out" | grep -qiE 'deny|block'; then r=1; fi
  if [ $r -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

bash_call() { ev PostToolUse "$1" ',"tool_name":"Bash"'; }

check "call 1 silent" none "$(bash_call s1)"
check "call 2 silent" none "$(bash_call s1)"
check "call 3 silent" none "$(bash_call s1)"
check "call 4 reminds" remind "$(bash_call s1)"
for i in 5 6 7; do check "call $i silent" none "$(bash_call s1)"; done
check "call 8 reminds" remind "$(bash_call s1)"

out=$(run "$(bash_call s1)"; run "$(bash_call s1)"; run "$(bash_call s1)"; run "$(bash_call s1)")
if printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | test("^Orchestrator mode: 12 ")' >/dev/null 2>&1
then echo "ok   call 12 reminds with count"; else echo "FAIL call 12 reminds with count"; fail=1; fi

mcp() { ev PostToolUse "$1" ',"tool_name":"mcp__gitlab__get-issue"'; }
for i in 1 2 3; do check "mcp call $i silent" none "$(mcp m1)"; done
check "mcp call 4 reminds" remind "$(mcp m1)"

sub() { ev PostToolUse "$1" ',"agent_id":"abc","tool_name":"Bash"'; }
for i in 1 2 3 4 5 6 7 8; do check "subagent call $i silent" none "$(sub a1)"; done
for i in 1 2 3; do check "main after subagent call $i silent" none "$(bash_call a1)"; done
check "main call 4 reminds" remind "$(bash_call a1)"

for i in 1 2 3; do run "$(bash_call p1)" >/dev/null; done
check "UserPromptSubmit silent" none "$(ev UserPromptSubmit p1)"
for i in 1 2 3; do check "after prompt reset call $i silent" none "$(bash_call p1)"; done

for i in 1 2 3; do run "$(bash_call t1)" >/dev/null; done
check "Stop silent" none "$(ev Stop t1)"
for i in 1 2 3; do check "after stop reset call $i silent" none "$(bash_call t1)"; done

check "garbage input silent" none 'garbage'
check "empty input silent" none ''
check "no session_id silent" none '{"hook_event_name":"PostToolUse","tool_name":"Bash"}'

for i in 1 2 3; do run "$(bash_call x1)" >/dev/null; done
check "separate session counts separately" none "$(bash_call x2)"
check "first session still reminds" remind "$(bash_call x1)"

exit $fail
