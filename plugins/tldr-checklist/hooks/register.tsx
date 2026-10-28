import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc, Item } from '../types'
import { applyReply, emptyDoc, FORMAT, OPEN_CAP, panelState, parseDoc, parseReply, parseStatus, statusPrompt, ticked, toggle, withoutClosed } from './parse'
import type { Reply } from './parse'

const PANE = 'tldr-checklist'
const TITLE = 'TL;DR'
const FORMAT_BLOCK = 'replyFormat'

// Change the tag when Doc's fields change: an older value then reads as empty.
const doc = atom({ plugin: 'tldr-checklist', key: 'doc' } as const, emptyDoc(''), { shape: 'doc-2' })
const lastPrompt = atom({ plugin: 'tldr-checklist', key: 'prompt' } as const, '')
const interactive = atom({ plugin: 'tldr-checklist', key: 'interactive' } as const, true)
// The checklist state last sent; a prompt sends it only when it changed. Cleared when the context is read again.
const NOTHING_SENT = { sessionId: '', text: '' }
const sent = atom({ plugin: 'tldr-checklist', key: 'sent' } as const, NOTHING_SENT)

async function stateFile($: EngineInterface, sessionId: string): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '')
  return config ? `${config}/tldr-checklist/sessions/${sessionId}.json` : undefined
}

// The session whose state file could not be read; it is never overwritten. An atom, so it survives a code reload.
const unreadable = atom({ plugin: 'tldr-checklist', key: 'unreadable' } as const, '')

// A doc from a failed read, kept in memory, joins the file once it reads again.
function merge(file: Doc, held: Doc): Doc {
  const ids = new Set(file.items.map(item => item.id))
  const pick = (key: 'tldr' | 'goal' | 'next' | 'blockers') => held[key] || file[key]
  return {
    ...file,
    turn: Math.max(file.turn, held.turn),
    tldr: pick('tldr'),
    goal: pick('goal'),
    next: pick('next'),
    blockers: pick('blockers'),
    items: [...file.items, ...held.items.filter(item => !ids.has(item.id))],
  }
}

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
    // Once per conversation, sent again after a compaction; the checklist state then goes out again too.
    on('prompt.context', async ($, e, next) => {
      await update($, sent, () => NOTHING_SENT).catch(error => $.ui.log(`tldr-checklist: could not reset the sent state (${String(error)})`))
      return next({ ...e, blocks: [...e.blocks.filter(block => block.name !== FORMAT_BLOCK), { name: FORMAT_BLOCK, text: FORMAT }] })
    })

    // A prompt carries the checklist when it changed since the last one sent, so replies neither repeat nor miss items.
    on('prompt.submit', async ($, e, next) => {
      // Only what the user typed: not commands, meta or queued deliveries, task notifications, peers, triggers or plugin prompts.
      // Headless runs never apply `✔ You` lines, so the state would only go stale.
      const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
      if (e.command || e.isMeta || e.turnId !== undefined || !typed || !(await read($, interactive))) return next(e)
      let state: string | undefined
      try {
        const value = await current($)
        const text = panelState(value) ?? ''
        const last = await read($, sent)
        if (last.sessionId !== value.sessionId || last.text !== text) {
          await update($, sent, () => ({ sessionId: value.sessionId, text }))
          state = text || undefined
        }
      } catch (error) {
        $.ui.log(`tldr-checklist: could not read the checklist (${String(error)})`)
      }
      return next(state ? { ...e, context: [...(e.context ?? []), state] } : e)
    })
  }

  on('session.start', async ($, e, next) => {
    const step = (what: string, fn: () => unknown) =>
      Promise.resolve()
        .then(fn)
        .catch(error => $.ui.log(`tldr-checklist: could not ${what} (${String(error)})`))
    await step('save settings', () => update($, interactive, () => e.isInteractive))
    if (e.isInteractive) await step('open pane', () => $.ui.open({ id: PANE, title: TITLE, backgroundColor: 'transparent' }))
    await step('register command', () => $.command.register({ name: 'tldr', description: 'Show the TL;DR and → You checklist pane' }))
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
