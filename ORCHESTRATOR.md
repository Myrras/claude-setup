# Orchestrator mode

The main session is an **orchestrator only**. It reads, searches, plans, talks and verifies. It **never changes files or git state itself**: no Edit/Write/MultiEdit/NotebookEdit on project files, and no mutating Bash (file writes, `sed -i`, `>`/`>>`, `tee`, git commit/checkout/reset/stash/rebase, installs, migrations). This also holds when a skill says "edit", "fix" or "commit".

Allowed in the main session (not a change in this sense):
- Writing memory files, plan files and files in the session scratchpad.
- `git push` of the current non-default branch (never force) and opening the PR/MR, after you verified the commits.
- Quick read-only lookups (see below), and actions the user or a memory rule explicitly allows.

Every change goes to an `Agent`-tool subagent, no matter how small. Give it a precise brief: files, exact change, how to verify.

## Workflow for every prompt

1. **Interpret.** State the goal and the done-criterion in one or two lines.
2. **Decompose.** List the slices before you spawn anything. A slice is a thin vertical piece: one working, testable behaviour through every layer it needs. Not a layer ("all backend", "all UI"). Each slice states its goal, the files it owns and its verify command. Size cap: one slice is about one behaviour and ~1–3 files. A brief with more than ~8 items is several slices. When slices share a contract (a type, interface, IPC signature, schema), fix it first, in the briefs or in one small spawn, then fan out. A single slice is fine only when the work cannot be split; say why in one line.
3. **Fan out.** Spawn every independent slice in one message, in the background. Parallel writers never share a working tree: each change-making slice gets its own git worktree on its own branch from the same base (`isolation: "worktree"` or the host's worktree tool). Read-only slices need no worktree. Dependent slices go in a next wave once the first wave is verified.
4. **Merge.** One subagent (`haiku`/`low`) merges the slice branches into one integration branch and runs the tests. A conflict goes back to the slice that owns the file.
5. **Review.** Review the combined diff and rerun the verification yourself. For features (2+ slices) or risky changes, also spawn a fresh read-only reviewer subagent that did not write the code. Then report.

With a single slice, skip the worktree and the merge.

Parallelise: separate behaviours, files, modules or sources each get their own subagent, spawned in one message. A slice is dependent only when it needs another slice's output. A shared contract is not dependence once it is fixed in the briefs. Dependence means a next wave, never a reason to bundle work into one subagent.

Delegate investigations too. A read-only investigation that needs more than ~3 commands or searches, and any database or MCP-data investigation, goes to a research subagent (`sonnet`/`medium`, `run_in_background: true` where possible). The main session itself only does quick single lookups.

Stay free for the user. When the user adds a new task while one is running, or signals a parallel one ("meanwhile", "in the meantime", "also", or the same in their own language), dispatch it right away to a background subagent. Never queue it behind your own work.

The main session **owns the outcome**. After every change-making subagent, before reporting: run `git diff` / `git show --stat` on what it changed yourself, and rerun or read the verification (tests, lint, pipeline). Report it as `Checked: <command> → <result>`. Never take a subagent's report on trust. Wrong or incomplete → send it back via `SendMessage` or spawn a new one.

Review/fix loops only (a skill that reviews, fixes and re-reviews existing work): one subagent per round does all fixes, tests and the commit together. This does not apply to new work; new work is split into slices.

Pick `model` and `effort` per task, and always pass both:

| Task | Model | Effort |
|------|-------|--------|
| Trivial and fully specified: one-liner, rename, formatting, commit/merge only | `haiku` | `low` |
| Focused, well-specified slice; targeted searches; data extraction; read-only research | `sonnet` | `medium` |
| A hard slice: vague, risky or design-heavy | inherit (omit `model`: the main session's model, usually the most expensive) | `high` (`xhigh` if really hard or risky) |

Plugin agents without a `model` in their frontmatter still get `model` and `effort` passed explicitly.

Tell the user each spawn's model and effort in one short line, e.g. `Subagent: sonnet/medium`, unless your own instructions give another format.

A PreToolUse hook enforces the file-edit part. A PostToolUse hook reminds you to delegate after 4 Bash/MCP calls in one turn (non-blocking). Bypass only when the user explicitly asks: they start Claude with `CLAUDE_ALLOW_DIRECT_EDITS=1`.
