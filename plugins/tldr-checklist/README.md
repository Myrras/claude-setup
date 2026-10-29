# tldr-checklist

A Claude Code mod that teaches Claude a short reply format and keeps a side pane next to the chat, updated after every turn:

- **TL;DR**: the one-line outcome of the latest reply.
- **Goal, Next, Blockers**: three short lines for the session, written by one small model call (haiku) per turn. If that call fails, the previous values stay.
- **→ You**: every `→ You` line from the replies becomes a checklist item. Click it, or focus it and press Enter, to tick or untick it. Ticked items stay in the list, dimmed and struck through, until the next reply. Items keep their state across turns, pane reopens and `--resume`. When a line repeats, it is not added again. From 10 open items on, the pane shows a warning to tick off what you have read. Each item has a reply field under it: type your answer and press Enter to save it (not on the mobile app, which has no field yet).

Each item gets a number `<reply>-<n>`: the reply that added it and its place among the items that reply added (`[ ] 2-3 Run the migration`). Numbers never change and are never reused; an item that was dropped and listed again gets a new one.

## Reply format

The mod tells Claude to answer in this format, once per conversation (sent again after a compaction, where Claude Code builds the context anew):

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
- Each `→ You` line is one item. Several spaces or a colon after the tag and a leading `-`/`*` bullet are fine. Indented or bullet lines right after a `→ You` line (its options) are joined to that item; a blank line, a tag line or a plain line ends it.
- A `✔ You <number>` line ticks the open item with that number (`✔ You 2-3`, `✔ You 2-3 Run the migration`, `✔ You 2-1, 2-3`). Numbers may be separated by commas, spaces, `and` or `&`, may start with `#` and may use an en dash (`#2–3`). A number that matches no open item ticks nothing, and the text after it is not matched; numbers that match no item at all are read as text. A `→ You` line that starts with the number of an existing item is that item, not a new one.
- A `✔ You <item>` line without a leading number ticks the open item with that text. A unique start of the text, in whole words, is enough (`Deploy` ticks `Deploy to staging` or `Deploy: staging`, not `Deploying the app`); punctuation ends a word (but `-` and `'` do not: `Re` does not tick `Re-run the job`), and a text that equals an item never matches another. An ambiguous start ticks nothing. A close in the same reply as a re-list wins.
- `✓`, `✅` and `☑` work like `✔`. `✔ Done` and `✔ Checked` (with any of them) never tick anything.
- A `✖ You <number>` line removes the item with that number (`✖ You 2-3`, `✖ You 2-1, 2-3`). Numbers only: text is never matched, so a removal is never a guess. `✗` and `❌` work like `✖`; `✖ Done` never removes anything. The same reply may list the text again, as a new item.
- Lines inside code fences are skipped.
- Repeats are matched with case and whitespace ignored.

## Checklist tool

Claude also keeps the checklist during a turn, not only through the reply text, with the `checklist` tool (`mcp__tldr-checklist__checklist`). Each change is saved, so the pane updates right away, and every call answers the list. `list` saves nothing. An error (an unknown number, a missing `text` or `ref`) is denied and changes nothing. Saves are skipped while the state file is unreadable, as with every other write.

- `list`: the items, open first, each with its number, state (`open`, `done`, or `read`: ticked by you) and text.
- `add`: `text`, one or a list. Adds open items like `→ You` lines, with the same repeat check. They are numbered in the reply in progress; `→ You` lines of that reply are numbered after them.
- `close`: `ref`, one or a list; one string may hold several numbers (`2-1, 2-3`, `2-1 and 2-3`). Ticks the items as done, as `✔ You <number>` does. They stay in the pane until the reply after this one.
- `remove`: `ref`, one or a list. Deletes items that no longer apply, for example "Merge the PR" when you ask for another fix first. They leave the pane right away; added again later, an item gets a new number.

Close means done; remove means withdrawn, not done. An unknown number changes nothing and the call says which. The tool is for the main conversation only: calls from subagents are refused. The reply format and the checklist state tell Claude to remove items your prompt makes premature or moot, and to add them again once they apply.

## Checklist state per prompt

With a prompt you send, Claude also gets the checklist as it stands, with item numbers: the open items, the ones you ticked and the ones its last reply closed. An item with a reply carries it, shortened to 200 characters (`- 2-1 Run the migration (your reply: use staging)`); the `checklist` tool's `list` shows it too. A tick of yours means you read the item, not that it is done: Claude may still mention it if it needs doing, but does not list it again unless it changed. It is told not to repeat items unless they changed, not to list what it can do itself or what is done, and to keep items short. When items are open, it is also told about `✔ You <number>`. With an empty checklist nothing is sent.

At most the 10 newest open items are sent; with more, Claude is told how many older ones were left out and to ask you to tick off what is done or close one by its text. The pane keeps them all.

The state is sent only when it changed since the last one sent (a new item, a tick by you, a reply or a checklist tool call). It is sent again after a compaction and after `/clear` or `/resume`, and at least every 5th prompt even when unchanged (Claude Code has no rewind event, and a rewind can drop the message that held it). A prompt that is dropped does not count as sent. Prompts you did not type (task notifications, peer messages, scheduled triggers, queued deliveries), prompts sent while Claude is still working, and headless runs get no state.

The reply format is added to every conversation, subagents too, as the API offers no way to limit it to the main one. It says to follow another format as a subagent or when one is asked.

## Setting

`inject` (on by default) sends both the reply format and the checklist state, and registers the checklist tool. Turn it off if you bring your own reply format: the pane then only reads the replies, and there is no checklist tool. A change to `inject` updates the tool list at the next session start; until then a call to the tool is refused. Turning it off mid-conversation stops the checklist state right away; the reply format already sent stays until the next conversation or compaction. Change it in `/config`, or in settings:

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

The pane opens by itself at session start when the terminal is wide enough (144 columns or more). `/tldr` opens it at any width and reopens it after you close it. In the fullscreen terminal, a click ticks an item. From the keyboard, focus the pane (ctrl+x tab), move with Tab or the arrow keys and press Enter. The **Check checklist** button at the bottom sends the TL;DR, the items and your replies to Claude as a prompt.

## State

There is one JSON file per session:

```
$CLAUDE_CONFIG_DIR/tldr-checklist/sessions/<session-id>.json
```

If `CLAUDE_CONFIG_DIR` is not set, the file goes in `~/.claude/tldr-checklist/sessions/`. It holds `{ sessionId, turn, tldr, goal, next, blockers, lastRef, items: [{ id, text, done, firstSeenTurn, ref, tickedBy, closedTurn, reply }] }`; `reply` is the text you typed under an item (missing when empty; older files load without it), `tickedBy` is `user` or `reply` on a ticked item, `closedTurn` the turn whose tool call closed it, and `lastRef` the last number handed out, so a removed item's number is not given again. A file from before item numbers loads with numbers derived from `firstSeenTurn` and the order of the items. The file is written after every turn, every tick and every checklist tool call. It is read at session start and when the session id changes (`/clear`, `/resume`); `/tldr` only opens the pane. A file that is not valid JSON is copied to `<session-id>.json.corrupt` and replaced by a fresh one; a file that cannot be read is left alone.

## Develop

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

`tsc` needs `.claude-plugin/types/`, which Claude Code writes when it loads the folder in an interactive `--plugin-dir` session. The folder is not in git.
