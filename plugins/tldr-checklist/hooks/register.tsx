import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc, Item } from '../types'
import { applyReply, applyTool, emptyDoc, FORMAT, listText, mergeDocs, OPEN_CAP, panelState, parseDoc, parseReply, parseStatus, statusPrompt, ticked, toggle, withoutClosed } from './parse'
import type { Reply, ToolInput } from './parse'

const PANE = 'tldr-checklist'
const TITLE = 'TL;DR'
const FORMAT_BLOCK = 'replyFormat'
const TOOL = 'mcp__tldr-checklist__checklist'
const TOOL_SPEC = {
  name: 'checklist',
  description:
    'The → You checklist in the side panel. list: show it. add: add open items (text). close: mark items done (ref). remove: withdraw items that no longer apply (ref); add them again once they apply. Every action answers the list.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'add', 'close', 'remove'] },
      text: { description: 'add: item text, or a list of them', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      ref: { description: 'close, remove: item number like 2-1, or a list of them', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    },
    required: ['action'],
  },
  isDeferred: false,
}

// Change the tag when Doc's fields change (a new optional field needs none): an older value then reads as empty.
const doc = atom({ plugin: 'tldr-checklist', key: 'doc' } as const, emptyDoc(''), { shape: 'doc-2' })
const lastPrompt = atom({ plugin: 'tldr-checklist', key: 'prompt' } as const, '')
const interactive = atom({ plugin: 'tldr-checklist', key: 'interactive' } as const, true)
// The checklist state last sent, and the prompts since; a prompt sends it only when it changed or
// RESEND_EVERY prompts passed (the API has no rewind event, and a rewind can drop the message that held it).
// Cleared on a compaction, /clear and /resume.
const RESEND_EVERY = 5
const NOTHING_SENT = { sessionId: '', text: '', count: 0 }
const sent = atom({ plugin: 'tldr-checklist', key: 'sent' } as const, NOTHING_SENT)

async function stateFile($: EngineInterface, sessionId: string): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '')
  return config ? `${config}/tldr-checklist/sessions/${sessionId}.json` : undefined
}

// The session whose state file could not be read; it is never overwritten. An atom, so it survives a code reload.
const unreadable = atom({ plugin: 'tldr-checklist', key: 'unreadable' } as const, '')

// A doc from a failed read, kept in memory, joins the file once it reads again.
const merge = mergeDocs

// The session id changes on /clear and /resume; the doc follows it, loading that session's file.
async function current($: EngineInterface): Promise<Doc> {
  const sessionId = await $.session.id()
  const held = await read($, doc)
  const stuck = (await read($, unreadable)) === sessionId
  if (held.sessionId === sessionId && !stuck) return held
  const file = await stateFile($, sessionId)
  let loaded = emptyDoc(sessionId)
  let failed = false
  if (file && (await $.fs.exists(file))) {
    const text = await $.fs.read(file).catch(error => {
      failed = true
      if (!stuck) $.ui.log(`tldr-checklist: could not read state, it is left as is (${String(error)})`)
      return undefined
    })
    if (text !== undefined) {
      const parsed = parseDoc(text, sessionId)
      if (parsed) loaded = parsed
      else {
        await $.fs.write(`${file}.corrupt`, text).catch(error => $.ui.log(`tldr-checklist: could not keep the corrupt state (${String(error)})`))
        $.ui.log(`tldr-checklist: state file was corrupt, kept as ${sessionId}.json.corrupt`)
      }
    }
  }
  if (failed) await update($, unreadable, () => sessionId)
  else if (stuck) await update($, unreadable, () => '')
  const result = await update($, doc, v => (v.sessionId !== sessionId ? loaded : failed ? v : stuck ? merge(loaded, v) : v))
  if (stuck && !failed) await save($, result)
  return result
}

// Writes go one after another so an older doc never lands after a newer one.
let saving: Promise<void> = Promise.resolve()
let warned = false

async function save($: EngineInterface, value: Doc): Promise<void> {
  if (!value.sessionId || value.sessionId === (await read($, unreadable))) return saving
  saving = saving
    .then(async () => {
      const file = await stateFile($, value.sessionId)
      if (file) return $.fs.write(file, `${JSON.stringify(value, null, 2)}\n`)
      if (!warned) $.ui.log('tldr-checklist: no CLAUDE_CONFIG_DIR or HOME, state is not saved')
      warned = true
    })
    .catch(error => $.ui.log(`tldr-checklist: could not save state (${String(error)})`))
  return saving
}

async function change($: EngineInterface, fn: (value: Doc) => Doc): Promise<Doc> {
  const updated = await update($, doc, fn)
  await save($, updated)
  return updated
}

// The turn whose status call may still apply; a newer call replaces it.
let statusTurn = 0

async function refreshStatus(
  $: EngineInterface,
  reply: Reply,
  sessionId: string,
  turn: number,
  userPrompt: string,
): Promise<void> {
  const held = await read($, doc)
  if (turn !== statusTurn || held.sessionId !== sessionId) return
  const prompt = statusPrompt(held, reply, userPrompt)
  const answer = await $.model.complete({ model: 'haiku', prompt, maxTokens: 300, timeoutMs: 30000 })
  const status = answer.isAnswered ? parseStatus(answer.text) : undefined
  if (!status) return
  // A newer scheduled call wins; a newer turn without a call does not discard this one.
  await change($, value => (value.sessionId === sessionId && turn === statusTurn ? { ...value, ...status } : value))
}

export const register: Register = (on, options) => {
  // Off for those who bring their own reply format: nothing is added to what the model reads.
  if (options.inject !== false) {
    // Once per conversation, sent again after a compaction. It fires for subagents too, so it resets nothing.
    on('prompt.context', async ($, e, next) => {
      return next({ ...e, blocks: [...e.blocks.filter(block => block.name !== FORMAT_BLOCK), { name: FORMAT_BLOCK, text: FORMAT }] })
    })

    // After a compaction the state is gone from the history: send it with the next prompt.
    on('session.compact', async ($, e, next) => {
      const result = await next(e)
      if (e.agentId === undefined && e.trigger !== 'precompute' && result.messages) {
        await update($, sent, () => NOTHING_SENT).catch(error => $.ui.log(`tldr-checklist: could not reset the sent state (${String(error)})`))
      }
      return result
    })

    // A prompt carries the checklist when it changed since the last one sent, so replies neither repeat nor miss items.
    on('prompt.submit', async ($, e, next) => {
      // Only what the user typed: not commands, meta or queued deliveries, task notifications, peers, triggers or plugin prompts.
      // Headless runs never apply `✔ You` lines, so the state would only go stale.
      const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
      if (e.command || e.isMeta || e.turnId !== undefined || !typed || !(await read($, interactive))) return next(e)
      let state: string | undefined
      let plan: { sessionId: string; text: string; send: boolean } | undefined
      try {
        const value = await current($)
        const text = panelState(value) ?? ''
        const last = await read($, sent)
        const send = last.sessionId !== value.sessionId || last.text !== text || last.count + 1 >= RESEND_EVERY
        plan = { sessionId: value.sessionId, text, send }
        if (send) state = text || undefined
      } catch (error) {
        $.ui.log(`tldr-checklist: could not read the checklist (${String(error)})`)
      }
      const result = await next(state ? { ...e, context: [...(e.context ?? []), state] } : e)
      // Counted as sent only when the prompt went in.
      if (plan && !result.drop) {
        const { sessionId, text, send } = plan
        await update($, sent, v => (send ? { sessionId, text, count: 0 } : { ...v, count: v.count + 1 })).catch(error =>
          $.ui.log(`tldr-checklist: could not save the sent state (${String(error)})`),
        )
      }
      return result
    })
  }

  // The checklist during a turn, not only through the reply. The main conversation's alone.
  // Registered always: the tool list only changes at the next session start, so a call after `inject` went off is refused.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (options.inject === false) return { deny: 'The checklist tool is off (inject setting).' }
    if (e.agentId !== undefined) return { deny: 'The checklist belongs to the main conversation; a subagent cannot use it.' }
    try {
      const input = e as ToolInput
      const held = await current($)
      if (input.action === 'list') return { result: listText(held) }
      // The update may run again on a newer value; its last run decides.
      const outcome = { error: '', changed: false }
      const updated = await update($, doc, value => {
        const result = applyTool(value, input)
        outcome.error = 'error' in result ? result.error : ''
        outcome.changed = 'doc' in result && result.doc !== value
        return 'doc' in result ? result.doc : value
      })
      if (outcome.error) return { deny: outcome.error }
      if (outcome.changed) await save($, updated)
      return { result: listText(updated) }
    } catch (error) {
      $.ui.log(`tldr-checklist: could not run the checklist tool (${String(error)})`)
      return { deny: `The checklist could not be read or saved (${String(error)}).` }
    }
  })

  on('session.start', async ($, e, next) => {
    const step = (what: string, fn: () => unknown) =>
      Promise.resolve()
        .then(fn)
        .catch(error => $.ui.log(`tldr-checklist: could not ${what} (${String(error)})`))
    await step('save settings', () => update($, interactive, () => e.isInteractive))
    if (e.isInteractive) await step('open pane', () => $.ui.open({ id: PANE, title: TITLE, backgroundColor: 'transparent' }))
    await step('register command', () => $.command.register({ name: 'tldr', description: 'Show the TL;DR and → You checklist pane' }))
    if (options.inject !== false) await step('register tool', () => $.tool.register(TOOL_SPEC))
    await step('load state', () => current($))

    return next(e)
  })

  on('command.run', { command: 'tldr' }, async $ => {
    await current($)
    await $.ui.open({ id: PANE, title: TITLE, backgroundColor: 'transparent' })

    return { text: 'TL;DR pane opened.' }
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, doc, () => emptyDoc(''))
      await update($, sent, () => NOTHING_SENT)
      // The new id may arrive late: check again every 100 ms, then leave it to the next turn.complete.
      const check = (left: number) => {
        $.session
          .id()
          .then(id => {
            if (id !== e.sessionId || left <= 1) return current($)
            $.clock.after(100, () => check(left - 1))
          })
          .catch(error => $.ui.log(`tldr-checklist: could not load state (${String(error)})`))
      }
      $.clock.after(0, () => check(20))
    }
    return ended
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim()) await update($, lastPrompt, () => e.text)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    try {
      if (e.agentId !== undefined || e.reason !== 'answer' || !(await read($, interactive))) return done
      const reply = parseReply(e.answer)
      const prompt = await read($, lastPrompt)
      const { sessionId } = await current($)
      const updated = await change($, value => applyReply(value, reply))
      // Only the closes that ticked something count.
      const closed = ticked(updated)
      if (!reply.tldr && !reply.you.length && !reply.notes.length && !closed.length) return done
      const { turn } = updated
      statusTurn = turn
      // The status call runs after the turn so it never holds up the prompt.
      $.clock.after(0, () => {
        refreshStatus($, withoutClosed(reply, closed), sessionId, turn, prompt).catch(error =>
          $.ui.log(`tldr-checklist: could not refresh status (${String(error)})`),
        )
      })
    } catch (error) {
      $.ui.log(`tldr-checklist: could not update the checklist (${String(error)})`)
    }

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const value = await read($, doc)
    const open = value.items.filter(item => !item.done).length
    const line = (label: string, text: string) => (
      <Text>
        <Text bold>{label} </Text>
        {text ? text : <Text dimColor>-</Text>}
      </Text>
    )
    const row = (item: Item) => (
      <Button key={item.id} plain onPress={() => change($, d => toggle(d, item.id))}>
        <Text dimColor={item.done} strikethrough={item.done}>
          {item.done ? '[x] ' : '[ ] '}
          {item.ref} {item.text}
        </Text>
      </Button>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>TL;DR</Text>
          {value.tldr ? <Text>{value.tldr}</Text> : <Text dimColor>No TL;DR yet.</Text>}
        </Box>
        <Box flexDirection="column">
          {line('Goal', value.goal)}
          {line('Next', value.next)}
          {line('Blockers', value.blockers)}
        </Box>
        <Box flexDirection="column">
          <Text bold>
            → You <Text dimColor>({open} open)</Text>
          </Text>
          {value.items.length === 0 && <Text dimColor>Nothing for you yet.</Text>}
          {open >= OPEN_CAP && (
            <Text color="warning" dimColor>
              {OPEN_CAP}+ open items — tick off what you have read
            </Text>
          )}
          {value.items.map(row)}
        </Box>
      </Box>
    )
  })
}
