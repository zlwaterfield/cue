import { describe, expect, it } from 'vitest'
import { SyncEngine } from '../../src/main/sync/engine'
import { MemorySyncServer } from '../../src/main/sync/memoryServer'
import type { Item } from '../../src/shared/types'
import { memoryRepo, newItem } from './helpers'

function visible(items: Item[]) {
  return items
    .filter((i) => !i.deleted)
    .map((i) => `${i.date}|${i.parentId ?? '-'}|${i.position}|${i.type}|${i.done}|${i.text}`)
    .sort()
}

describe('sync (protocol reference implementation)', () => {
  it('converges two offline replicas without losing or duplicating items', async () => {
    const server = new MemorySyncServer()
    const desktop = memoryRepo()
    const phone = memoryRepo()
    const desktopSync = new SyncEngine(desktop, server.transport(), {}, 3)
    const phoneSync = new SyncEngine(phone, server.transport(), {}, 3)

    const shared = newItem({ text: 'Plan trip' })
    desktop.saveItems([shared])
    await desktopSync.sync()
    await phoneSync.sync()
    expect(phone.get(shared.id)?.text).toBe('Plan trip')

    // Both go offline and edit.
    server.online = false
    const desktopOnly = Array.from({ length: 5 }, (_, i) => newItem({ text: `desktop ${i}` }))
    desktop.saveItems(desktopOnly)
    const friday = newItem({ date: '2026-10-23', text: 'Created offline, moved to Friday' })
    desktop.saveItems([friday])
    phone.saveItems([newItem({ text: 'phone note' })])
    await expect(desktopSync.sync()).rejects.toThrow()
    expect(desktopSync.status.state).toBe('offline')

    // Conflicting edits to the same item: the later write wins on every replica.
    phone.saveItems([{ ...phone.get(shared.id)!, text: 'Plan trip (phone)' }])
    await new Promise((r) => setTimeout(r, 5))
    desktop.saveItems([{ ...desktop.get(shared.id)!, done: true, type: 'todo', text: 'Plan trip (desktop)' }])

    server.online = true
    await phoneSync.sync()
    await desktopSync.sync()
    await phoneSync.sync()

    const a = visible(desktop.allItems())
    const b = visible(phone.allItems())
    expect(a).toEqual(b)
    expect(a).toHaveLength(1 + 5 + 1 + 1)
    expect(phone.get(shared.id)?.text).toBe('Plan trip (desktop)')
    expect(phone.loadDates(['2026-10-23']).map((i) => i.text)).toEqual(['Created offline, moved to Friday'])
    expect(desktop.pendingChanges()).toHaveLength(0)
    expect(phone.pendingChanges()).toHaveLength(0)
  })

  it('propagates deletions and never resurrects them', async () => {
    const server = new MemorySyncServer()
    const a = memoryRepo()
    const b = memoryRepo()
    const syncA = new SyncEngine(a, server.transport())
    const syncB = new SyncEngine(b, server.transport())

    const item = newItem({ text: 'to delete' })
    a.saveItems([item])
    await syncA.sync()
    await syncB.sync()

    // B deletes while A (offline, stale) still has the live copy and re-syncs.
    b.saveItems([{ ...b.get(item.id)!, deleted: true }])
    await syncB.sync()
    await syncA.sync()
    expect(a.get(item.id)?.deleted).toBe(true)
    expect(a.loadDates([item.date])).toHaveLength(0)

    // Re-pushing everything from a stale replica doesn't revive it either.
    server.push([{ ...item, version: '0000000000-0000-old' }])
    await syncB.sync()
    expect(b.get(item.id)?.deleted).toBe(true)
  })

  it('keeps edits made during a sync queued for the next one', async () => {
    const server = new MemorySyncServer()
    const repo = memoryRepo()
    const item = newItem({ text: 'v1' })
    repo.saveItems([item])
    const pending = repo.pendingChanges()
    repo.saveItems([{ ...item, text: 'v2' }]) // edited after pending was read
    repo.acknowledge(server.push(pending).accepted)
    expect(repo.pendingChanges().map((i) => i.text)).toEqual(['v2'])
  })
})
