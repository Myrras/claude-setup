import type { On, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Doc } from '../types'
import type { Skipped } from './parse'
import { applyReply, applyTool, checkPrompt, emptyDoc, FORMAT, listText, mergeDocs, normalize, OPEN_CAP, panelState, parseDoc, parseReply, parseStatus, setReply, statusPrompt, ticked, toggle, withoutClosed } from './parse'

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
    expect(parseReply('TL;DRx\n→ Your thing\n→ Yours: x\n✔ Your x')).toEqual({ you: [], notes: [], closed: [], removed: [] })
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
    expect(parseReply('→ you run x\n! note csv only')).toEqual({ you: ['run x'], notes: ['csv only'], closed: [], removed: [] })
  })

  test('a reply without the format yields nothing', () => {
    expect(parseReply('Just a plain answer.')).toEqual({ you: [], notes: [], closed: [], removed: [] })
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

  const add = (doc: Doc, ...you: string[]) => applyReply(doc, { you, notes: [], closed: [], removed: [] })

  test('skips an exact duplicate of an open item', () => {
    const skipped: Skipped[] = []
    const doc = applyReply(add(emptyDoc('s1'), 'Run the migration'), { you: ['Run the migration'], notes: [], closed: [], removed: [] }, skipped)
    expect(doc.items).toHaveLength(1)
    expect(skipped).toEqual([{ text: 'Run the migration', of: 'Run the migration' }])
  })

  test('skips a whitespace, case and punctuation duplicate', () => {
    const doc = add(add(emptyDoc('s1'), 'Run the migration'), '  run   THE migration! ')
    expect(doc.items).toHaveLength(1)
  })

  test('skips a reworded duplicate', () => {
    const a = 'Say go to start slice 0 (contract), and whether I work in an isolated worktree'
    const b =
      'Say go to start slice 0 (the contract: item model, states, migration shape). Also say whether I should work in an isolated worktree. CLAUDE.md requires a branch and PR, never straight to main.'
    const skipped: Skipped[] = []
    const doc = applyReply(add(emptyDoc('s1'), a), { you: [b], notes: [], closed: [], removed: [] }, skipped)
    expect(doc.items.map(i => i.text)).toEqual([a])
    expect(skipped).toEqual([{ text: b, of: a }])
  })

  test('adds a genuinely different item', () => {
    const doc = add(add(emptyDoc('s1'), 'Run the migration'), 'Deploy to staging')
    expect(doc.items.map(i => i.text)).toEqual(['Run the migration', 'Deploy to staging'])
  })

  test('a ticked item does not block a reworded item, and a repeat re-adds it as open', () => {
    let doc = add(emptyDoc('s1'), 'Run the migration')
    doc = toggle(doc, doc.items[0]!.id)
    doc = add(doc, 'Run the migration', 'Run the migration on staging, then check the logs')
    expect(doc.items.map(i => [i.text, i.done])).toEqual([
      ['Run the migration', false],
      ['Run the migration on staging, then check the logs', false],
    ])
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

  test('close matching ignores code ticks, emphasis and trailing punctuation', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Run the migration\n→ You `npm run build`\n→ You Ship it'))
    doc = applyReply(doc, parseReply('✔ You Run the migration.\n✔ You npm run build\n✔ You **Ship it**!'))
    expect(state(doc).map(([, done]) => done)).toEqual([true, true, true])
  })

  test('a prefix is ambiguous over ticked items too, and ticks only an open one', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You Deploy to prod\n→ You Deploy to staging'))
    doc = toggle(doc, doc.items[0]!.id)
    expect(state(applyReply(doc, parseReply('✔ You Deploy')))).toEqual([['Deploy to staging', false]])
  })

  test('- and \' are word characters in a prefix', () => {
    const doc = applyReply(emptyDoc('s1'), parseReply("→ You Re-run the job\n→ You Don't merge yet\n→ You Don’t wait"))
    const after = applyReply(doc, parseReply('✔ You Re\n✔ You Don'))
    expect(after.items.every(i => !i.done)).toBe(true)
    expect(state(applyReply(doc, parseReply("✔ You Re-run")))[0]).toEqual(['Re-run the job', true])
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
    expect(text).toContain('Open:\n- 1-1 Run the migration')
    expect(text).toContain('Ticked by the user (read; not necessarily done):\n- 1-2 Review the PR')
    expect(text).toContain('close it with a line: ✔ You <number>')
    expect(text).toContain("If the user's prompt makes an open item premature or moot, remove it now with the checklist tool")
    const tagged = (line: string) => parseReply(line).you.length || parseReply(line).closed.length || parseReply(line).removed.length
    expect(text.split('\n').some(tagged)).toBe(false)
    const ticked = panelState(toggle(doc, doc.items[0]!.id))!
    expect(ticked).not.toContain('Open:')
    expect(ticked).not.toContain('✔ You')
    expect(ticked).not.toContain('checklist tool')
  })

  test('says nothing for an empty checklist', () => {
    expect(panelState(emptyDoc('s1'))).toBeUndefined()
  })
})

describe('item numbers', () => {
  const refs = (doc: Doc) => doc.items.map(i => [i.text, i.ref])

  test('each reply numbers its new items from 1; existing items keep theirs', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You A\n→ You B'))
    expect(refs(doc)).toEqual([
      ['A', '1-1'],
      ['B', '1-2'],
    ])
    doc = applyReply(doc, parseReply('→ You B\n→ You C\n→ You D'))
    expect(refs(doc)).toEqual([
      ['A', '1-1'],
      ['B', '1-2'],
      ['C', '2-1'],
      ['D', '2-2'],
    ])
  })

  test('numbers never shift when items drop; a re-added item gets a new one', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply('→ You A\n→ You B'))
    doc = toggle(doc, doc.items[0]!.id)
    doc = applyReply(doc, parseReply('→ You C'))
    expect(refs(doc)).toEqual([
      ['B', '1-2'],
      ['C', '2-1'],
    ])
    doc = applyReply(doc, parseReply('→ You A'))
    expect(refs(doc)).toEqual([
      ['B', '1-2'],
      ['C', '2-1'],
      ['A', '3-1'],
    ])
  })

  test('state without numbers loads with numbers from turn and order, skipping taken ones', () => {
    const old = (text: string, firstSeenTurn: number, extra = {}) => ({ id: text, text, done: false, firstSeenTurn, ...extra })
    const text = JSON.stringify({ ...emptyDoc('s1'), turn: 3, items: [old('A', 1), old('B', 2, { done: true }), old('C', 2), old('D', 2, { ref: '2-1' })] })
    expect(refs(parseDoc(text, 's1')!)).toEqual([
      ['A', '1-1'],
      ['B', '2-2'],
      ['C', '2-3'],
      ['D', '2-1'],
    ])
  })
})

describe('closing by number', () => {
  const start = () => applyReply(emptyDoc('s1'), parseReply('→ You Run the migration\n→ You Review the PR\n→ You Review the docs'))
  const done = (doc: Doc) => doc.items.filter(i => i.done).map(i => i.ref)

  test('✔ You <number> ticks the item with that number, text after it or not', () => {
    expect(done(applyReply(start(), parseReply('✔ You 1-3')))).toEqual(['1-3'])
    expect(done(applyReply(start(), parseReply('✔ You 1-2 Review the PR')))).toEqual(['1-2'])
    expect(done(applyReply(start(), parseReply('✔ You: `1-2`.')))).toEqual(['1-2'])
    expect(done(applyReply(start(), parseReply('✔ You 1-1, 1-3')))).toEqual(['1-1', '1-3'])
  })

  test('an unknown number ticks nothing, and its text is not matched', () => {
    expect(done(applyReply(start(), parseReply('✔ You 9-9 Run the migration')))).toEqual([])
    expect(done(applyReply(start(), parseReply('✔ You 1-1-2')))).toEqual([])
  })

  test('numbers may be separated by spaces, and or &, start with # and use an en dash', () => {
    expect(done(applyReply(start(), parseReply('✔ You 1-1 1-3')))).toEqual(['1-1', '1-3'])
    expect(done(applyReply(start(), parseReply('✔ You 1-1 and 1-3')))).toEqual(['1-1', '1-3'])
    expect(done(applyReply(start(), parseReply('✔ You 1-1 & 1-3')))).toEqual(['1-1', '1-3'])
    expect(done(applyReply(start(), parseReply('✔ You #1-2')))).toEqual(['1-2'])
    expect(done(applyReply(start(), parseReply('✔ You 1–3')))).toEqual(['1-3'])
    expect(done(applyReply(start(), parseReply('✔ You #1–1, #1–2')))).toEqual(['1-1', '1-2'])
  })

  test('numbers that match no item fall back to the text', () => {
    const doc = applyReply(emptyDoc('s1'), parseReply('→ You 10-15 min downtime window\n→ You Other'))
    expect(doc.items[0]!.text).toBe('10-15 min downtime window')
    expect(done(applyReply(doc, parseReply('✔ You 10-15 min downtime window')))).toEqual(['1-1'])
    expect(done(applyReply(doc, parseReply('✔ You 10-15 min downtime')))).toEqual(['1-1'])
  })

  test('numbers that match an item tick by number only', () => {
    expect(done(applyReply(start(), parseReply('✔ You 1-2 9-9')))).toEqual(['1-2'])
  })

  test('a line without a leading number still matches by text', () => {
    expect(done(applyReply(start(), parseReply('✔ You Run the migration')))).toEqual(['1-1'])
  })

  test('✅ and ☑ close too, ✅ Done and ✅ Checked do not', () => {
    const reply = parseReply('✅ You A\n☑ You B\n☑️ You C\n✅️ You D\n✅ Done Run the migration\n✅ Checked Review the PR\n☑ Done x')
    expect(reply.closed).toEqual(['A', 'B', 'C', 'D'])
    expect(done(applyReply(start(), parseReply('✅ Done Run the migration\n✅ Checked 1-2')))).toEqual([])
    expect(done(applyReply(start(), parseReply('✅ You 1-1\n☑️ You Review the PR')))).toEqual(['1-1', '1-2'])
  })
})

describe('who ticked it', () => {
  const start = () => applyReply(emptyDoc('s1'), parseReply('→ You A\n→ You B\n→ You C'))

  test('a click ticks as the user and unticking clears it; a reply close ticks as the reply', () => {
    let doc = toggle(start(), start().items[0]!.id)
    expect(doc.items[0]?.tickedBy).toBe('user')
    doc = toggle(doc, doc.items[0]!.id)
    expect(doc.items[0]?.done).toBe(false)
    expect(doc.items[0]?.tickedBy).toBeUndefined()
    doc = applyReply(start(), parseReply('✔ You 1-2'))
    expect(doc.items[1]?.tickedBy).toBe('reply')
  })

  test('panelState lists user ticks and reply closes apart', () => {
    let doc = applyReply(start(), parseReply('✔ You 1-2'))
    const closedOnly = panelState(doc)!
    expect(closedOnly).toContain('Closed in your last reply:\n- 1-2 B')
    expect(closedOnly).not.toContain('Ticked by the user')
    expect(closedOnly).not.toContain('A user tick')
    doc = toggle(doc, doc.items[2]!.id)
    const text = panelState(doc)!
    expect(text).toContain('Open:\n- 1-1 A\n\n')
    expect(text).toContain('Ticked by the user (read; not necessarily done):\n- 1-3 C')
    expect(text).toContain('Closed in your last reply:\n- 1-2 B')
    expect(text).toContain('A user tick means read, not done')
    expect(text.split('\n').some(line => parseReply(line).you.length || parseReply(line).closed.length)).toBe(false)
  })
})

describe('open cap', () => {
  const items = (count: number, prefix: string) => Array.from({ length: count }, (_, i) => `→ You ${prefix} ${i + 1}`).join('\n')
  const openLines = (text: string) => text.split('Open:\n')[1]!.split('\n\n')[0]!.split('\n')

  test(`sends the ${OPEN_CAP} newest open items and says how many are left out`, () => {
    let doc = applyReply(emptyDoc('s1'), parseReply(items(10, 'Early')))
    doc = applyReply(doc, parseReply(items(1, 'Late')))
    const text = panelState(doc)!
    expect(openLines(text)).toHaveLength(OPEN_CAP)
    expect(openLines(text)[0]).toBe('- 1-2 Early 2')
    expect(openLines(text).at(-2)).toBe('- 1-10 Early 10')
    expect(openLines(text).at(-1)).toBe('- 2-1 Late 1')
    expect(text).toContain('1 older open item not shown; ask the user to tick off what is done, or close one with ✔ You <item text>.')
    expect(doc.items).toHaveLength(11)
  })

  test(`${OPEN_CAP} open items are all sent`, () => {
    const text = panelState(applyReply(emptyDoc('s1'), parseReply(items(10, 'Item'))))!
    expect(openLines(text)).toHaveLength(OPEN_CAP)
    expect(text).not.toContain('not shown')
  })
})

describe('re-listed with a number', () => {
  const start = () => applyReply(emptyDoc('s1'), parseReply('→ You Run the migration\n→ You Review the PR'))

  test('an open item listed again with its number is not added again', () => {
    for (const line of ['1-2 Review the PR', '#1-2 Review the PR', '1–2 Review the PR']) {
      const doc = applyReply(start(), parseReply(`→ You ${line}`))
      expect(doc.items.map(i => i.ref + ' ' + i.text)).toEqual(['1-1 Run the migration', '1-2 Review the PR'])
    }
  })

  test('a ticked item listed again with its number comes back open, without the number in its text', () => {
    const doc = applyReply(applyReply(start(), parseReply('✔ You 1-2')), parseReply('→ You 1-2 Review the PR'))
    expect(doc.items.map(i => i.ref + ' ' + i.text + ' ' + i.done)).toEqual(['1-1 Run the migration false', '3-1 Review the PR false'])
  })
})

describe('re-listed with an old number', () => {
  const start = () => applyReply(emptyDoc('s1'), parseReply('→ You Merge the PR\n→ You Review the PR'))

  test('a number withdrawn in the same reply is dropped from the text', () => {
    const doc = applyReply(start(), parseReply('✖ You 1-1\n→ You 1-1 Merge the PR'))
    expect(doc.items.map(i => i.ref + ' ' + i.text)).toEqual(['1-2 Review the PR', '2-1 Merge the PR'])
  })

  test('a number removed with the tool earlier is dropped from the text', () => {
    const removed = applyTool(start(), { action: 'remove', ref: '1-1' })
    if (!('doc' in removed)) throw new Error(removed.error)
    const doc = applyReply(removed.doc, parseReply('→ You 1-1 Merge the PR'))
    expect(doc.items.map(i => i.ref + ' ' + i.text)).toEqual(['1-2 Review the PR', '2-1 Merge the PR'])
  })

  test('a number that was never handed out stays in the text', () => {
    const doc = applyReply(start(), parseReply('→ You 10-15 min downtime window'))
    expect(doc.items.map(i => i.text)).toEqual(['Merge the PR', 'Review the PR', '10-15 min downtime window'])
  })
})

describe('checklist tool', () => {
  const refs = (doc: Doc) => doc.items.map(i => [i.ref, i.text, i.done])
  const run = (doc: Doc, input: Parameters<typeof applyTool>[1]) => {
    const result = applyTool(doc, input)
    if (!('doc' in result)) throw new Error(result.error)
    return result.doc
  }
  const start = () => applyReply(emptyDoc('s1'), parseReply('→ You Merge the PR\n→ You Review the docs'))

  test('ref accepts several numbers in one string', () => {
    const base = start()
    for (const ref of ['1-1, 1-2', '1-1 and 1-2', '#1-1 & #1-2', '1–1 1–2', ['#1-1', '1-2']]) {
      expect(run(base, { action: 'close', ref }).items.map(i => i.done)).toEqual([true, true])
    }
    expect(applyTool(base, { action: 'remove', ref: 'soon' })).toEqual({ error: 'Unknown item number: soon. Nothing changed.' })
  })

  test('list answers ref, state and text, open items first', () => {
    let doc = run(start(), { action: 'close', ref: '1-1' })
    doc = toggle(doc, doc.items[1]!.id)
    doc = run(doc, { action: 'add', text: 'Deploy' })
    expect(listText(doc)).toBe('2-1 [open] Deploy\n1-1 [done] Merge the PR\n1-2 [read] Review the docs\nread = ticked by the user, not necessarily done.')
    expect(listText(emptyDoc('s1'))).toBe('The checklist is empty.')
    expect(run(doc, { action: 'list' })).toBe(doc)
  })

  test('add numbers in the reply in progress, deduped like a → You line', () => {
    const doc = run(start(), { action: 'add', text: ['Deploy', 'merge the  pr', 'Deploy', ' '] })
    expect(refs(doc)).toEqual([
      ['1-1', 'Merge the PR', false],
      ['1-2', 'Review the docs', false],
      ['2-1', 'Deploy', false],
    ])
    expect(applyTool(start(), { action: 'add', text: [] })).toEqual({ error: 'add needs text.' })
  })

  test('a → You line later in the same reply numbers after the tool', () => {
    let doc = run(start(), { action: 'add', text: 'Deploy' })
    doc = run(doc, { action: 'add', text: 'Tag it' })
    doc = applyReply(doc, parseReply('→ You Announce it\n→ You Deploy'))
    expect(refs(doc).slice(2)).toEqual([
      ['2-1', 'Deploy', false],
      ['2-2', 'Tag it', false],
      ['2-3', 'Announce it', false],
    ])
    expect(doc.turn).toBe(2)
  })

  test('close ticks as the reply; the item stays until the reply after this one', () => {
    let doc = run(start(), { action: 'close', ref: ['#1-1', '1–2'] })
    expect(doc.items.map(i => [i.ref, i.done, i.tickedBy])).toEqual([
      ['1-1', true, 'reply'],
      ['1-2', true, 'reply'],
    ])
    doc = applyReply(doc, parseReply('TL;DR ok'))
    expect(doc.items.map(i => i.ref)).toEqual(['1-1', '1-2'])
    expect(panelState(doc)).toContain('Closed in your last reply:\n- 1-1 Merge the PR')
    doc = applyReply(doc, parseReply('TL;DR ok'))
    expect(doc.items).toEqual([])
  })

  test('remove deletes the item; adding it again gives a new number', () => {
    let doc = run(start(), { action: 'remove', ref: '1-1' })
    expect(refs(doc)).toEqual([['1-2', 'Review the docs', false]])
    doc = run(doc, { action: 'add', text: 'Deploy' })
    doc = run(doc, { action: 'remove', ref: '2-1' })
    doc = run(doc, { action: 'add', text: ['Deploy', 'Merge the PR'] })
    expect(refs(doc)).toEqual([
      ['1-2', 'Review the docs', false],
      ['2-2', 'Deploy', false],
      ['2-3', 'Merge the PR', false],
    ])
    // The reply that ends this turn numbers after the removed one too.
    doc = run(doc, { action: 'remove', ref: ['2-2', '2-3'] })
    doc = applyReply(doc, parseReply('→ You Deploy'))
    expect(refs(doc)).toEqual([
      ['1-2', 'Review the docs', false],
      ['2-4', 'Deploy', false],
    ])
  })

  test('the last number handed out survives a reload', () => {
    const doc = run(run(start(), { action: 'add', text: 'Deploy' }), { action: 'remove', ref: '2-1' })
    const loaded = parseDoc(JSON.stringify(doc), 's1')!
    expect(loaded.lastRef).toBe('2-1')
    expect(refs(run(loaded, { action: 'add', text: 'Deploy' })).pop()).toEqual(['2-2', 'Deploy', false])
  })

  test('adding the text of a done item brings it back open, one item per id', () => {
    const doc = run(run(start(), { action: 'close', ref: '1-1' }), { action: 'add', text: 'Merge the PR' })
    expect(refs(doc)).toEqual([
      ['1-2', 'Review the docs', false],
      ['2-1', 'Merge the PR', false],
    ])
  })

  test('unknown numbers and actions change nothing and say so', () => {
    expect(applyTool(start(), { action: 'close', ref: ['1-1', '9-9', 'x'] })).toEqual({ error: 'Unknown item numbers: 9-9, x. Nothing changed.' })
    expect(applyTool(start(), { action: 'remove', ref: '3-1' })).toEqual({ error: 'Unknown item number: 3-1. Nothing changed.' })
    expect(applyTool(start(), { action: 'remove' })).toEqual({ error: 'remove needs ref.' })
    expect(applyTool(start(), { action: 'drop' })).toEqual({ error: 'action must be list, add, close or remove.' })
  })
})

describe('removing items in a reply', () => {
  const start = () => applyReply(emptyDoc('s1'), parseReply('→ You Merge the PR\n→ You Review the docs'))

  test('✖ You <number> removes the item; ✗ and ❌ too, ✖ Done does not', () => {
    expect(parseReply('✖ You 1-1\n- ✗ You: 1-2\n❌️ you 2-1\n✖ Done x\n```\n✖ You 3-1\n```').removed).toEqual(['1-1', '1-2', '2-1'])
    expect(applyReply(start(), parseReply('✖ You 1-1')).items.map(i => i.ref)).toEqual(['1-2'])
    expect(applyReply(start(), parseReply('✖ You #1-1 and 1–2')).items).toEqual([])
    expect(applyReply(start(), parseReply('✖ Done 1-1')).items.map(i => i.ref)).toEqual(['1-1', '1-2'])
  })

  test('removal is by number only, never by text', () => {
    expect(applyReply(start(), parseReply('✖ You Merge the PR')).items.map(i => i.ref)).toEqual(['1-1', '1-2'])
  })

  test('the same reply may list a removed item again, as a new item', () => {
    const doc = applyReply(start(), parseReply('✖ You 1-1\n→ You Merge the PR'))
    expect(doc.items.map(i => [i.ref, i.text])).toEqual([
      ['1-2', 'Review the docs'],
      ['2-1', 'Merge the PR'],
    ])
  })
})

describe('mergeDocs', () => {
  const item = (text: string, ref: string) => ({ id: text, text, done: false, firstSeenTurn: Number(ref[0]), ref })
  const file = { ...emptyDoc('s1'), turn: 2, items: [item('A', '1-1'), item('B', '2-1')] }

  test('renumbers held items that collide, after both turns', () => {
    const held = { ...emptyDoc('s1'), turn: 3, items: [item('C', '1-1'), item('D', '3-1'), item('E', '2-1')] }
    const merged = mergeDocs(file, held)
    expect(merged.items.map(i => `${i.ref} ${i.text}`)).toEqual(['1-1 A', '2-1 B', '4-1 C', '3-1 D', '4-2 E'])
    expect(merged.turn).toBe(4)
  })

  test('keeps the later last number, never reusing it', () => {
    const held = { ...emptyDoc('s1'), turn: 4, lastRef: '5-1', items: [] }
    const merged = mergeDocs({ ...file, lastRef: '2-1' }, held)
    expect(merged.lastRef).toBe('5-1')
    expect(applyTool(merged, { action: 'add', text: 'New' })).toMatchObject({ doc: { items: [{}, {}, { ref: '5-2' }] } })
    expect(mergeDocs({ ...file, lastRef: '6-2' }, held).lastRef).toBe('6-2')
  })

  test('keeps numbers and turn when nothing collides, and drops items the file has', () => {
    const held = { ...emptyDoc('s1'), turn: 1, items: [item('A', '1-1'), item('C', '2-2')] }
    const merged = mergeDocs(file, held)
    expect(merged.items.map(i => `${i.ref} ${i.text}`)).toEqual(['1-1 A', '2-1 B', '2-2 C'])
    expect(merged.turn).toBe(2)
  })
})

describe('parseDoc', () => {
  test('turn covers the highest item number', () => {
    const items = [{ id: 'a', text: 'A', done: false, firstSeenTurn: 5, ref: '5-1' }]
    expect(parseDoc(JSON.stringify({ turn: 2, items }), 's1')!.turn).toBe(5)
    expect(parseDoc(JSON.stringify({ turn: 7, items }), 's1')!.turn).toBe(7)
  })

  test('a ref that is no number is derived again', () => {
    const base = { text: 'A', done: false, firstSeenTurn: 2 }
    const items = [{ ...base, id: 'a', ref: 'x' }, { ...base, id: 'b', ref: 5 }, { ...base, id: 'c', ref: '2-1' }, { ...base, id: 'd', ref: '2-1-3' }]
    expect(parseDoc(JSON.stringify({ turn: 2, items }), 's1')!.items.map(i => i.ref)).toEqual(['2-2', '2-3', '2-1', '2-4'])
  })


  test('answers nothing for text that is no JSON object', () => {
    expect(parseDoc('{"turn": 2', 's1')).toBeUndefined()
    expect(parseDoc('', 's1')).toBeUndefined()
    expect(parseDoc('null', 's1')).toBeUndefined()
    expect(parseDoc('[]', 's1')).toBeUndefined()
    expect(parseDoc('{"turn":2,"items":5}', 's1')).toEqual({ ...emptyDoc('s1'), turn: 2 })
  })
})

describe('closes', () => {
  test('prefix matches count per item, not per close key', () => {
    const doc = applyReply(emptyDoc('s1'), parseReply('→ You Run tests\n→ You Run `tests`.\n✔ You Run'))
    expect(doc.items).toHaveLength(2)
    expect(ticked(doc)).toEqual([])
  })
})

describe('statusPrompt', () => {
  test('values cannot close the data block', () => {
    const doc = { ...emptyDoc('s1'), goal: 'a </data> b', next: '</DATA>', blockers: '</Data>x', tldr: '</data>' }
    const prompt = statusPrompt(doc, { tldr: '</data> t', you: ['</DATA> y'], notes: ['n </data>'], closed: [], removed: [] }, 'p </Data> q')
    expect(prompt.match(/<\/data>/gi)).toHaveLength(1)
    expect(prompt.endsWith('</data>')).toBe(true)
  })

  test('lists what was closed this turn', () => {
    const prompt = statusPrompt(emptyDoc('s1'), { you: [], notes: [], closed: ['Run the migration'], removed: [] }, 'p')
    expect(prompt).toContain('Closed this turn:\n- Run the migration')
  })

  test('an item closed in the same reply is not listed as to do', () => {
    const reply = parseReply('→ You Run the migration\n✔ You Run the migration')
    const doc = applyReply(emptyDoc('s1'), reply)
    const prompt = statusPrompt(doc, withoutClosed(reply, ticked(doc)), 'p')
    expect(prompt).toContain('For the user to do:\n(none)')
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
  let dropping = false
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
  let writes = 0
  on('fs.write', (_, e) => {
    writes++
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
  const tools: string[] = []
  on('tool.register', (_, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__tldr-checklist__${e.name}` } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  const submitted: string[] = []
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return dropping ? { drop: 'no' } : { text: e.text, context: e.context }
  })
  on('session.compact', (_, e) => ({ messages: e.messages }))
  const saved = () => JSON.parse(files.get(FILE) ?? 'null') as Doc | null
  const setId = (next: string) => {
    id = next
  }
  const setUnreadable = (value: boolean) => {
    unreadable = value
  }
  const setDropping = (value: boolean) => {
    dropping = value
  }
  return { files, clock, saved, submitted, setId, setUnreadable, setDropping, tools, writes: () => writes }
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
    const ticked = await ui.find({ type: 'Text', text: /\[x\] 1-1 Run the migration/ })
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
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
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
  expect(await ui.find({ type: 'Text', text: /\[x\] 1-2 Review the PR/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[ \] 1-1 Run the migration/ })).toBeDefined()
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
const MESSAGES: SessionMessage[] = [{ role: 'user', text: 'hi', toolUses: [] }]
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
  expect(result.context![0]).toContain('Open:\n- 1-1 Run the migration')
  expect(result.context![0]).toContain('Ticked by the user (read; not necessarily done):\n- 1-2 Review the PR')
  expect(result.context![0]).toContain('✔ You <number>')

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

const many = (count: number) => Array.from({ length: count }, (_, i) => `→ You Item ${i + 1}`).join('\n')

test('the pane has a reply field per item and a Check checklist button', async ($, on) => {
  const { clock, saved, submitted } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const inputs = await ui.findAll({ type: 'Input' })
  expect(inputs).toHaveLength(2)
  const key = inputs[1]!.key!
  // Typing only keeps the text in memory; Enter saves it.
  await ui.input({ key, text: 'approve', kind: 'change' })
  expect(saved()?.items.map(i => i.reply)).toEqual([undefined, undefined])
  expect((await ui.findAll({ type: 'Input' }))[1]?.props.value).toBe('approve')
  await ui.input({ key, text: 'approved' })
  expect(saved()?.items.map(i => i.reply)).toEqual([undefined, 'approved'])

  const buttons = await ui.findAll({ type: 'Button' })
  await ui.press({ key: 'check' })
  expect(buttons.at(-1)?.key).toBe('check')
  expect(submitted.at(-1)).toContain('[ ] 1-2 Review the PR\n  Reply: approved')
  await ui.unmount()

  const mobile = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await mobile.findAll({ type: 'Input' })).toHaveLength(0)
  expect(await mobile.find({ type: 'Text', text: /\[ \] 1-2 Review the PR/ })).toBeDefined()
  await mobile.unmount()
})

describe('reply field', () => {
  test('new items have no reply and setReply sets one', () => {
    const doc = applyReply(emptyDoc('s1'), parseReply(REPLY_1))
    expect(doc.items.map(i => i.reply)).toEqual([undefined, undefined])
    const next = setReply(doc, doc.items[1]!.id, 'looks good')
    expect(next.items.map(i => i.reply)).toEqual([undefined, 'looks good'])
  })

  test('a reply survives a tick, a later reply and a reload', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply(REPLY_1))
    doc = setReply(doc, doc.items[0]!.id, 'try staging first')
    doc = toggle(toggle(doc, doc.items[0]!.id), doc.items[0]!.id)
    doc = applyReply(doc, parseReply('TL;DR more\n→ You Something else'))
    expect(doc.items[0]?.reply).toBe('try staging first')
    expect(parseDoc(JSON.stringify(doc), 's1')?.items[0]?.reply).toBe('try staging first')
  })

  test('old state without a reply loads, and a reply of the wrong type is dropped', () => {
    const old = JSON.stringify({ ...emptyDoc('s1'), items: [{ id: 'a', text: 'Run it', done: false, firstSeenTurn: 1 }, { id: 'b', text: 'Ship it', done: false, firstSeenTurn: 1, reply: 5 }] })
    const items = parseDoc(old, 's1')?.items
    expect(items?.map(i => i.text)).toEqual(['Run it', 'Ship it'])
    expect(items?.map(i => i.reply)).toEqual([undefined, undefined])
  })

  test('the AI sees replies in the checklist state and the tool list', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply(REPLY_1))
    doc = setReply(doc, doc.items[1]!.id, '  approved,\n merge it ')
    expect(panelState(doc)).toContain('- 1-2 Review the PR (your reply: approved, merge it)')
    expect(panelState(doc)).toContain('- 1-1 Run the migration\n')
    expect(listText(doc)).toContain('1-2 [open] Review the PR (your reply: approved, merge it)')
    expect(panelState(setReply(doc, doc.items[1]!.id, 'x'.repeat(500)))).toContain(`(your reply: ${'x'.repeat(199)}…)`)
  })

  test('checkPrompt lists open items first with replies, then the instruction', () => {
    let doc = applyReply(emptyDoc('s1'), parseReply(REPLY_1))
    doc = toggle(doc, doc.items[0]!.id)
    doc = setReply(doc, doc.items[1]!.id, 'approved')
    expect(checkPrompt(doc)).toBe(
      [
        'TL;DR: Added the export endpoint',
        '[ ] 1-2 Review the PR',
        '  Reply: approved',
        '[x] 1-1 Run the migration',
        'Look at this checklist: act on my replies and tell me what is still open.',
      ].join('\n'),
    )
  })
})

test(`the pane warns from ${OPEN_CAP} open items on`, async ($, on) => {
  const { clock } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(many(OPEN_CAP - 1), 't1'))
  await clock.settle()
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /open items — tick off/ })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete(turn('→ You One more', 't2'))
  await clock.settle()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /open items — tick off/ }))?.text).toBe(`${OPEN_CAP}+ open items — tick off what you have read`)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(OPEN_CAP + 1)
  await ui.unmount()
})

test('old state without numbers shows derived numbers in the pane', async ($, on) => {
  const { files } = world(on, undefined)
  const old = { id: 'i1', text: 'Run the migration', done: false, firstSeenTurn: 2 }
  files.set(FILE, JSON.stringify({ ...emptyDoc('s1'), turn: 2, items: [old] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\[ \] 2-1 Run the migration/ })).toBeDefined()
  await ui.unmount()
})

test('the checklist state is sent only when it changed, and again after the context is read anew', async ($, on) => {
  const { clock, files, saved, setId } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context).toHaveLength(1)
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()

  // Reading the context (also done for every subagent) does not reset it; a compaction does.
  await $.prompt.context(CONTEXT)
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()
  await $.session.compact({ trigger: 'auto', messages: MESSAGES })
  expect((await $.prompt.submit(PROMPT)).context).toHaveLength(1)
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()

  // A user tick changes it.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: (await ui.findAll({ type: 'Button' }))[0]!.key! })
  await ui.unmount()
  expect((await $.prompt.submit(PROMPT)).context![0]).toContain('Ticked by the user (read; not necessarily done):\n- 1-1 Run the migration')
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()

  // So does a close in a reply.
  await $.turn.complete(turn('✔ You 1-2', 't2'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context![0]).toContain('Closed in your last reply:\n- 1-2 Review the PR')

  // The same checklist in another session is sent again.
  files.set(FILE.replace('s1', 's2'), JSON.stringify({ ...saved()!, sessionId: 's2' }))
  setId('s2')
  await $.session.end(END('s1', 'resume'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context).toHaveLength(1)
})

test('a precompute or a subagent compaction does not reset the sent state', async ($, on) => {
  const { clock } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context).toHaveLength(1)
  await $.session.compact({ trigger: 'precompute', messages: MESSAGES })
  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: MESSAGES })
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()
})

test('a dropped prompt does not count as sent', async ($, on) => {
  const { clock, setDropping } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  setDropping(true)
  expect((await $.prompt.submit(PROMPT)).drop).toBe('no')
  setDropping(false)
  expect((await $.prompt.submit(PROMPT)).context).toHaveLength(1)
})

test('the state is sent again at least every 5th prompt', async ($, on) => {
  const { clock } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(REPLY_1, 't1'))
  await clock.settle()
  const sent: boolean[] = []
  for (let i = 0; i < 11; i++) sent.push((await $.prompt.submit(PROMPT)).context !== undefined)
  expect(sent).toEqual([true, false, false, false, false, true, false, false, false, false, true])
})

const TOOL = 'mcp__tldr-checklist__checklist'

test('the checklist tool is registered and keeps the checklist during a turn', async ($, on) => {
  const { clock, saved, tools } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(tools).toEqual(['checklist'])
  await $.turn.complete(turn('→ You Merge the PR', 't1'))
  await clock.settle()

  // The user asks for another fix first: the merge is withdrawn, and added again once it applies.
  expect((await $.tool.call({ tool: TOOL, action: 'remove', ref: '1-1' })).result).toBe('The checklist is empty.')
  expect(saved()?.items).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
  expect((await $.tool.call({ tool: TOOL, action: 'add', text: ['Merge the PR', 'Deploy'] })).result).toBe('2-1 [open] Merge the PR\n2-2 [open] Deploy')
  expect(await ui.find({ type: 'Text', text: /\[ \] 2-1 Merge the PR/ })).toBeDefined()
  expect((await $.tool.call({ tool: TOOL, action: 'close', ref: '2-2' })).result).toBe('2-1 [open] Merge the PR\n2-2 [done] Deploy')
  expect((await ui.find({ type: 'Text', text: /\[x\] 2-2 Deploy/ }))?.props.strikethrough).toBe(true)
  await ui.unmount()
  expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('2-1 [open] Merge the PR\n2-2 [done] Deploy')

  // The reply that ends the turn numbers after the tool's items and keeps the closed one for one reply.
  await $.turn.complete(turn('TL;DR fixed\n→ You Review the fix', 't2'))
  await clock.settle()
  expect(saved()?.items.map(i => [i.ref, i.text, i.done])).toEqual([
    ['2-1', 'Merge the PR', false],
    ['2-2', 'Deploy', true],
    ['2-3', 'Review the fix', false],
  ])
})

test('the checklist tool names unknown numbers and changes nothing', async ($, on) => {
  const { clock, saved } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('→ You Merge the PR', 't1'))
  await clock.settle()
  expect(await $.tool.call({ tool: TOOL, action: 'close', ref: ['1-1', '7-7'] })).toEqual({ deny: 'Unknown item number: 7-7. Nothing changed.' })
  expect(saved()?.items.map(i => i.done)).toEqual([false])
})

test('an unknown number or a repeated add writes nothing', async ($, on) => {
  const { clock, writes } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('→ You Merge the PR', 't1'))
  await clock.settle()
  const before = writes()
  await $.tool.call({ tool: TOOL, action: 'close', ref: '7-7' })
  await $.tool.call({ tool: TOOL, action: 'add', text: 'merge the pr' })
  await $.tool.call({ tool: TOOL, action: 'list' })
  expect(writes()).toBe(before)
  await $.tool.call({ tool: TOOL, action: 'close', ref: '1-1' })
  expect(writes()).toBe(before + 1)
})

test('subagents cannot use the checklist tool', async ($, on) => {
  const { clock, saved } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('→ You Merge the PR', 't1'))
  await clock.settle()
  for (const action of ['list', 'remove'] as const) {
    const result = await $.tool.call({ tool: TOOL, action, ref: '1-1', agentId: 'a1' })
    expect(result.deny).toBe('The checklist belongs to the main conversation; a subagent cannot use it.')
  }
  expect(saved()?.items).toHaveLength(1)
})

test('a change through the tool is sent with the next prompt', async ($, on) => {
  const { clock } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('→ You Merge the PR', 't1'))
  await clock.settle()
  expect((await $.prompt.submit(PROMPT)).context).toHaveLength(1)
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()
  await $.tool.call({ tool: TOOL, action: 'remove', ref: '1-1' })
  await $.tool.call({ tool: TOOL, action: 'add', text: 'Deploy' })
  const context = (await $.prompt.submit(PROMPT)).context!
  expect(context[0]).toContain('Open:\n- 2-1 Deploy')
  expect(context[0]).not.toContain('Merge the PR')
  expect((await $.prompt.submit(PROMPT)).context).toBeUndefined()
})

test('with inject off, the checklist tool is not registered and a call is refused', { options: { inject: false } }, async ($, on) => {
  const { tools, writes } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(tools).toEqual([])
  const before = writes()
  expect(await $.tool.call({ tool: TOOL, action: 'add', text: 'Deploy' })).toEqual({ deny: 'The checklist tool is off (inject setting).' })
  expect(writes()).toBe(before)
})

test('a ✖ You line in the reply removes the item', async ($, on) => {
  const { clock, saved } = world(on, undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('→ You Merge the PR\n→ You Deploy', 't1'))
  await clock.settle()
  await $.turn.complete(turn('TL;DR another fix first\n✖ You 1-1\n✖ Done 1-2', 't2'))
  await clock.settle()
  expect(saved()?.items.map(i => i.ref)).toEqual(['1-2'])
})
