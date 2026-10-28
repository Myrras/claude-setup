import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc, Item } from '../types'
import { applyReply, emptyDoc, parseDoc, parseReply, parseStatus, statusPrompt, toggle } from './parse'
import type { Reply } from './parse'

const PANE = 'tldr-checklist'
const TITLE = 'TL;DR'

// Change the tag when Doc's fields change: an older value then reads as empty.
const doc = atom({ plugin: 'tldr-checklist', key: 'doc' } as const, emptyDoc(''), { shape: 'doc-1' })
const lastPrompt = atom({ plugin: 'tldr-checklist', key: 'prompt' } as const, '')
const interactive = atom({ plugin: 'tldr-checklist', key: 'interactive' } as const, true)

async function stateFile($: EngineInterface, sessionId: string): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '')
  return config ? `${config}/tldr-checklist/sessions/${sessionId}.json` : undefined
}

// A state file that exists but cannot be read is never overwritten with an empty doc.
let unreadable: string | undefined

// The session id changes on /clear and /resume; the doc follows it, loading that session's file.
async function current($: EngineInterface): Promise<Doc> {
  const sessionId = await $.session.id()
  const held = await read($, doc)
  if (held.sessionId === sessionId) return held
  const file = await stateFile($, sessionId)
  const fail = (why: string) => {
    unreadable = sessionId
    $.ui.log(`tldr-checklist: could not read state, it is left as is (${why})`)
  }
  let loaded = emptyDoc(sessionId)
  if (file && (await $.fs.exists(file))) {
    const text = await $.fs.read(file).catch(error => {
      fail(String(error))
      return undefined
    })
    if (text !== undefined) {
      const parsed = parseDoc(text, sessionId)
      if (parsed) {
        loaded = parsed
        if (unreadable === sessionId) unreadable = undefined
      } else fail('not valid JSON')
    }
  }
  return update($, doc, v => (v.sessionId === sessionId ? v : loaded))
}

// Writes go one after another so an older doc never lands after a newer one.
let saving: Promise<void> = Promise.resolve()
let warned = false

function save($: EngineInterface, value: Doc): Promise<void> {
  if (!value.sessionId || value.sessionId === unreadable) return saving
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
  const prompt = statusPrompt(held, reply, userPrompt)
  const answer = await $.model.complete({ model: 'haiku', prompt, maxTokens: 300, timeoutMs: 30000 })
  const status = answer.isAnswered ? parseStatus(answer.text) : undefined
  if (!status) return
  // A newer scheduled call wins; a newer turn without a call does not discard this one.
  await change($, value => (value.sessionId === sessionId && turn === statusTurn ? { ...value, ...status } : value))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'tldr', description: 'Show the TL;DR and → You checklist pane' })
      await current($)
      await update($, interactive, () => e.isInteractive)
      if (e.isInteractive) {
        $.ui.open({ id: PANE, title: TITLE }).catch(error => $.ui.log(`tldr-checklist: could not open pane (${String(error)})`))
      }
    } catch (error) {
      $.ui.log(`tldr-checklist: could not start (${String(error)})`)
    }

    return next(e)
  })

  on('command.run', { command: 'tldr' }, async $ => {
    await current($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'TL;DR pane opened.' }
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, doc, () => emptyDoc(''))
      // The new id may arrive late: check again every 100 ms, then leave it to the next turn.complete.
      const check = (left: number) => {
        $.session
          .id()
          .then(id => {
            if (id !== e.sessionId) return current($)
            if (left > 1) $.clock.after(100, () => check(left - 1))
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
    if (e.agentId !== undefined || e.reason !== 'answer' || !(await read($, interactive))) return done
    const reply = parseReply(e.answer)
    const prompt = await read($, lastPrompt)
    const { sessionId } = await current($)
    const updated = await change($, value => applyReply(value, reply))
    if (!reply.tldr && !reply.you.length && !reply.notes.length) return done
    const { turn } = updated
    statusTurn = turn
    // The status call runs after the turn so it never holds up the prompt.
    $.clock.after(0, () => {
      refreshStatus($, reply, sessionId, turn, prompt).catch(error =>
        $.ui.log(`tldr-checklist: could not refresh status (${String(error)})`),
      )
    })

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
          {item.text}
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
          {value.items.map(row)}
        </Box>
      </Box>
    )
  })
}
