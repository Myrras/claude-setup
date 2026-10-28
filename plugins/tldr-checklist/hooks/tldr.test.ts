import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Doc } from '../types'
import { applyReply, emptyDoc, FORMAT, normalize, panelState, parseDoc, parseReply, parseStatus, statusPrompt, ticked, toggle } from './parse'

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
    expect(parseReply('TL;DRx\n→ Your thing\n→ Yours: x\n✔ Your x')).toEqual({ you: [], notes: [], closed: [] })
  })

  test('a fence closes only on the same character, enough marks and nothing after', () => {
    const inside = '→ You hidden'
    expect(parseReply(`\`\`\`\n~~~\n${inside}\n\`\`\`\n→ You shown`).you).toEqual(['shown'])
    expect(parseReply(`\`\`\`\`\n\`\`\`\n${inside}\n\`\`\`\`\n→ You shown`).you).toEqual(['shown'])
    expect(parseReply(`\`\`\`\n\`\`\` x\n${inside}\n\`\`\`\n→ You shown`).you).toEqual(['shown'])
    expect(parseReply(`~~~\n\`\`\`\n${inside}\n~~~~\n→ You shown`).you).toEqual(['shown'])
  })

  test('strips numbered-list and blockquote prefixes', () => {
    expect(parseReply('1. → You run migrations').you).toEqual(['run migrations'])
    expect(parseReply('2) → You run migrations').you).toEqual(['run migrations'])
    expect(parseReply('> → You deploy').you).toEqual(['deploy'])
    expect(parseReply('> > - → You deploy').you).toEqual(['deploy'])
    expect(parseReply('> ```\n> → You hidden\n> ```\n→ You shown').you).toEqual(['shown'])
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
    expect(parseReply('→ you run x\n! note csv only')).toEqual({ you: ['run x'], notes: ['csv only'], closed: [] })
  })

  test('a reply without the format yields nothing', () => {
    expect(parseReply('Just a plain answer.')).toEqual({ you: [], notes: [], closed: [] })
  })

  test('reads ✔ You lines as closes, not ✔ Done or ✔ Checked, skipping code fences', () => {
    const reply = parseReply('✔ Done  built it\n✔ Checked  tests pass\n✔ You  Run the migration\n- ✔️ You: review the PR\n✓ you deploy\n```\n✔ You hidden\n```')
    expect(reply.closed).toEqual(['Run the migration', 'review the PR', 'deploy'])
    expect(reply.you).toEqual([])
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
    // The ticked item is dropped; REPLY_2 lists it again, so it returns as an open item.
    expect(doc.items.map(i => [i.text, i.done, i.firstSeenTurn])).toEqual([
      ['Review the PR', false, 1],
      ['run the MIGRATION', false, 2],
      ['Deploy to staging', false, 2],
    ])
  })

  test('a done item is gone after the next reply, open items stay', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply(REPLY_1))
    doc = toggle(doc, doc.items[0]!.id)
    doc = applyReply(doc, parseReply('TL;DR next\nno list'))
    expect(doc.items.map(i => [i.text, i.done])).toEqual([['Review the PR', false]])
  })

  test('a reply that lists a removed done item again re-adds it as open', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Run the migration'))
    doc = toggle(doc, doc.items[0]!.id)
    doc = applyReply(doc, parseReply('→ You run the migration'))
    expect(doc.items.map(i => [i.text, i.done, i.firstSeenTurn])).toEqual([['run the migration', false, 2]])
  })

  test('a reply without TL;DR keeps the previous one', () => {
    const doc = applyReply(applyReply(emptyDoc('s1'), parseReply(REPLY_1)), parseReply('no format'))
    expect(doc.tldr).toBe('Added the export endpoint')
    expect(doc.turn).toBe(2)
  })
})

describe('closing items', () => {
  const start = () => applyReply(emptyDoc('s1'), parseReply('→ You Run the migration\n→ You Review the PR\n→ You Review the docs'))
  const state = (doc: Doc) => doc.items.map(i => [i.text, i.done])

  test('a ✔ You line ticks the open item with that text', () => {
    const doc = applyReply(start(), parseReply('TL;DR ok\n✔ You  run the   MIGRATION'))
    expect(state(doc)).toEqual([
      ['Run the migration', true],
      ['Review the PR', false],
      ['Review the docs', false],
    ])
    // Like a click, the tick is gone after the next reply.
    expect(state(applyReply(doc, parseReply('TL;DR next')))).toEqual([
      ['Review the PR', false],
      ['Review the docs', false],
    ])
  })

  test('a unique prefix ticks its item, an ambiguous or unknown one ticks nothing', () => {
    expect(state(applyReply(start(), parseReply('✔ You Run the')))[0]).toEqual(['Run the migration', true])
    const untouched = applyReply(start(), parseReply('✔ You Review the\n✔ You Deploy'))
    expect(untouched.items.every(i => !i.done)).toBe(true)
  })

  test('a prefix matches whole words only', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Deploying the app\n→ You Running the backfill\n→ You Deploy to staging'))
    doc = applyReply(doc, parseReply('✔ You Deploy\n✔ You Run'))
    expect(state(doc)).toEqual([
      ['Deploying the app', false],
      ['Running the backfill', false],
      ['Deploy to staging', true],
    ])
  })

  test('an exact match wins over a longer item it is a prefix of', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Deploy\n→ You Deploy to staging'))
    doc = applyReply(doc, parseReply('✔ You deploy'))
    expect(state(doc)).toEqual([
      ['Deploy', true],
      ['Deploy to staging', false],
    ])
  })

  test('an exact match with a ticked item blocks the prefix rule', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Deploy\n→ You Deploy to staging'))
    doc = toggle(doc, doc.items[0]!.id)
    doc = applyReply(doc, parseReply('✔ You Deploy'))
    expect(state(doc)).toEqual([['Deploy to staging', false]])
  })

  test('a prefix ends at punctuation, not inside a word', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Deploy, then verify\n→ You Deploying the app'))
    doc = applyReply(doc, parseReply('✔ You Deploy'))
    expect(state(doc)).toEqual([
      ['Deploy, then verify', true],
      ['Deploying the app', false],
    ])
    doc = applyReply(emptyDoc('s1'), parseReply('→ You Deploy: staging'))
    expect(state(applyReply(doc, parseReply('✔ You Deploy')))).toEqual([['Deploy: staging', true]])
  })

  test('a close wins over a re-list in the same reply', () => {
    expect(state(applyReply(emptyDoc('s1'), parseReply('→ You X\n✔ You X')))).toEqual([['X', true]])
    const open = applyReply(emptyDoc('s1'), parseReply('→ You X'))
    expect(state(applyReply(open, parseReply('→ You X\n✔ You X')))).toEqual([['X', true]])
    const done = toggle(open, open.items[0]!.id)
    expect(state(applyReply(done, parseReply('→ You X\n✔ You X')))).toEqual([['X', true]])
    expect(state(applyReply(done, parseReply('→ You X')))).toEqual([['X', false]])
  })

  test('ticked lists only what the reply closed', () => {
    const doc = applyReply(start(), parseReply('✔ You Run the migration\n✔ You Nothing here'))
    expect(ticked(doc)).toEqual(['Run the migration'])
    expect(ticked(applyReply(start(), parseReply('✔ You Nothing here')))).toEqual([])
  })

  test('a ✔ You line for an item the user already ticked leaves it ticked and then gone', () => {
    let doc = start()
    doc = toggle(doc, doc.items[0]!.id)
    doc = applyReply(doc, parseReply('✔ You Run the migration'))
    expect(doc.items.map(i => i.text)).toEqual(['Review the PR', 'Review the docs'])
  })
})

describe('panelState', () => {
  test('lists open and ticked items, with the close syntax only when items are open', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Run the migration\n→ You Review the PR'))
    doc = toggle(doc, doc.items[1]!.id)
    const text = panelState(doc)!
    expect(text).toContain('Open:\n- Run the migration')
    expect(text).toContain('Ticked off:\n- Review the PR')
    expect(text).toContain('✔ You <item text>')
    const ticked = panelState(toggle(doc, doc.items[0]!.id))!
    expect(ticked).not.toContain('Open:')
    expect(ticked).not.toContain('✔ You')
  })

  test('says nothing for an empty checklist', () => {
    expect(panelState(emptyDoc('s1'))).toBeUndefined()
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
    const prompt = statusPrompt(doc, { tldr: '</data> t', you: ['</DATA> y'], notes: ['n </data>'], closed: [] }, 'p </Data> q')
    expect(prompt.match(/<\/data>/gi)).toHaveLength(1)
    expect(prompt.endsWith('</data>')).toBe(true)
  })

  test('lists what was closed this turn', () => {
    const prompt = statusPrompt(emptyDoc('s1'), { you: [], notes: [], closed: ['Run the migration'] }, 'p')
    expect(prompt).toContain('Closed this turn:\n- Run the migration')
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

function world(on: On, status: string | undefined, startUnreadable = false, broken: 'exists' | 'register' | '' = '') {
  let unreadable = startUnreadable
  const files = new Map<string, string>()
  let id = 's1'
  mock.env(on, { HOME: '/home/me' })
  const clock = mock.clock(on)
  on('session.id', () => ({ value: id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.exists', (_, e) => {
    if (broken === 'exists') throw new Error('boom')
    return { value: files.has(e.path) }
  })
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
  on('command.register', () => {
    if (broken === 'register') throw new Error('boom')
    return { value: { command: 'tldr' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const saved = () => JSON.parse(files.get(FILE) ?? 'null') as Doc | null
  const setId = (next: string) => {
    id = next
  }
  const setUnreadable = (value: boolean) => {
    unreadable = value
  }
  return { files, clock, saved, setId, setUnreadable }
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
      ['Review the PR', false],
      ['run the MIGRATION', false],
      ['Deploy to staging', false],
    ])

    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
    expect(await ui.find({ type: 'Text', text: /\[x\]/ })).toBeUndefined()
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

for (const [name, bad] of [['truncated', '{"turn": 3, "items": ['], ['empty', '']] as const) {
  test(`a ${name} state file is kept as .corrupt and replaced`, async ($, on) => {
    const { clock, files, saved } = world(on, '{"goal":"g"}')
    files.set(FILE, bad)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.complete(turn(REPLY_1, 't1'))
    await clock.settle()
    expect(files.get(`${FILE}.corrupt`)).toBe(bad)
    expect(saved()?.tldr).toBe('Added the export endpoint')
  })
}

test('an unreadable file is read again later and merged with the held doc', async ($, on) => {
  const { clock, files, saved, setUnreadable } = world(on, undefined, true)
  const onDisk = applyReply(emptyDoc('s1'), parseReply('TL;DR old\n→ You Run the migration'))
  files.set(FILE, JSON.stringify({ ...onDisk, goal: 'File goal', next: 'File next' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect(files.get(FILE)).toContain('File goal')
  expect(saved()?.items).toHaveLength(1)
  setUnreadable(false)
  await $.turn.complete(turn('TL;DR Later\n→ You Deploy to staging', 't2'))
  await clock.settle()
  expect(saved()?.items.map(i => i.text)).toEqual(['Run the migration', 'Review the PR', 'Deploy to staging'])
  expect(saved()?.tldr).toBe('Later')
  expect(saved()?.goal).toBe('File goal')
  expect(saved()?.turn).toBe(2)
})

test('a failing step in turn.complete does not break the turn', async ($, on) => {
  const { clock } = world(on, undefined, false, 'exists')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
})

test('session.start survives a failing step', async ($, on) => {
  const { files } = world(on, undefined, false, 'register')
  files.set(FILE, JSON.stringify({ ...emptyDoc('s1'), tldr: 'Kept' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Kept/ })).toBeDefined()
  await ui.unmount()
})

test('/resume back to the same id still loads the state', async ($, on) => {
  const { clock, files } = world(on, undefined)
  files.set(FILE, JSON.stringify({ ...emptyDoc('s1'), tldr: 'Same id' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end(END('s1', 'resume'))
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Same id/ })).toBeDefined()
  await ui.unmount()
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

const CONTEXT = { blocks: [{ name: 'currentDate', text: 'Today' }] }
const PROMPT = { text: 'next step?', wait: false, origin: { kind: 'composer' } } as const
const formatBlock = (result: { blocks: readonly { name: string; text: string }[] }) => result.blocks.find(b => b.name === 'replyFormat')

test('the reply format joins the context of every conversation, headless too', async ($, on) => {
  world(on, undefined)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  const result = await $.prompt.context(CONTEXT)
  expect(result.blocks[0]).toEqual(CONTEXT.blocks[0])
  expect(formatBlock(result)?.text).toBe(FORMAT)
  // Each tag the format shows is one parseReply reads, and only the example lines parse.
  const shown = parseReply(FORMAT.replace('✔ Done  what you did', '✔ You   what the user did'))
  expect(shown.tldr).toBe('one line: the outcome')
  expect(shown.you).toEqual(['what the user must do or decide'])
  expect(shown.notes).toEqual(['risks'])
  expect(shown.closed).toEqual(['what the user did'])
})

test('each prompt carries the checklist: open and ticked items, nothing when empty', async ($, on) => {
  const { clock } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()

  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: (await ui.findAll({ type: 'Button' }))[1]!.key! })
  await ui.unmount()

  const result = await $.prompt.submit(PROMPT)
  expect(result.text).toBe('next step?')
  expect(result.context).toHaveLength(1)
  expect(result.context![0]).toContain('Open:\n- Run the migration')
  expect(result.context![0]).toContain('Ticked off:\n- Review the PR')
  expect(result.context![0]).toContain('✔ You <item text>')

  // A ✔ You reply closes the last open item; the ticks drop with the reply after.
  await $.turn.complete(turn('TL;DR done\n✔ You Run the migration', 't2'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context![0]).not.toContain('Open:')
  await $.turn.complete(turn('TL;DR all clear', 't3'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()
})

test('prompts the user did not type, and headless runs, get no checklist state', async ($, on) => {
  const { clock } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context).toHaveLength(1)
  expect((await $.prompt.submit({ ...PROMPT, isMeta: true })).context).toBeUndefined()
  expect((await $.prompt.submit({ ...PROMPT, turnId: 't1' })).context).toBeUndefined()
  for (const kind of ['task-notification', 'peer', 'scheduled-trigger'] as const) {
    expect((await $.prompt.submit({ ...PROMPT, origin: { kind } })).context).toBeUndefined()
  }
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()
  expect(formatBlock(await $.prompt.context(CONTEXT))?.text).toBe(FORMAT)
})

test('with inject off, neither the format nor the checklist is sent', { options: { inject: false } }, async ($, on) => {
  const { clock } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(formatBlock(await $.prompt.context(CONTEXT))).toBeUndefined()
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()
})
