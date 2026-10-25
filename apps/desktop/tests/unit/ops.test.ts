import { beforeEach, describe, expect, it } from 'vitest'
import { generateNKeysBetween } from 'fractional-indexing'
import type { Backend } from '../../src/renderer/src/data/backend'
import * as ops from '@shared/editor/ops'
import { Tx } from '@shared/editor/tx'
import { ItemStore } from '@shared/itemStore'
import type { LineSpec } from '@shared/markdown'
import { buildOutline } from '@shared/outline'
import type { Item, ItemType } from '@shared/types'

const DAY = '2026-10-17'
const NEXT = '2026-10-18'

function stubBackend(seed: Item[]): Backend {
  return {
    loadDates: async (dates: string[]) => seed.filter((i) => dates.includes(i.date)),
    saveItems: async () => [],
    saveItemsSync: () => {}
  } as unknown as Backend
}

/**
 * Build a day from an indented outline. Markers: "[ ] " to-do, "[x] " done, "- " bullet.
 * Item ids are the item text.
 */
function parse(outline: string, date = DAY): Item[] {
  const lines = outline.split('\n').filter((l) => l.trim())
  const stack: string[] = []
  const counters = new Map<string | null, number>()
  const items: Item[] = []
  for (const line of lines) {
    const depth = (line.length - line.trimStart().length) / 2
    let text = line.trim()
    let type: ItemType = 'text'
    let done = false
    if (text.startsWith('[ ] ') || text.startsWith('[x] ')) {
      type = 'todo'
      done = text[1] === 'x'
      text = text.slice(4)
    } else if (text.startsWith('- ')) {
      type = 'bullet'
      text = text.slice(2)
    }
    const parentId = depth === 0 ? null : stack[depth - 1]
    stack[depth] = text
    stack.length = depth + 1
    const n = counters.get(parentId) ?? 0
    counters.set(parentId, n + 1)
    items.push({
      id: text,
      date,
      parentId,
      position: generateNKeysBetween(null, null, n + 1)[n],
      type,
      text,
      done,
      createdAt: 0,
      updatedAt: 0,
      deleted: false,
      version: ''
    })
  }
  return items
}

function render(store: ItemStore, date = DAY): string {
  return store
    .outline(date)
    .map((r) => {
      const item = store.get(r.id)!
      const marker = item.type === 'todo' ? (item.done ? '[x] ' : '[ ] ') : item.type === 'bullet' ? '- ' : ''
      return '  '.repeat(r.depth) + marker + item.text
    })
    .join('\n')
}

let store: ItemStore

async function setup(outline: string, other = ''): Promise<void> {
  store = new ItemStore(stubBackend([...parse(outline), ...(other ? parse(other, NEXT) : [])]))
  await store.ensureLoaded([DAY, NEXT])
}

function run<T>(fn: (tx: Tx) => T): T {
  const tx = new Tx(store)
  const result = fn(tx)
  store.commit(tx.netChanges().map((c) => c.after))
  return result
}

const idOf = (text: string): string => store.itemsOn(DAY).concat(store.itemsOn(NEXT)).find((i) => i.text === text)!.id

beforeEach(() => {
  store = undefined as unknown as ItemStore
})

describe('Enter', () => {
  it('splits at the caret, keeping the type', async () => {
    await setup('[ ] Buy milk and eggs')
    const focus = run((tx) => ops.splitAt(tx, 'Buy milk and eggs', 9))
    expect(render(store)).toBe('[ ] Buy milk \n[ ] and eggs')
    expect(store.get(focus!.id)!.text).toBe('and eggs')
  })

  it('at the end of a parent inserts its first child', async () => {
    await setup('Groceries\n  milk')
    run((tx) => ops.splitAt(tx, 'Groceries', 9))
    expect(render(store)).toBe('Groceries\n  \n  milk')
  })

  it('at the start inserts a line above and keeps the caret', async () => {
    await setup('- one\n- two')
    const focus = run((tx) => ops.splitAt(tx, 'two', 0))
    expect(render(store)).toBe('- one\n- \n- two')
    expect(focus).toEqual({ id: 'two', start: 0 })
  })

  it('on an empty item outdents, then drops formatting', async () => {
    await setup('- a\n  - x')
    run((tx) => ops.splitAt(tx, 'x', 1, 1))
    const empty = store.outline(DAY)[2].id
    run((tx) => ops.enterOnEmpty(tx, empty))
    expect(render(store)).toBe('- a\n  - x\n- ')
    run((tx) => ops.enterOnEmpty(tx, empty))
    expect(render(store)).toBe('- a\n  - x\n')
  })
})

describe('Backspace and Delete at the edges', () => {
  it('removes formatting, then indentation, then merges upward', async () => {
    await setup('Parent\n  [ ] child\n    grandchild')
    run((tx) => ops.backspaceAtStart(tx, 'child'))
    expect(render(store)).toBe('Parent\n  child\n    grandchild')
    run((tx) => ops.backspaceAtStart(tx, 'child'))
    expect(render(store)).toBe('Parent\nchild\n  grandchild')
    const focus = run((tx) => ops.backspaceAtStart(tx, 'child'))
    expect(render(store)).toBe('Parentchild\n  grandchild')
    expect(focus).toEqual({ id: 'Parent', start: 6 })
  })

  it('forward-delete pulls the next line up and keeps its children', async () => {
    await setup('a\n  b\n    c\n  d')
    run((tx) => ops.deleteAtEnd(tx, 'a'))
    expect(render(store)).toBe('ab\n  c\n  d')
  })
})

describe('Indent and outdent', () => {
  it('indents under the previous sibling, all or nothing', async () => {
    await setup('a\nb\nc')
    expect(run((tx) => ops.indent(tx, ['b', 'c']))).toBe(true)
    expect(render(store)).toBe('a\n  b\n  c')
    expect(run((tx) => ops.indent(tx, ['a']))).toBe(false)
  })

  it('outdent keeps the visual order: following siblings become children', async () => {
    await setup('P\n  x\n  y\n  z')
    run((tx) => ops.outdent(tx, ['y']))
    expect(render(store)).toBe('P\n  x\ny\n  z')
  })

  it('outdents a multi-item selection in place', async () => {
    await setup('P\n  x\n  y\n  z')
    run((tx) => ops.outdent(tx, ['x', 'y']))
    expect(render(store)).toBe('P\nx\ny\n  z')
  })
})

describe('Reordering', () => {
  it('moves an item with its children among siblings', async () => {
    await setup('a\nb\n  b1\nc')
    run((tx) => ops.moveVertical(tx, ['b', 'b1'], -1))
    expect(render(store)).toBe('b\n  b1\na\nc')
    run((tx) => ops.moveVertical(tx, ['b'], 1))
    run((tx) => ops.moveVertical(tx, ['b'], 1))
    expect(render(store)).toBe('a\nc\nb\n  b1')
    expect(run((tx) => ops.moveVertical(tx, ['b'], 1))).toBe(false)
  })

  it('crosses into the neighboring parent at the same depth', async () => {
    await setup('A\n  a1\nB\n  b1')
    run((tx) => ops.moveVertical(tx, ['b1'], -1))
    expect(render(store)).toBe('A\n  a1\n  b1\nB')
  })

  it('drops an item at an exact spot, even under another day', async () => {
    await setup('a\nb\n  b1', 'x\ny')
    run((tx) => ops.dropAt(tx, ['b'], NEXT, idOf('x'), null))
    expect(render(store)).toBe('a')
    expect(render(store, NEXT)).toBe('x\n  b\n    b1\ny')
    expect(run((tx) => ops.dropAt(tx, ['x'], NEXT, idOf('b1'), null))).toBe(false)
  })
})

describe('Moving between days', () => {
  it('moves the item and its children to the end of the target day', async () => {
    await setup('[ ] task\n  [x] sub\nkeep', 'existing')
    const moved = run((tx) => ops.moveToDate(tx, ['task', 'sub'], NEXT))
    expect(moved).toEqual(['task'])
    expect(render(store)).toBe('keep')
    expect(render(store, NEXT)).toBe('existing\n[ ] task\n  [x] sub')
  })

  it('moves a nested item out to the top level of the new day', async () => {
    await setup('P\n  child')
    run((tx) => ops.moveToDate(tx, ['child'], NEXT))
    expect(render(store)).toBe('P')
    expect(render(store, NEXT)).toBe('child')
  })

  it('keeps a to-do nested when a to-do further up is moved too', async () => {
    await setup('[ ] outer\n  - note\n    [ ] inner\nkeep')
    const moved = run((tx) => ops.moveToDate(tx, ['outer', 'inner'], NEXT))
    expect(moved).toEqual(['outer'])
    expect(render(store)).toBe('keep')
    expect(render(store, NEXT)).toBe('[ ] outer\n  - note\n    [ ] inner')
  })
})

describe('Completion and conversion', () => {
  it('toggles to-dos and converts other lines', async () => {
    await setup('[ ] a\n[x] b\n- c')
    expect(run((tx) => ops.toggleDone(tx, ['a']))).toBe('completed')
    expect(run((tx) => ops.toggleDone(tx, ['a', 'b']))).toBe('reopened')
    expect(run((tx) => ops.toggleDone(tx, ['c']))).toBe('converted')
    expect(render(store)).toBe('[ ] a\n[ ] b\n[ ] c')
    run((tx) => ops.toggleTodo(tx, ['a', 'b', 'c']))
    expect(render(store)).toBe('- a\n- b\n- c')
  })

  it('deletes an item with its children', async () => {
    await setup('a\n  b\n    c\nd')
    run((tx) => ops.remove(tx, ['a']))
    expect(render(store)).toBe('d')
  })
})

describe('Paste', () => {
  it('pastes nested lines like a document, keeping the tail', async () => {
    await setup('Start END')
    const lines = [
      { depth: 0, type: 'text' as const, done: false, text: 'one' },
      { depth: 0, type: 'todo' as const, done: false, text: 'two' },
      { depth: 1, type: 'bullet' as const, done: false, text: 'three' }
    ]
    const focus = run((tx) => ops.pasteLines(tx, 'Start END', 6, 6, lines))
    expect(render(store)).toBe('Start one\n[ ] two\n  - threeEND')
    expect(focus!.start).toBe(5)
  })

  it('adopts the pasted marker when pasting into an empty line', async () => {
    await setup('a')
    run((tx) => ops.splitAt(tx, 'a', 1))
    const empty = store.outline(DAY)[1].id
    run((tx) => ops.pasteLines(tx, empty, 0, 0, [{ depth: 0, type: 'todo', done: true, text: 'done thing' }]))
    expect(render(store)).toBe('a\n[x] done thing')
  })
})

describe('Sharing a link', () => {
  const link = { depth: 0, type: 'text' as const, done: false, text: 'https://example.com' }

  it('adds it under a new Links bullet at the end of the day', async () => {
    await setup('a\n  b')
    run((tx) => ops.addToLinks(tx, DAY, link))
    expect(render(store)).toBe('a\n  b\n- Links\n  https://example.com')
  })

  it('adds it last under the day’s Links line, whatever its marker or case', async () => {
    await setup('links:\n  https://one.com\n    note\nlater')
    run((tx) => ops.addToLinks(tx, DAY, link))
    expect(render(store)).toBe('links:\n  https://one.com\n    note\n  https://example.com\nlater')
  })

  it('ignores a nested Links line', async () => {
    await setup('- a\n  - Links')
    run((tx) => ops.addToLinks(tx, DAY, link))
    expect(render(store)).toBe('- a\n  - Links\n- Links\n  https://example.com')
  })
})

describe('Regression', () => {
  it('pastes into a parent without pushing the rest of the line below its children', async () => {
    await setup('HelloWorld\n  c')
    const lines = [
      { depth: 0, type: 'text' as const, done: false, text: 'p' },
      { depth: 0, type: 'text' as const, done: false, text: 'q' }
    ]
    const focus = run((tx) => ops.pasteLines(tx, 'HelloWorld', 5, 5, lines))
    expect(render(store)).toBe('Hellop\n  qWorld\n  c')
    expect(store.get(focus!.id)!.text).toBe('qWorld')
    expect(focus!.start).toBe(1)
  })

  it('keeps positions short under thousands of inserts into the same gap', async () => {
    await setup('a\nb')
    for (let i = 0; i < 1500; i++) run((tx) => ops.splitAt(tx, 'b', 0))
    const rows = store.outline(DAY).map((r) => store.get(r.id)!)
    expect(rows).toHaveLength(1502)
    expect(rows[0].text).toBe('a')
    expect(rows[rows.length - 1].text).toBe('b')
    expect(Math.max(...rows.map((r) => r.position.length))).toBeLessThanOrEqual(48)
  })
})

describe('Sync artifacts', () => {
  /** Devices inserted at the same spot concurrently: the twins (A and B) share the last one's key. */
  async function tied(outline = 'A\nB', twins = ['A', 'B']): Promise<void> {
    await setup(outline)
    const { position } = store.get(twins[twins.length - 1])!
    store.commit(twins.slice(0, -1).map((id) => ({ ...store.get(id)!, position })))
  }

  it('places a new line into a tie after it, writing nothing else', async () => {
    await tied()
    const tx = new Tx(store)
    const created = tx.create({ date: DAY, text: 'new' })
    tx.place([created.id], DAY, null, 'A')
    // Only the new line is written, so concurrent edits to A and B can't be overwritten.
    expect(tx.netChanges().map((c) => c.after.id)).toEqual([created.id])
    store.commit(tx.netChanges().map((c) => c.after))
    expect(render(store)).toBe('A\nB\nnew')
  })

  it('moves a tied sibling by writing only that line', async () => {
    await tied()
    const tx = new Tx(store)
    tx.place(['B'], DAY, null, null)
    expect(tx.netChanges().map((c) => c.after.id)).toEqual(['B'])
    store.commit(tx.netChanges().map((c) => c.after))
    expect(render(store)).toBe('B\nA')
  })

  it('splits a tied line without touching its twin', async () => {
    await tied()
    const tx = new Tx(store)
    ops.splitAt(tx, 'A', 1)
    expect(tx.netChanges().filter((c) => c.before).map((c) => c.after.id)).toEqual([])
    store.commit(tx.netChanges().map((c) => c.after))
    expect(render(store)).toBe('A\nB\n')
  })

  /** The lines a draft writes, by id. */
  function written(fn: (tx: Tx) => unknown): string[] {
    const tx = new Tx(store)
    fn(tx)
    store.commit(tx.netChanges().map((c) => c.after))
    return tx.netChanges().map((c) => c.after.id)
  }

  it('moves a line up into a tie, re-keying only the twin after the slot', async () => {
    await tied('A\nB\nC')
    // C's fresh key happens to be the one it had; A, before the slot, keeps its key.
    expect(written((tx) => ops.moveVertical(tx, ['C'], -1))).toEqual(['B'])
    expect(render(store)).toBe('A\nC\nB')
  })

  it('drops a line into a tie exactly where asked', async () => {
    await tied('A\nB\nC')
    expect(written((tx) => ops.dropAt(tx, ['C'], DAY, null, 'A'))).toEqual(['B'])
    expect(render(store)).toBe('A\nC\nB')
  })

  it('moves the line above a tie down one row, between the twins', async () => {
    await tied('X\nA\nB\nC')
    expect(written((tx) => ops.moveVertical(tx, ['X'], 1))).toEqual(['X', 'B'])
    expect(render(store)).toBe('A\nX\nB\nC')
  })

  it('drops after the first of three twins, writing only the two after it', async () => {
    await tied('A\nB\nD\nC', ['A', 'B', 'D'])
    expect(render(store)).toBe('A\nB\nD\nC')
    expect(written((tx) => ops.dropAt(tx, ['C'], DAY, null, 'A'))).toEqual(['B', 'D'])
    expect(render(store)).toBe('A\nC\nB\nD')
  })
})

describe('Bulk edits in linear time', () => {
  /** An item source that counts how often a draft reads a whole day. */
  function counting(): { tx: Tx; reads: () => number } {
    let reads = 0
    const source = { get: (id: string) => store.get(id), itemsOn: (date: string) => (reads++, store.itemsOn(date)) }
    return { tx: new Tx(source), reads: () => reads }
  }

  const bulk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ depth: i % 6 === 5 ? 1 : 0, type: 'todo' as const, done: false, text: `Line ${i}` }))

  it('pastes 2,000 lines reading the day only a few times', async () => {
    await setup('first')
    const { tx, reads } = counting()
    ops.insertLinesAfter(tx, DAY, 'first', bulk(2000))
    expect(reads()).toBeLessThanOrEqual(3)
    store.commit(tx.netChanges().map((c) => c.after))
    const rows = store.outline(DAY)
    expect(rows).toHaveLength(2001)
    expect(rows.slice(0, 7).map((r) => `${r.depth}|${store.get(r.id)!.text}`)).toEqual([
      '0|first',
      '0|Line 0',
      '0|Line 1',
      '0|Line 2',
      '0|Line 3',
      '0|Line 4',
      '1|Line 5'
    ])
  })

  it('deletes 2,000 lines reading the day only a few times', async () => {
    await setup('')
    run((tx) => ops.insertLinesAfter(tx, DAY, null, bulk(2000)))
    const { tx, reads } = counting()
    ops.remove(tx, store.outline(DAY).map((r) => r.id))
    expect(reads()).toBeLessThanOrEqual(3)
    store.commit(tx.netChanges().map((c) => c.after))
    expect(store.outline(DAY)).toEqual([])
  })

  /** The one-line-at-a-time paste and delete these replaced, over a draft that never caches. */
  class UncachedTx extends Tx {
    override outline(date: string) {
      return buildOutline(this.itemsOn(date))
    }
  }
  function referencePaste(tx: Tx, date: string, afterId: string | null, lines: LineSpec[]): void {
    const stack: string[] = afterId ? [afterId] : []
    const parent = afterId ? tx.parentOf(afterId) : null
    const anchor = afterId ?? 'end'
    let first = true
    for (const line of lines) {
      const depth = Math.min(line.depth, stack.length)
      const parentId = depth === 0 ? parent : stack[depth - 1]
      const after = stack[depth] ?? (depth === 0 ? (first ? anchor : 'end') : null)
      const item = tx.create({ date, type: line.type, done: line.type === 'todo' && line.done, text: line.text })
      tx.place([item.id], date, parentId, after)
      stack[depth] = item.id
      stack.length = depth + 1
      first = false
    }
  }
  function referenceRemove(tx: Tx, ids: string[]): void {
    for (const root of tx.roots(ids)) for (const id of tx.subtreeIds(root)) tx.update(id, { deleted: true })
  }

  it('pastes and deletes exactly like line-at-a-time editing (200 random nested cases)', async () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    /** Random nested lines; unlike parsed Markdown, they may start indented. */
    const randomLines = (n: number, start = 0): LineSpec[] => {
      const out: LineSpec[] = []
      let depth = start
      for (let i = 0; i < n; i++) {
        if (i) depth = Math.max(0, Math.min(depth + Math.floor(random() * 3) - 1, 3))
        const type = (['text', 'bullet', 'todo'] as const)[Math.floor(random() * 3)]
        out.push({ depth, type, done: type === 'todo' && random() < 0.5, text: `line ${i}` })
      }
      return out
    }
    const shape = () => render(store)
    let mismatches = 0
    for (let t = 0; t < 200; t++) {
      const base = randomLines(1 + Math.floor(random() * 12))
      const pasted = randomLines(1 + Math.floor(random() * 40), Math.floor(random() * 2))
      const anchorAt = random()
      const results: string[] = []
      for (const reference of [false, true]) {
        await setup('')
        run((tx) => ops.insertLinesAfter(tx, DAY, null, base))
        const rows = store.outline(DAY)
        // Mostly an anchor somewhere in the day (often one with children), sometimes the end.
        const anchor = anchorAt < 0.15 ? null : rows[Math.floor(anchorAt * rows.length)].id
        const tx = reference ? new UncachedTx(store) : new Tx(store)
        if (reference) referencePaste(tx, DAY, anchor, pasted)
        else ops.insertLinesAfter(tx, DAY, anchor, pasted)
        store.commit(tx.netChanges().map((c) => c.after))
        const afterPaste = shape()
        const doomed = store.outline(DAY).filter((_, i) => (i * 7 + t) % 3 === 0).map((r) => r.id)
        const txd = reference ? new UncachedTx(store) : new Tx(store)
        if (reference) referenceRemove(txd, doomed)
        else ops.remove(txd, doomed)
        store.commit(txd.netChanges().map((c) => c.after))
        results.push(`${afterPaste}\n---\n${shape()}`)
      }
      if (results[0] !== results[1]) mismatches++
    }
    expect(mismatches).toBe(0)
  })
})
