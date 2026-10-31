import { describe, expect, it } from 'vitest'
import { buildOutline } from '@shared/outline'
import { addedLine, cleanLine, MAX_LINE, parseAddUrl } from '../../src/main/addToToday'
import { memoryRepo, newItem } from './helpers'

const DAY = '2026-10-17'

describe('cue://add links', () => {
  it('reads the line from text= or url=', () => {
    expect(parseAddUrl('cue://add?text=Call%20the%20dentist')).toBe('Call the dentist')
    expect(parseAddUrl(`cue://add?url=${encodeURIComponent('https://example.com/a?b=c&d=e#f')}`)).toBe('https://example.com/a?b=c&d=e#f')
    // A bookmarklet's encodeURIComponent keeps a literal + as %2B.
    expect(parseAddUrl(`cue://add?text=${encodeURIComponent('https://example.com/?q=a+b')}`)).toBe('https://example.com/?q=a+b')
    expect(parseAddUrl('cue://add?text=&url=https%3A%2F%2Fexample.com')).toBe('https://example.com')
    expect(parseAddUrl('cue://add?text=first&url=https%3A%2F%2Fexample.com')).toBe('first')
  })

  it('accepts the ways a link can name the action', () => {
    for (const url of ['cue://add?text=x', 'cue://add/?text=x', 'cue:add?text=x', 'cue:///add?text=x', 'CUE://ADD?text=x']) {
      expect(parseAddUrl(url), url).toBe('x')
    }
  })

  it('ignores anything else, and links with nothing to add', () => {
    for (const url of [
      'cue://delete?text=x',
      'cue://add/more?text=x',
      'cue://?text=x',
      'https://add?text=x',
      'cue://add',
      'cue://add?text=',
      'cue://add?text=%20%0A%20',
      'cue://add?title=x',
      'not a url'
    ]) {
      expect(parseAddUrl(url), url).toBeNull()
    }
  })

  it('makes one tidy line: trimmed, breaks as spaces, capped', () => {
    expect(cleanLine('  hello  ')).toBe('hello')
    expect(cleanLine('one\ntwo\r\n\r\nthree \u2028 four')).toBe('one two three four')
    expect(cleanLine('tab\there\u0000\u0007')).toBe('tab here')
    expect(cleanLine('   \n\t ')).toBeNull()
    expect(cleanLine(undefined)).toBeNull()
    expect(cleanLine('x'.repeat(5000))).toHaveLength(MAX_LINE)
    // Cut at the cap without leaving half an emoji behind.
    const capped = cleanLine('x'.repeat(MAX_LINE - 1) + '😀😀')!
    expect(capped).toBe('x'.repeat(MAX_LINE - 1))
    expect(parseAddUrl(`cue://add?text=${'a'.repeat(3000)}`)).toHaveLength(MAX_LINE)
  })
})

describe('adding a line to the end of a day', () => {
  it('starts an empty day', () => {
    const [line] = addedLine([], DAY, 'Call the dentist', 1000)
    expect(line).toMatchObject({ date: DAY, parentId: null, type: 'text', text: 'Call the dentist', done: false, deleted: false, createdAt: 1000 })
  })

  it('goes after the last top-level line, below its children, and writes nothing else', () => {
    const first = newItem({ date: DAY, position: 'a0', text: 'first' })
    const last = newItem({ date: DAY, position: 'a1', text: 'last' })
    const child = newItem({ date: DAY, parentId: last.id, position: 'a0', text: 'child of last' })
    const otherDay = newItem({ date: '2026-10-18', position: 'a5', text: 'tomorrow' })
    const changes = addedLine([first, last, child, otherDay], DAY, 'added')
    expect(changes).toHaveLength(1)
    const order = buildOutline([first, last, child, ...changes]).map((row) => [row.depth, row.id])
    expect(order).toEqual([
      [0, first.id],
      [0, last.id],
      [1, child.id],
      [0, changes[0].id]
    ])
  })

  it('lands after siblings that share a key, without rewriting them', () => {
    const a = newItem({ date: DAY, position: 'a1', text: 'from this Mac' })
    const b = newItem({ date: DAY, position: 'a1', text: 'from the phone' })
    const changes = addedLine([a, b], DAY, 'added')
    expect(changes.map((c) => c.text)).toEqual(['added'])
    expect(changes[0].position > 'a1').toBe(true)
  })

  it('ignores deleted lines', () => {
    const kept = newItem({ date: DAY, position: 'a0' })
    const gone = newItem({ date: DAY, position: 'a5', deleted: true })
    const [line] = addedLine([kept, gone], DAY, 'added')
    expect(line.position > 'a0').toBe(true)
    expect(line.position < 'a5').toBe(true)
  })

  it('stores through the repository like any new line, so sync sends it', () => {
    const repo = memoryRepo()
    repo.saveItems([newItem({ date: DAY, position: 'a0', text: 'already here' })])
    repo.acknowledge(repo.pendingChanges().map(({ id, version }) => ({ id, version })))
    const saved = repo.saveItems(addedLine(repo.loadDates([DAY]), DAY, 'Call the dentist'))
    expect(saved).toHaveLength(1)
    expect(repo.pendingChanges().map((i) => i.id)).toEqual([saved[0].id])
    expect(repo.loadDates([DAY]).map((i) => i.text).sort()).toEqual(['Call the dentist', 'already here'])
  })

  it('files a link under the day’s Links bullet, as the iPhone’s share sheet does', () => {
    const outline = (items: ReturnType<typeof newItem>[]) =>
      buildOutline(items).map((row) => `${'  '.repeat(row.depth)}${items.find((i) => i.id === row.id)!.text}`)

    // No Links bullet yet: one is made at the end of the day, with the link under it.
    const note = newItem({ date: DAY, position: 'a0', text: 'note' })
    const made = addedLine([note], DAY, 'https://a.com')
    expect(made).toHaveLength(2)
    expect(made.find((i) => i.text === 'Links')).toMatchObject({ type: 'bullet', parentId: null })
    expect(outline([note, ...made])).toEqual(['note', 'Links', '  https://a.com'])

    // With one (any case, a colon is fine), the link goes last under it, even with lines after it.
    const heading = newItem({ date: DAY, position: 'a1', type: 'bullet', text: 'links:' })
    const earlier = newItem({ date: DAY, parentId: heading.id, position: 'a0', text: 'https://b.com' })
    const after = newItem({ date: DAY, position: 'a2', text: 'after' })
    const added = addedLine([note, heading, earlier, after], DAY, 'https://c.com')
    expect(added).toHaveLength(1)
    expect(outline([note, heading, earlier, after, ...added])).toEqual(['note', 'links:', '  https://b.com', '  https://c.com', 'after'])

    // A link with words around it is a note, not a link to file.
    expect(outline([note, ...addedLine([note], DAY, 'read https://a.com later')])).toEqual(['note', 'read https://a.com later'])
  })
})
