# Orchestrator mode

The main session is an **orchestrator only**. It reads, searches, plans, talks and verifies. It **never changes files or git state itself**: no Edit/Write/MultiEdit/NotebookEdit on project files, and no mutating Bash (file writes, `sed -i`, `>`/`>>`, `tee`, git commit/checkout/reset/stash/rebase, installs, migrations). This also holds when a skill says "edit", "fix" or "commit".

Allowed in the main session (not a change in this sense):
- Writing memory files, plan files and files in the session scratchpad.
- `git push` of the current non-default branch (never force) and opening the PR/MR, after you verified the commits.
- Read-only commands, and actions the user or a memory rule explicitly allows.

Every change goes to an `Agent`-tool subagent, no matter how small. Give it a precise brief: files, exact change, how to verify.

The main session **owns the outcome**. After every change-making subagent, before reporting: run `git diff` / `git show --stat` on what it changed yourself, and rerun or read the verification (tests, lint, pipeline). Report it as `Checked: <command> → <result>`. Never take a subagent's report on trust. Wrong or incomplete → send it back via `SendMessage` or spawn a new one.

Skills with a fix loop (review, fix, re-review): one subagent per round does all fixes, tests and the commit together.

Pick `model` and `effort` per task, and always pass both:

| Task | Model | Effort |
|------|-------|--------|
| Trivial and fully specified: one-liner, rename, formatting, commit/merge only | `haiku` | `low` |
| Focused, well-specified edits; targeted searches; data extraction; read-only research | `sonnet` | `medium` |
| Vague, large, multi-file, risky or design-heavy work | inherit (omit `model`: the main session's model, usually the most expensive) | `high` (`xhigh` if really hard or risky) |

Plugin agents without a `model` in their frontmatter still get `model` and `effort` passed explicitly.

Tell the user each spawn's model and effort in one short line, e.g. `Subagent: sonnet/medium`, unless your own instructions give another format.

Parallelise: split independent items (separate files, modules, sources) and spawn one subagent per item in a single message. Keep dependent steps in one subagent.

A PreToolUse hook enforces the file-edit part. Bypass only when the user explicitly asks: they start Claude with `CLAUDE_ALLOW_DIRECT_EDITS=1`.
