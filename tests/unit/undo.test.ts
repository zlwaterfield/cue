import { describe, expect, it } from 'vitest'
import * as ops from '../../src/shared/editor/ops'
import { Tx } from '../../src/shared/editor/tx'
import { revert, UndoManager, type UndoEntry } from '../../src/shared/editor/undo'
import { ItemStore, type StoreBackend } from '../../src/shared/itemStore'
import type { Item } from '../../src/shared/types'
import { newItem } from './helpers'

const DAY = '2026-10-17'
const NEXT = '2026-10-18'

/** A loaded day whose saves land at once, plus the edit, undo and remote-change steps the editors take. */
async function setup(...items: Item[]) {
  const backend: StoreBackend = {
    loadDates: async (dates) => items.filter((i) => dates.includes(i.date)),
    saveItems: async (saved) => saved.map(({ id }) => ({ id, version: '' })),
    saveItemsSync: () => {}
  }
  const store = new ItemStore(backend)
  await store.ensureLoaded([DAY, NEXT])
  const undo = new UndoManager()
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

  /** A local edit, recorded like the controllers do. */
  const edit = (fn: (tx: Tx) => void, coalesceKey?: string): UndoEntry['changes'] => {
    const tx = new Tx(store)
    fn(tx)
    const changes = tx.netChanges()
    store.commit(changes.map((c) => c.after))
    undo.record({ label: 'Edit', changes, selectionBefore: { kind: 'none' }, selectionAfter: { kind: 'none' }, coalesceKey, at: Date.now() })
    return changes
  }
  /** Another device's edit, once this one's own saves have landed. */
  const remote = async (id: string, patch: Partial<Item>) => {
    await settle()
    store.applyExternal([{ ...(store.get(id) ?? items.find((i) => i.id === id)!), ...patch }])
  }
  const undoOnce = () => {
    const records = revert(undo.popUndo()!.changes, 'undo', store)
    store.commit(records)
    return records
  }
  const redoOnce = () => {
    const records = revert(undo.popRedo()!.changes, 'redo', store)
    store.commit(records)
    return records
  }
  return { store, undo, edit, remote, undoOnce, redoOnce }
}

describe('revert (undo and redo reverse only what the action changed)', () => {
  it('keeps another device’s newer text when a completion is undone and redone', async () => {
    const report = newItem({ id: 'r', date: DAY, type: 'todo', text: 'write report' })
    const { store, edit, remote, undoOnce, redoOnce } = await setup(report)
    edit((tx) => ops.toggleDone(tx, ['r']))
    await remote('r', { text: 'write report with Q3 numbers' })
    undoOnce()
    expect(store.get('r')).toMatchObject({ text: 'write report with Q3 numbers', done: false })
    redoOnce()
    expect(store.get('r')).toMatchObject({ text: 'write report with Q3 numbers', done: true })
  })

  it('brings a deleted line back', async () => {
    const line = newItem({ id: 'd', date: DAY, text: 'gone for now' })
    const { store, edit, undoOnce } = await setup(line)
    edit((tx) => ops.remove(tx, ['d']))
    expect(store.get('d')).toBeUndefined()
    undoOnce()
    expect(store.get('d')).toMatchObject({ text: 'gone for now', deleted: false })
  })

  it('never resurrects a line deleted elsewhere', async () => {
    const line = newItem({ id: 't', date: DAY, type: 'todo', text: 'task' })
    const { store, edit, remote, undoOnce } = await setup(line)
    edit((tx) => ops.toggleDone(tx, ['t']))
    await remote('t', { deleted: true })
    expect(undoOnce()).toEqual([])
    expect(store.get('t')).toBeUndefined()
  })

  it('removes a created line on undo only while nobody has changed it', async () => {
    const anchor = newItem({ id: 'a', date: DAY, text: 'anchor' })
    const { store, edit, remote, undoOnce } = await setup(anchor)
    const [, untouched] = edit((tx) => ops.splitAt(tx, 'a', 3))
    const [, edited] = edit((tx) => ops.splitAt(tx, untouched.after.id, 2))
    await remote(edited.after.id, { text: 'or written elsewhere' })

    // The second split: its line was edited elsewhere, so it stays; the text it split off goes back.
    undoOnce()
    expect(store.get(edited.after.id)?.text).toBe('or written elsewhere')
    expect(store.get(untouched.after.id)?.text).toBe('hor')
    // The first split: nobody touched its line, so it goes.
    undoOnce()
    expect(store.get(untouched.after.id)).toBeUndefined()
    expect(store.get('a')?.text).toBe('anchor')
  })

  it('brings a created line back on redo, once', async () => {
    const { store, edit, undoOnce, redoOnce } = await setup()
    const [created] = edit((tx) => void tx.create({ date: DAY, text: 'new' }))
    undoOnce()
    expect(store.get(created.after.id)).toBeUndefined()
    expect(redoOnce()).toHaveLength(1)
    expect(store.get(created.after.id)?.text).toBe('new')
  })

  it('undoes a move only while its date, parent and position are all still where it left them', async () => {
    const parent = newItem({ id: 'p', date: DAY, text: 'parent' })
    const line = newItem({ id: 'm', date: DAY, text: 'line' })
    const first = await setup(parent, line)
    first.edit((tx) => ops.moveToDate(tx, ['m'], NEXT))
    first.undoOnce()
    expect(first.store.get('m')).toMatchObject({ date: DAY, parentId: null, position: line.position })

    // Moved again elsewhere (nested under "parent"): the undo leaves it there, text edits aside.
    const second = await setup(parent, line)
    second.edit((tx) => {
      ops.moveToDate(tx, ['m'], NEXT)
      tx.update('m', { text: 'line, renamed' })
    })
    await second.remote('m', { date: DAY, parentId: 'p' })
    second.undoOnce()
    expect(second.store.get('m')).toMatchObject({ date: DAY, parentId: 'p', text: 'line' })
  })

  it('skips a typing run whose text was changed elsewhere since', async () => {
    const line = newItem({ id: 'w', date: DAY, text: 'Hello' })
    const { store, edit, remote, undoOnce } = await setup(line)
    edit((tx) => void tx.update('w', { text: 'Hello w' }), 'text:w')
    edit((tx) => void tx.update('w', { text: 'Hello world' }), 'text:w')
    await remote('w', { text: 'Hello there' })
    expect(undoOnce()).toEqual([])
    expect(store.get('w')?.text).toBe('Hello there')
  })

  it('undoes a whole typing run when nothing else changed', async () => {
    const line = newItem({ id: 'w', date: DAY, text: 'Hello' })
    const { store, edit, undoOnce } = await setup(line)
    edit((tx) => void tx.update('w', { text: 'Hello w' }), 'text:w')
    edit((tx) => void tx.update('w', { text: 'Hello world' }), 'text:w')
    undoOnce()
    expect(store.get('w')?.text).toBe('Hello')
  })
})
