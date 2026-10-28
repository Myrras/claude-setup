#!/bin/sh
hook="$(cd "$(dirname "$0")" && pwd)/../hooks/split-reminder.sh"
fail=0

run() { printf '%s' "$1" | sh "$hook"; }
call() { # prompt, [extra json fields]
  jq -n --arg p "$1" '{hook_event_name:"PreToolUse",tool_name:"Agent",tool_input:{prompt:$p}}' | { [ -n "$2" ] && jq -c ". + $2" || cat; }
}

check() { # name, expect(none|nudge), input
  out=$(run "$3"); rc=$?
  case "$2" in
    nudge) [ $rc -eq 0 ] && printf '%s' "$out" | jq -e '.hookSpecificOutput | .hookEventName == "PreToolUse" and (.additionalContext | length > 0) and (has("permissionDecision") | not)' >/dev/null 2>&1 ;;
    none) [ -z "$out" ] && [ $rc -eq 0 ] ;;
  esac
  r=$?
  if [ $r -eq 0 ] && printf '%s' "$out" | grep -qiE 'deny|"ask"|block'; then r=1; fi
  if [ $r -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

bullets() { i=1; while [ $i -le "$1" ]; do printf -- '- item %s\n' "$i"; i=$((i + 1)); done; }
big=$(awk 'BEGIN{for(i=0;i<4100;i++)printf "x"}')

check "small brief silent" none "$(call 'Fix the typo in README.')"
check "7 bullets silent" none "$(call "$(bullets 7)")"
check "8 bullets nudge" nudge "$(call "$(bullets 8)")"
check "8 numbered items nudge" nudge "$(call "$(i=1; while [ $i -le 8 ]; do printf '%s) step\n' $i; i=$((i + 1)); done)")"
check "bullets in code fence silent" none "$(call "$(printf 'See list.\n```\n'; bullets 8; printf '```\n')")"
check "long brief nudge" nudge "$(call "$big")"
check "subagent big brief silent" none "$(call "$big" '{"agent_id":"abc"}')"
check "subagent 8 bullets silent" none "$(call "$(bullets 8)" '{"agent_id":"abc"}')"
check "garbage input silent" none 'garbage'
check "empty input silent" none ''

out=$(run "$(call "$(bullets 9)")")
if printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | test("bundles 9 items")' >/dev/null 2>&1
then echo "ok   nudge reports item count"; else echo "FAIL nudge reports item count"; fail=1; fi

out=$(CLAUDE_ALLOW_DIRECT_EDITS=1 run "$(call "$(bullets 9)")")
if [ -z "$out" ]; then echo "ok   off switch silent"; else echo "FAIL off switch silent"; fail=1; fi

exit $fail
