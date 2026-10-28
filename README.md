# tldr-checklist

A Claude Code mod that keeps a side pane next to the chat, updated after every turn:

- **TL;DR**: the one-line outcome of the latest reply.
- **Goal, Next, Blockers**: three short lines for the session, written by one small model call (haiku) per turn. If that call fails, the previous values stay.
- **→ You**: every `→ You` line from the replies becomes a checklist item. Click it, or focus it and press Enter, to tick or untick it. Ticked items stay in the list, dimmed and struck through. Items keep their state across turns, pane reopens and `--resume`. When a line repeats, it is not added again.

## Reply format it reads

The TL;DR and checklist come straight from the reply text, with no model call:

```
TL;DR  one line: the outcome

✔ Done  what was done
→ You   what you need to do
! Note  risks
```

- The first `TL;DR` line is the TL;DR. If a reply has none, the previous one stays.
- Each `→ You` line is one item. Several spaces after the tag and a leading `-`/`*` bullet are fine.
- Lines inside code fences are skipped.
- Repeats are matched with case and whitespace ignored.

## Install

Try it for one session:

```
claude --plugin-dir /path/to/claude-tldr-checklist
```

Or install it from a local marketplace:

```
claude plugin marketplace add /path/to/claude-tldr-checklist
claude plugin install tldr-checklist@tldr-checklist
```

## Usage

The pane opens by itself at session start when the terminal is wide enough (144 columns or more). `/tldr` opens it at any width and reopens it after you close it. In the fullscreen terminal, a click ticks an item. From the keyboard, focus the pane (ctrl+x tab), move with Tab or the arrow keys and press Enter.

## State

There is one JSON file per session:

```
$CLAUDE_CONFIG_DIR/tldr-checklist/sessions/<session-id>.json
```

If `CLAUDE_CONFIG_DIR` is not set, the file goes in `~/.claude/tldr-checklist/sessions/`. It holds `{ sessionId, turn, tldr, goal, next, blockers, items: [{ id, text, done, firstSeenTurn }] }`. The file is written after every turn and every tick. It is read at session start and when the session id changes (`/clear`, `/resume`); `/tldr` only opens the pane. A file that is not valid JSON is copied to `<session-id>.json.corrupt` and replaced by a fresh one; a file that cannot be read is left alone.

## Develop

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

`tsc` needs `.claude-plugin/types/`, which Claude Code writes when it loads the folder in an interactive `--plugin-dir` session. The folder is not in git.
