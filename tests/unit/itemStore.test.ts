import { describe, expect, it } from 'vitest'
import type { Backend } from '../../src/renderer/src/data/backend'
import { ItemStore } from '../../src/shared/itemStore'
import type { Item } from '../../src/shared/types'
import { newItem } from './helpers'

const DAY = '2026-10-17'

/** A backend whose saves resolve only when the test says so, with the given stored versions. */
function controlledBackend(seed: Item[]) {
  const saves: Array<{ items: Item[]; resolve: (versions: Array<{ id: string; version: string }>) => void }> = []
  const backend = {
    loadDates: async () => seed,
    saveItems: (items: Item[]) => new Promise((resolve) => saves.push({ items, resolve })),
    saveItemsSync: () => {}
  } as unknown as Backend
  return { backend, saves }
}

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 60))

describe('ItemStore.applyExternal (changes from another device)', () => {
  const base = newItem({ id: 'a', date: DAY, text: 'original', version: '0000000001-0000-mac' })
  const remote = (text: string, version: string): Item => ({ ...base, text, version })

  async function setup() {
    const { backend, saves } = controlledBackend([base])
    const store = new ItemStore(backend)
    await store.ensureLoaded([DAY])
    return { store, saves }
  }

  it('applies remote changes to lines nobody is editing', async () => {
    const { store } = await setup()
    store.applyExternal([remote('from phone', '0000000005-0000-phone')])
    expect(store.get('a')?.text).toBe('from phone')
  })

  it('never replaces an edit that has not been saved yet', async () => {
    const { store } = await setup()
    store.commit([{ ...base, text: 'typing here' }])
    store.applyExternal([remote('from phone', '0000000005-0000-phone')])
    expect(store.get('a')?.text).toBe('typing here')
  })

  it('lets the stored version decide when a save was in flight', async () => {
    // Our save landed first and the phone's later edit won in storage.
    let { store, saves } = await setup()
    store.commit([{ ...base, text: 'mine' }])
    await flushTimers()
    store.applyExternal([remote('phone wins', '0000000009-0000-phone')])
    expect(store.get('a')?.text).toBe('mine')
    saves[0].resolve([{ id: 'a', version: '0000000007-0000-mac' }])
    await flushTimers()
    expect(store.get('a')?.text).toBe('phone wins')

    // The phone's edit landed first and our save stored a newer version on top.
    ;({ store, saves } = await setup())
    store.commit([{ ...base, text: 'mine wins' }])
    await flushTimers()
    store.applyExternal([remote('phone', '0000000005-0000-phone')])
    saves[0].resolve([{ id: 'a', version: '0000000006-0000-mac' }])
    await flushTimers()
    expect(store.get('a')?.text).toBe('mine wins')
  })
})

describe('ItemStore.reset (an account signs out of the phone)', () => {
  it('forgets loaded days and drops edits not yet saved', async () => {
    const item = newItem({ id: 'a', date: DAY, text: 'mine' })
    const { backend, saves } = controlledBackend([item])
    const store = new ItemStore(backend)
    await store.ensureLoaded([DAY])
    let notified = 0
    store.subscribeDate(DAY, () => notified++)
    store.commit([{ ...item, text: 'unsaved' }])
    store.reset()
    expect(store.get('a')).toBeUndefined()
    expect(store.isLoaded(DAY)).toBe(false)
    expect(store.outline(DAY)).toEqual([])
    expect(store.persistence.hasPending()).toBe(false)
    expect(notified).toBe(1)
    await flushTimers()
    expect(saves).toHaveLength(0)
  })
})
