import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Doc } from '../types'
import { applyReply, emptyDoc, normalize, parseDoc, parseReply, parseStatus, statusPrompt, toggle } from './parse'

const FILE = '/home/me/.claude/tldr-checklist/sessions/s1.json'
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const PANE = {
  plugin: 'tldr-checklist',
  component: 'Pane',
  requestId: 'tldr-checklist',
  props: {
    title: 'TL;DR',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const REPLY_1 = `TL;DR  Added the export endpoint

Some details.

\`\`\`
→ You  this line is inside a fence
\`\`\`

✔ Done  endpoint (src/export.ts)
→ You   Run the migration
- → You Review the PR
! Note  CSV only for now`

const REPLY_2 = `TL;DR Fixed the review comments

→ You  run   the MIGRATION
→ You  Deploy to staging`

describe('parseReply', () => {
  test('reads TL;DR, → You and ! Note lines, skipping code fences', () => {
    const reply = parseReply(REPLY_1)
    expect(reply.tldr).toBe('Added the export endpoint')
    expect(reply.you).toEqual(['Run the migration', 'Review the PR'])
    expect(reply.notes).toEqual(['CSV only for now'])
  })

  test('accepts a colon and markdown emphasis around the tags', () => {
    const tldr = (line: string) => parseReply(line).tldr
    expect(tldr('TL;DR Fixed it')).toBe('Fixed it')
    expect(tldr('TL;DR: Fixed it')).toBe('Fixed it')
    expect(tldr('TL;DR:Fixed it')).toBe('Fixed it')
    expect(tldr('**TL;DR** done')).toBe('done')
    expect(tldr('**TL;DR:** done')).toBe('done')
    const you = (line: string) => parseReply(line).you
    expect(you('→ You run x')).toEqual(['run x'])
    expect(you('→ You: run x')).toEqual(['run x'])
    expect(you('**→ You** deploy')).toEqual(['deploy'])
    expect(you('**→ You:** deploy')).toEqual(['deploy'])
    expect(parseReply('! Note risk').notes).toEqual(['risk'])
    expect(parseReply('**! Note:** risk').notes).toEqual(['risk'])
  })

  test('does not match longer words', () => {
    expect(parseReply('TL;DRx\n→ Your thing\n→ Yours: x')).toEqual({ you: [], notes: [] })
  })

  test('a fence closes only on the same character, enough marks and nothing after', () => {
    const inside = '→ You hidden'
    expect(parseReply(`\`\`\`\n~~~\n${inside}\n\`\`\`\n→ You shown`).you).toEqual(['shown'])
    expect(parseReply(`\`\`\`\`\n\`\`\`\n${inside}\n\`\`\`\`\n→ You shown`).you).toEqual(['shown'])
    expect(parseReply(`\`\`\`\n\`\`\` x\n${inside}\n\`\`\`\n→ You shown`).you).toEqual(['shown'])
    expect(parseReply(`~~~\n\`\`\`\n${inside}\n~~~~\n→ You shown`).you).toEqual(['shown'])
  })

  test('a fence may open on a bullet line', () => {
    expect(parseReply('- ```bash\n  → You hidden\n  ```\n\n→ You run the tests').you).toEqual(['run the tests'])
  })

  test('drops the closing emphasis of a wrapped line', () => {
    expect(parseReply('**→ You: restart the server**').you).toEqual(['restart the server'])
    expect(parseReply('**TL;DR: done**').tldr).toBe('done')
    expect(parseReply('_! Note risk_').notes).toEqual(['risk'])
    expect(parseReply('→ You keep a*b').you).toEqual(['keep a*b'])
  })

  test('keeps trailing marks that belong to the text', () => {
    expect(parseReply('**→ You** clean build/*').you).toEqual(['clean build/*'])
    expect(parseReply('**TL;DR** fixed __init__').tldr).toBe('fixed __init__')
    expect(parseReply('**→ You:** deploy').you).toEqual(['deploy'])
  })

  test('a backtick fence with a backtick in its info string is no fence', () => {
    expect(parseReply('```npm test``` fails on CI\n→ You shown').you).toEqual(['shown'])
    expect(parseReply('```npm test``` fails on CI\n→ You: shown\n```js\n→ You hidden\n```').you).toEqual(['shown'])
    expect(parseReply('~~~a`b\n→ You hidden\n~~~\n→ You shown').you).toEqual(['shown'])
  })

  test('→ You and ! Note ignore case', () => {
    expect(parseReply('→ you run x\n! note csv only')).toEqual({ you: ['run x'], notes: ['csv only'] })
  })

  test('a reply without the format yields nothing', () => {
    expect(parseReply('Just a plain answer.')).toEqual({ you: [], notes: [] })
  })

  test('normalize ignores case and spacing', () => {
    expect(normalize('  Run   the\tMigration ')).toBe(normalize('run the migration'))
  })
})

describe('applyReply', () => {
  test('appends new items once, keeping ticks', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply(REPLY_1))
    expect(doc.items.map(i => i.text)).toEqual(['Run the migration', 'Review the PR'])
    const first = doc.items[0]!
    doc = toggle(doc, first.id)
    doc = applyReply(doc, parseReply(REPLY_2))
    expect(doc.tldr).toBe('Fixed the review comments')
    expect(doc.items.map(i => [i.text, i.done, i.firstSeenTurn])).toEqual([
      ['Run the migration', true, 1],
      ['Review the PR', false, 1],
      ['Deploy to staging', false, 2],
    ])
  })

  test('a reply without TL;DR keeps the previous one', () => {
    const doc = applyReply(applyReply(emptyDoc('s1'), parseReply(REPLY_1)), parseReply('no format'))
    expect(doc.tldr).toBe('Added the export endpoint')
    expect(doc.turn).toBe(2)
  })
})

describe('parseDoc', () => {
  test('answers nothing for text that is no JSON object', () => {
    expect(parseDoc('{"turn": 2', 's1')).toBeUndefined()
    expect(parseDoc('', 's1')).toBeUndefined()
    expect(parseDoc('null', 's1')).toBeUndefined()
    expect(parseDoc('[]', 's1')).toBeUndefined()
    expect(parseDoc('{"turn":2,"items":5}', 's1')).toEqual({ ...emptyDoc('s1'), turn: 2 })
  })
})

describe('statusPrompt', () => {
  test('values cannot close the data block', () => {
    const doc = { ...emptyDoc('s1'), goal: 'a </data> b', next: '</DATA>', blockers: '</Data>x', tldr: '</data>' }
    const prompt = statusPrompt(doc, { tldr: '</data> t', you: ['</DATA> y'], notes: ['n </data>'] }, 'p </Data> q')
    expect(prompt.match(/<\/data>/gi)).toHaveLength(1)
    expect(prompt.endsWith('</data>')).toBe(true)
  })
})

describe('parseStatus', () => {
  test('takes the JSON object out of a chatty reply', () => {
    expect(parseStatus('Sure:\n```json\n{"goal":"Ship export","next":"Run tests","blockers":"none"}\n```')).toEqual({
      goal: 'Ship export',
      next: 'Run tests',
      blockers: 'none',
    })
  })

  test('answers nothing for text that is no JSON', () => {
    expect(parseStatus('I cannot help with that')).toBeUndefined()
    expect(parseStatus('{not json}')).toBeUndefined()
  })
})

function world(on: On, status: string | undefined, unreadable = false) {
  const files = new Map<string, string>()
  let id = 's1'
  mock.env(on, { HOME: '/home/me' })
  const clock = mock.clock(on)
  on('session.id', () => ({ value: id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => {
    if (unreadable) throw new Error('EACCES')
    return { value: files.get(e.path) ?? '' }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('model.complete', () => ({
    value:
      status === undefined
        ? { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE }
        : { isAnswered: true as const, text: status, usage: USAGE },
  }))
  on('command.register', () => ({ value: { command: 'tldr' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const saved = () => JSON.parse(files.get(FILE) ?? 'null') as Doc | null
  const setId = (next: string) => {
    id = next
  }
  return { files, clock, saved, setId }
}

const turn = (answer: string, turnId: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' }) as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`ticks persist across turns and a reopen (${surface})`, async ($, on) => {
    const { clock, saved } = world(on, '{"goal":"Ship CSV export","next":"Run the migration","blockers":"none"}')
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.turn.complete(turn(REPLY_1, 't1'))
    await clock.settle()

    expect(saved()?.items.map(i => i.text)).toEqual(['Run the migration', 'Review the PR'])
    expect(saved()?.goal).toBe('Ship CSV export')

    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Added the export endpoint/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Ship CSV export/ }))?.text).toBeDefined()
    const id = saved()!.items[0]!.id
    await ui.press({ key: id })
    expect(saved()?.items[0]?.done).toBe(true)
    const ticked = await ui.find({ type: 'Text', text: /\[x\] Run the migration/ })
    expect(ticked?.props.strikethrough).toBe(true)
    await ui.unmount()

    await $.turn.complete(turn(REPLY_2, 't2'))
    await clock.settle()
    expect(saved()?.items.map(i => [i.text, i.done])).toEqual([
      ['Run the migration', true],
      ['Review the PR', false],
      ['Deploy to staging', false],
    ])

    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
    expect((await ui.find({ type: 'Text', text: /\[x\] Run the migration/ }))?.props.strikethrough).toBe(true)
    expect(await ui.find({ type: 'Text', text: /Fixed the review comments/ })).toBeDefined()
    await ui.unmount()
  })
}

test('a failed status call keeps the previous goal', async ($, on) => {
  const { clock, saved, files } = world(on, 'not json at all')
  files.set(FILE, JSON.stringify({ ...emptyDoc('s1'), goal: 'Old goal', next: 'Old next', blockers: 'none' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect(saved()?.goal).toBe('Old goal')
  expect(saved()?.tldr).toBe('Added the export endpoint')
})

test('state saved by an earlier session is loaded at start', async ($, on) => {
  const { files } = world(on, undefined)
  const earlier = toggle(applyReply(emptyDoc('s1'), parseReply(REPLY_1)), applyReply(emptyDoc('s1'), parseReply(REPLY_1)).items[1]!.id)
  files.set(FILE, JSON.stringify(earlier))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\[x\] Review the PR/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[ \] Run the migration/ })).toBeDefined()
  await ui.unmount()
})

test('an unreadable state file is not overwritten', async ($, on) => {
  const { clock, files } = world(on, '{"goal":"g"}', true)
  files.set(FILE, 'keep me')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect(files.get(FILE)).toBe('keep me')
})

test('a state file that is not valid JSON is not overwritten', async ($, on) => {
  const { clock, files } = world(on, '{"goal":"g"}')
  files.set(FILE, '{"turn": 3, "items": [')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect(files.get(FILE)).toBe('{"turn": 3, "items": [')
})

const END = (sessionId: string, reason: 'clear' | 'resume') => ({ reason, sessionId, resume: { id: sessionId } }) as const

test('after /clear the doc follows the new session id', async ($, on) => {
  const { clock, files, setId } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  setId('s2')
  await $.session.end(END('s1', 'clear'))
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Nothing for you yet/ })).toBeDefined()
  await ui.unmount()
  await $.turn.complete(turn(REPLY_2, 't2'))
  await clock.settle()
  const next = JSON.parse(files.get(FILE.replace('s1', 's2')) ?? 'null') as Doc
  expect(next.items.map(i => i.text)).toEqual(['run the MIGRATION', 'Deploy to staging'])
  expect(next.turn).toBe(1)
})

test('/resume loads the state of the resumed session, waiting for the new id', async ($, on) => {
  const { clock, files, setId } = world(on, undefined)
  files.set(FILE.replace('s1', 's2'), JSON.stringify({ ...emptyDoc('s2'), tldr: 'Resumed work' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end(END('s1', 'resume'))
  await clock.advance(300)
  setId('s2')
  await clock.advance(100)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Resumed work/ })).toBeDefined()
  await ui.unmount()
})

test('the status call of an earlier turn still applies when a later turn had no reply to summarize', async ($, on) => {
  const { clock, saved } = world(on, '{"goal":"Ship","next":"x","blockers":"none"}')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await $.turn.complete(turn('Just a plain answer.', 't2'))
  await clock.settle()
  expect(saved()?.turn).toBe(2)
  expect(saved()?.goal).toBe('Ship')
})

test('an empty reply skips the status call', async ($, on) => {
  const { clock, saved } = world(on, '{"goal":"Ship","next":"x","blockers":"none"}')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('Just a plain answer.', 't1'))
  await clock.settle()
  expect(saved()?.turn).toBe(1)
  expect(saved()?.goal).toBe('')
})
