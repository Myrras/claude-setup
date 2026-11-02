---
name: delegation-plan
description: Use when the user asks for a delegation plan or plan of attack, or when multi-task work is about to fan out to subagents; it lists the tasks, suggests a model per task, and asks for feedback, go or full go.
---

# Delegation plan

Follow `ORCHESTRATOR.md` (slices, worktrees, model/effort table, subagent types, main session never edits). Do not restate it here.

## 1. Interpret

State the goal and the done-criterion in 1-2 lines. Read only enough code to cut the work. Delegate bigger investigations, as `ORCHESTRATOR.md` says.

## 2. Plan

One table, one row per task (a vertical slice):

| # | Task | Files owned | Agent | Model/effort | Wave | Depends on | Verify | Status |
|---|------|-------------|-------|--------------|------|------------|--------|--------|

- Agent: `orchestrator-mode:worker`, `orchestrator-mode:worker-lean`, `Explore` or `general-purpose`.
- Model/effort: from the `ORCHESTRATOR.md` table.
- Status: planned / running / done / failed. Keep it current in every progress report.
- No two tasks own the same file. Fix shared contracts first.

Under the table:
- Waves: wave 1 = all independent tasks; wave N = tasks that need earlier output.
- Final step: merge + review, with its model/effort.

## 3. Ask

Use AskUserQuestion with three options:
- **Full go**: run everything at max parallelism.
- **Go**: wave by wave, pausing after each wave.
- **Feedback**: the user changes the plan.

Feedback: revise the table, ask again. Spawn nothing before Go or Full go.

## 4. Go

Spawn all tasks of the current wave in one message, in the background, one worktree per writer. When they finish, verify each yourself (`git diff` / `git show --stat`, rerun the verify command). Report a short wave result with the updated table, then ask: next wave / Feedback / Full go for the rest / Stop.

## 5. Full go

Spawn every independent task at once, as many in parallel as the plan allows. Start each next-wave task as soon as its dependencies are verified, without asking. Pause only for a failure a `SendMessage` fix cannot solve, or a decision that belongs to the user. Then merge and review as `ORCHESTRATOR.md` says, and report with the final table.
