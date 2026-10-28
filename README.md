# robbieminderhoud

Claude Code plugin marketplace.

```
claude plugin marketplace add RobbieMinderhoud/claude-orchestrator-mode
claude plugin install orchestrator-mode@robbieminderhoud
```

Existing installs: run `claude plugin marketplace update robbieminderhoud`, nothing else.

## Plugins

- [orchestrator-mode](plugins/orchestrator-mode/): Main session orchestrates and verifies; subagents make every change. Enforced by a PreToolUse hook.
