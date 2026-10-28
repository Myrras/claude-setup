# robbieminderhoud

Claude Code plugin marketplace.

```
claude plugin marketplace add RobbieMinderhoud/claude-setup
claude plugin install orchestrator-mode@robbieminderhoud
```

Existing installs: run `claude plugin marketplace update robbieminderhoud`, nothing else. The old URL RobbieMinderhoud/claude-orchestrator-mode keeps working via GitHub's redirect.

## Plugins

- [orchestrator-mode](plugins/orchestrator-mode/): Main session orchestrates and verifies; subagents make every change. Enforced by a PreToolUse hook.
- [tldr-checklist](plugins/tldr-checklist/): Side pane with the latest TL;DR, the session's goal, next step and blockers, and a persistent checklist of every → You line
