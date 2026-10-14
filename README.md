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
