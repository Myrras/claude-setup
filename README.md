# orchestrator-mode

A Claude Code plugin. The main session plans, reads and verifies; subagents make every change. Separating making from checking means the session that reports a result is not the one that produced it, so each change gets an independent look at the diff.

## Install

```
/plugin install orchestrator-mode --marketplace RobbieMinderhoud/claude-orchestrator-mode
```

Or from the CLI:

```
claude plugin marketplace add RobbieMinderhoud/claude-orchestrator-mode
claude plugin install orchestrator-mode@robbieminderhoud
```

## Example

A typical small fix, anonymised from real sessions:

```
> The search box fires too early. Make the debounce 3000 ms instead of 350.

● Bash  grep -rn "delay" src/components/SearchBox.vue
  191:  const delay = 350

  The constant is at src/components/SearchBox.vue:191. No test covers it.
  Delegating the one-line edit and the commit.

  Subagent: sonnet/medium

● Agent  Change search debounce
  │ Edit src/components/SearchBox.vue: delay 350 → 3000, nothing else.
  │ Commit only that file: "fix(search): wait 3 s before auto-search". Don't push.
  │ Verify: git show --stat HEAD shows 1 file, 1 line. Report the output.
  └ Done. 1 file changed, 1 insertion(+), 1 deletion(-). Commit 3f2a91c.

● Bash  git show HEAD
  -  const delay = 350
  +  const delay = 3000

  Search now waits 3 s before it runs.
  Done:    delay 350 → 3000 in SearchBox.vue, commit 3f2a91c
  Checked: git show HEAD → one line changed, nothing else
  Note:    no test covers this delay; not pushed
```

When the main session tries to edit anyway, the hook stops it and it delegates:

```
● Write  src/config.ts
  └ Denied: Orchestrator mode: the main session does not edit files. Delegate this
    change via the Agent tool with model and effort (...), then verify the diff yourself.

  Subagent: haiku/low

● Agent  Update config default
```

Larger work follows the same loop, at a bigger scale:

- Independent parts go out as parallel subagents in one message, e.g. backend on `sonnet/high` and docs on `haiku/low`.
- The main session reads the full diff and runs the tests and linter itself before it reports.
- Problems go back to the same subagent with `SendMessage` ("Round 2, same rules: 1. … 2. …") instead of being fixed in the main session.

In the first week of daily use: about 420 subagent spawns, a median of 3 per session, and about 12 seconds of extra time for a delegated one-line edit.

## Enforced vs. instructed

- Enforced: a PreToolUse hook blocks Edit, Write, MultiEdit and NotebookEdit in the main session. Memory, plan and scratchpad paths pass. Subagents pass (`agent_id` is set).
- Instructed only: Bash and MCP writes. `ORCHESTRATOR.md` is injected at session start and tells the model not to do them.

## Requirements

`jq` on PATH. Without it the hook fails closed and blocks all edits, subagents included.

## Off switch

Start Claude with `CLAUDE_ALLOW_DIRECT_EDITS=1`.

## Customising

Your own CLAUDE.md can override format details, such as the reporting line.

## Test

```
sh tests/hook.test.sh
```

## License

MIT
