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

A typical feature, anonymised from real sessions. The session states the goal, cuts it into vertical slices, and runs each slice in its own git worktree. A subagent merges the branches, and a read-only reviewer checks the result:

```
> Add a CSV export to the invoices page: an API endpoint, a button, and a changelog entry.

  Goal: invoices page exports the filtered list as CSV.
  Done when: endpoint + button work with all filters, npm test and lint pass.
  Three vertical slices, no shared files:
  1. endpoint   src/api/invoices.ts, tests/api/invoices.test.ts
  2. button     src/pages/Invoices.vue
  3. changelog  CHANGELOG.md

● Agent  CSV export endpoint        inherit/high · worktree · background
  │ Add GET /invoices/export.csv in src/api/invoices.ts. Reuse listInvoices(),
  │ same filters as the list endpoint. Test in tests/api/invoices.test.ts.
  │ Branch slice/endpoint. Verify: npm test -- invoices.
● Agent  Export button              sonnet/medium · worktree · background
  │ Add an "Export CSV" button to src/pages/Invoices.vue linking to
  │ /invoices/export.csv with the current filters. Branch slice/button.
● Agent  Changelog entry            haiku/low · worktree · background
  │ One line under "Unreleased" in CHANGELOG.md. Branch slice/changelog.

  ⎿ Changelog entry done, slice/changelog                   9 s
  ⎿ Export button done, slice/button                       48 s
  ⎿ CSV export endpoint done, 4 new tests pass, slice/endpoint  3 min

● Agent  Merge slices               haiku/low
  │ Merge slice/endpoint, slice/button, slice/changelog into integration/csv-export.
  ⎿ Merged, no conflicts

● Agent  Review                     sonnet/medium · read-only
  │ Review the diff main..integration/csv-export against the goal.
  ⎿ Invoices.vue: the export link drops the status filter.

● Bash  git diff main..integration/csv-export -- src/pages/Invoices.vue
  +  <a :href="`/invoices/export.csv?from=${from}&to=${to}`">Export CSV</a>

  Confirmed. Sending it back to the slice owner.

● SendMessage  Export button
  │ Also pass the status filter (&status=...). New commit on slice/button.
  ⎿ Done, commit 4d8c2b1

● Bash  git merge slice/button && npm test && npm run lint
  212 passed · lint clean

  CSV export works end to end.
  Done:    endpoint + test, button, changelog (3 slices, merged)
  Checked: review + git diff main..integration/csv-export, npm test → 212 passed, lint clean
  Note:    not pushed
```

On a big brief, the split reminder nudges the session before it spawns one large subagent:

```
● Agent  Implement all 12 items
  ⎿ Reminder: this brief has 12 items. Split it into vertical slices,
    one worktree per writer, and spawn them in one message.
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
- Reminded: a PreToolUse hook on Agent and Task in the main session adds a non-blocking nudge when a brief has 8 or more list items or over 4000 characters. It tells the model to split the work into vertical slices, one worktree per writer.
- Instructed only: Bash and MCP writes, delegating long investigations, the decomposition workflow (interpret, slice, fan out, merge, review), and dispatching parallel tasks to background subagents. `ORCHESTRATOR.md` is injected at session start and tells the model to do this.

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
sh tests/split-reminder.test.sh
```

## License

MIT
