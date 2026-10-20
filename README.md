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

A typical feature, anonymised from real sessions. Three independent parts go to three subagents at once, each on the model its job needs:

```
> Add a CSV export to the invoices page: an API endpoint, a button, and a changelog entry.

● Bash  grep -n "listInvoices\|filters" src/api/invoices.ts src/pages/Invoices.vue
  ...

  Three independent parts. Running them in parallel.
  Subagents: inherit/high (endpoint), sonnet/medium (button), haiku/low (changelog)

● Agent  CSV export endpoint        inherit/high · background
  │ Add GET /invoices/export.csv in src/api/invoices.ts. Reuse listInvoices(),
  │ same filters as the list endpoint. Add a test in tests/api/invoices.test.ts.
  │ Commit "feat(invoices): CSV export endpoint". Verify: npm test -- invoices.
● Agent  Export button              sonnet/medium · background
  │ Add an "Export CSV" button to src/pages/Invoices.vue that links to
  │ /invoices/export.csv with the current filters. Commit "feat(invoices): export button".
● Agent  Changelog entry            haiku/low · background
  │ Add one line under "Unreleased" in CHANGELOG.md: "CSV export on the invoices page".
  │ Commit "docs: changelog for CSV export".

  ⎿ Changelog entry done, commit 1c4e0a2                    9 s
  ⎿ Export button done, commit 7b19d3e                     48 s
  ⎿ CSV export endpoint done, 4 new tests pass, e2a6f80   3 min

● Bash  git diff HEAD~3 -- src/pages/Invoices.vue
  +  <a :href="`/invoices/export.csv?from=${from}&to=${to}`">Export CSV</a>

  The button drops the status filter. Sending it back.

● SendMessage  Export button
  │ Round 2, same rules: also pass the status filter (&status=...). Amend nothing, new commit.
  ⎿ Done, commit 4d8c2b1

● Bash  git log --oneline -4 && npm test && npm run lint
  212 passed · lint clean

  CSV export works end to end.
  Done:    endpoint + test, button, changelog (4 commits)
  Checked: git diff HEAD~4, npm test → 212 passed, lint clean
  Note:    not pushed
```

When the main session tries to edit anyway, the hook stops it and it delegates:

```
● Write  src/config.ts
  └ Denied: Orchestrator mode: the main session does not edit files. Delegate this
    change via the Agent tool with model and effort (...), then verify the diff yourself.

  Subagent: haiku/low

● Agent  Update config default
```

In the first week of daily use: about 420 subagent spawns, a median of 3 per session, and about 12 seconds of extra time for a delegated one-line edit.

## Enforced vs. instructed

- Enforced: a PreToolUse hook blocks Edit, Write, MultiEdit and NotebookEdit in the main session. Memory, plan and scratchpad paths pass. Subagents pass (`agent_id` is set).
- Reminded: a PostToolUse hook on Bash and MCP tools counts calls per turn in the main session and, at 4 (then every 4), adds a non-blocking reminder to delegate. Resets on each user prompt and when the turn ends. Subagents are not counted. Tune with `ORCHESTRATOR_DELEGATE_AFTER`.
- Instructed only: Bash and MCP writes, delegating long investigations, and dispatching parallel tasks to background subagents. `ORCHESTRATOR.md` is injected at session start and tells the model to do this.

## Requirements

`jq` on PATH. Without it the hook fails closed and blocks all edits, subagents included.

## Off switch

Start Claude with `CLAUDE_ALLOW_DIRECT_EDITS=1`.

## Customising

Your own CLAUDE.md can override format details, such as the reporting line.

## Test

```
sh tests/hook.test.sh
sh tests/delegate-reminder.test.sh
```

## License

MIT
