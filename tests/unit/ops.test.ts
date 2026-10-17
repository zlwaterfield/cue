import { beforeEach, describe, expect, it } from 'vitest'
import { generateNKeysBetween } from 'fractional-indexing'
import type { Backend } from '../../src/renderer/src/data/backend'
import * as ops from '../../src/renderer/src/editor/ops'
import { Tx } from '../../src/renderer/src/editor/tx'
import { ItemStore } from '../../src/renderer/src/store/items'
import type { Item, ItemType } from '../../src/shared/types'

const DAY = '2026-10-17'
const NEXT = '2026-10-18'

function stubBackend(seed: Item[]): Backend {
  return {
    loadDates: async (dates: string[]) => seed.filter((i) => dates.includes(i.date)),
    saveItems: async () => {},
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
  it('re-keys colliding sibling positions before inserting between them', async () => {
    await setup('a\nb')
    // Simulate two devices that inserted at the same spot concurrently.
    const a = store.get('a')!
    store.commit([{ ...store.get('b')!, position: a.position }])
    run((tx) => ops.splitAt(tx, 'a', 1))
    const rows = store.outline(DAY).map((r) => store.get(r.id)!)
    expect(rows.map((r) => r.text)).toEqual(['a', '', 'b'])
    const positions = rows.map((r) => r.position)
    expect([...positions].sort()).toEqual(positions)
    expect(new Set(positions).size).toBe(3)
  })
})
