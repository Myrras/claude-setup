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

async function stateFile($: EngineInterface, sessionId: string): Promise<string> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  return `${config}/tldr-checklist/sessions/${sessionId}.json`
}

// The session id changes on /clear and /resume; the doc follows it, loading that session's file.
async function current($: EngineInterface): Promise<Doc> {
  const sessionId = await $.session.id()
  const held = await read($, doc)
  if (held.sessionId === sessionId) return held
  const file = await stateFile($, sessionId)
  const text = (await $.fs.exists(file)) ? await $.fs.read(file).catch(() => '') : ''
  const loaded = text ? parseDoc(text, sessionId) : emptyDoc(sessionId)
  return update($, doc, () => loaded)
}

// Writes go one after another so an older doc never lands after a newer one.
let saving: Promise<void> = Promise.resolve()

function save($: EngineInterface, value: Doc): Promise<void> {
  if (!value.sessionId) return saving
  saving = saving
    .then(async () => $.fs.write(await stateFile($, value.sessionId), `${JSON.stringify(value, null, 2)}\n`))
    .catch(error => $.ui.log(`tldr-checklist: could not save state (${String(error)})`))
  return saving
}

async function change($: EngineInterface, fn: (value: Doc) => Doc): Promise<void> {
  await save($, await update($, doc, fn))
}

async function refreshStatus($: EngineInterface, reply: Reply, sessionId: string): Promise<void> {
  const held = await read($, doc)
  const prompt = statusPrompt(held, reply, await read($, lastPrompt))
  const answer = await $.model.complete({ model: 'haiku', prompt, maxTokens: 300, timeoutMs: 30000 })
  const status = answer.isAnswered ? parseStatus(answer.text) : undefined
  if (!status) return
  await change($, value => (value.sessionId === sessionId ? { ...value, ...status } : value))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tldr', description: 'Show the TL;DR and → You checklist pane' })
    await current($)
    void $.ui.open({ id: PANE, title: TITLE })

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
      $.clock.after(0, () => void current($))
    }
    return ended
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim()) await update($, lastPrompt, () => e.text)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return done
    const reply = parseReply(e.answer)
    const { sessionId } = await current($)
    await change($, value => applyReply(value, reply))
    // The status call runs after the turn so it never holds up the prompt.
    $.clock.after(0, () => void refreshStatus($, reply, sessionId))

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
