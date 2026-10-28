# tldr-checklist

A Claude Code mod that teaches Claude a short reply format and keeps a side pane next to the chat, updated after every turn:

- **TL;DR**: the one-line outcome of the latest reply.
- **Goal, Next, Blockers**: three short lines for the session, written by one small model call (haiku) per turn. If that call fails, the previous values stay.
- **→ You**: every `→ You` line from the replies becomes a checklist item. Click it, or focus it and press Enter, to tick or untick it. Ticked items stay in the list, dimmed and struck through, until the next reply. Items keep their state across turns, pane reopens and `--resume`. When a line repeats, it is not added again.

## Reply format

The mod tells Claude to answer in this format, once per conversation (sent again after a compaction):

```
TL;DR  one line: the outcome
✔ Done  what was done
✔ Checked  what was verified
→ You   what you need to do or decide
! Note  risks
```

`TL;DR` goes first; a trivial answer is just that line. `→ You` is only for what you must do or decide yourself. `✔ Done`, `✔ Checked` and `! Note` are optional.

The TL;DR and checklist come straight from the reply text, with no model call:

- The first `TL;DR` line is the TL;DR. If a reply has none, the previous one stays.
- Each `→ You` line is one item. Several spaces or a colon after the tag and a leading `-`/`*` bullet are fine.
- A `✔ You <item>` line ticks the open item with that text, as if you clicked it. A unique start of the text is enough; an ambiguous one ticks nothing. `✔ Done` and `✔ Checked` never tick anything.
- Lines inside code fences are skipped.
- Repeats are matched with case and whitespace ignored.

## Checklist state per prompt

With each prompt you send, Claude also gets the checklist as it stands: the open items and the ones you ticked. It is told not to repeat them unless they changed, not to list what it can do itself or what is done, and to keep items short. When items are open, it is also told about `✔ You <item>`. With an empty checklist nothing is sent.

## Setting

`inject` (on by default) sends both the reply format and the checklist state. Turn it off if you bring your own reply format: the pane then only reads the replies. Change it in `/config`, or in settings:

```json
{ "pluginConfigs": { "tldr-checklist": { "options": { "inject": false } } } }
```

## Install

Try it for one session:

```
claude --plugin-dir /path/to/claude-tldr-checklist
```

Or install it from the marketplace:

```
claude plugin marketplace add RobbieMinderhoud/claude-setup
claude plugin install tldr-checklist@robbieminderhoud
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
