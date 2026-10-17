import { afterEach, describe, expect, it, vi } from 'vitest'
import { SyncEngine, type EngineTiming } from '../../src/main/sync/engine'
import { MemorySyncServer } from '../../src/main/sync/memoryServer'
import type { Repository } from '../../src/main/repository'
import type { Item } from '../../src/shared/types'
import { memoryRepo, newItem } from './helpers'

function visible(items: Item[]) {
  return items
    .filter((i) => !i.deleted)
    .map((i) => `${i.date}|${i.parentId ?? '-'}|${i.position}|${i.type}|${i.done}|${i.text}`)
    .sort()
}

function device(server: MemorySyncServer, timing: Partial<EngineTiming> = {}) {
  const repo = memoryRepo()
  const received: Item[] = []
  const engine = new SyncEngine(repo, server.transport(), { onRemoteChanges: (items) => received.push(...items) }, timing)
  return { repo, engine, received }
}

describe('sync convergence', () => {
  it('converges two offline replicas without losing or duplicating items', async () => {
    const server = new MemorySyncServer()
    const desktop = device(server, { batchSize: 3 })
    const phone = device(server, { batchSize: 3 })

    const shared = newItem({ text: 'Plan trip' })
    desktop.repo.saveItems([shared])
    await desktop.engine.sync()
    await phone.engine.sync()
    expect(phone.repo.get(shared.id)?.text).toBe('Plan trip')

    // Both go offline and edit.
    server.online = false
    desktop.repo.saveItems(Array.from({ length: 5 }, (_, i) => newItem({ text: `desktop ${i}` })))
    desktop.repo.saveItems([newItem({ date: '2026-10-23', text: 'Created offline, moved to Friday' })])
    phone.repo.saveItems([newItem({ text: 'phone note' })])
    await expect(desktop.engine.sync()).rejects.toThrow()
    expect(desktop.engine.status).toBe('offline')

    // Conflicting edits to the same item: the later write wins on every replica.
    phone.repo.saveItems([{ ...phone.repo.get(shared.id)!, text: 'Plan trip (phone)' }])
    await new Promise((r) => setTimeout(r, 5))
    desktop.repo.saveItems([{ ...desktop.repo.get(shared.id)!, done: true, type: 'todo', text: 'Plan trip (desktop)' }])

    server.online = true
    await phone.engine.sync()
    await desktop.engine.sync()
    await phone.engine.sync()

    const a = visible(desktop.repo.allItems())
    expect(a).toEqual(visible(phone.repo.allItems()))
    expect(a).toHaveLength(1 + 5 + 1 + 1)
    expect(phone.repo.get(shared.id)?.text).toBe('Plan trip (desktop)')
    expect(phone.repo.loadDates(['2026-10-23']).map((i) => i.text)).toEqual(['Created offline, moved to Friday'])
    expect(desktop.repo.pendingCount()).toBe(0)
    expect(phone.repo.pendingCount()).toBe(0)
    await Promise.all([desktop.engine.stop(), phone.engine.stop()])
  })

  it('propagates deletions and never resurrects them', async () => {
    const server = new MemorySyncServer()
    const a = device(server)
    const b = device(server)

    const item = newItem({ text: 'to delete' })
    a.repo.saveItems([item])
    await a.engine.sync()
    await b.engine.sync()

    // B deletes while A (stale) still has the live copy and re-syncs.
    b.repo.saveItems([{ ...b.repo.get(item.id)!, deleted: true }])
    await b.engine.sync()
    await a.engine.sync()
    expect(a.repo.get(item.id)?.deleted).toBe(true)
    expect(a.repo.loadDates([item.date])).toHaveLength(0)

    // Re-pushing an old copy from a stale replica doesn't revive it either.
    server.push([{ ...item, version: '0000000000-0000-old' }])
    await b.engine.sync()
    expect(b.repo.get(item.id)?.deleted).toBe(true)
  })

  it('keeps edits made during a push queued for the next one', async () => {
    const server = new MemorySyncServer()
    const { repo, engine } = device(server)
    const item = newItem({ text: 'v1' })
    repo.saveItems([item])
    const transport = server.transport()
    const slow = new SyncEngine(repo, {
      ...transport,
      push: async (records) => {
        repo.saveItems([{ ...item, text: 'v2' }]) // typed while the request was in flight
        return transport.push(records)
      }
    })
    await slow.sync()
    expect(repo.pendingChanges().map((i) => i.text)).toEqual(['v2'])
    await engine.sync()
    expect(server.snapshot().map((i) => i.text)).toEqual(['v2'])
  })

  it('converges three devices under random offline edits', async () => {
    const random = seeded(42)
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]
    const server = new MemorySyncServer()
    const devices = Array.from({ length: 3 }, () => device(server, { batchSize: 4 }))
    const online = devices.map(() => true)
    // The winning write for each id is the one with the highest version.
    const latest = new Map<string, Item>()
    const record = (saved: Item[]) => {
      for (const item of saved) if ((latest.get(item.id)?.version ?? '') < item.version) latest.set(item.id, item)
    }

    for (let step = 0; step < 400; step++) {
      const index = Math.floor(random() * devices.length)
      const { repo, engine } = devices[index]
      const roll = random()
      const items = repo.allItems()
      if (roll < 0.1) {
        online[index] = !online[index]
      } else if (roll < 0.3) {
        server.online = online[index]
        await engine.sync().catch(() => {})
      } else if (roll < 0.5 || !items.length) {
        const parent = items.length && random() < 0.3 ? pick(items) : null
        record(repo.saveItems([newItem({ text: `n${step}`, parentId: parent?.id ?? null, date: parent?.date })]))
      } else {
        const target = pick(items)
        const edits: Array<Partial<Item>> = [
          { text: `edit ${step}` },
          { done: !target.done, type: 'todo' },
          { deleted: !target.deleted },
          { date: pick(['2026-10-17', '2026-10-18', '2026-10-23']), parentId: null },
          { parentId: pick(items).id === target.id ? null : pick(items).id }
        ]
        record(repo.saveItems([{ ...target, ...pick(edits) }]))
      }
    }

    server.online = true
    for (let round = 0; round < 2; round++) for (const d of devices) await d.engine.sync()

    const expected = [...latest.values()].map(({ id, version, text, deleted, done, date, parentId }) => ({ id, version, text, deleted, done, date, parentId }))
    const sort = (list: typeof expected) => list.sort((a, b) => (a.id < b.id ? -1 : 1))
    for (const { repo } of devices) {
      const actual = repo.allItems({ includeDeleted: true }).map(({ id, version, text, deleted, done, date, parentId }) => ({ id, version, text, deleted, done, date, parentId }))
      expect(sort(actual)).toEqual(sort([...expected]))
      expect(repo.pendingCount()).toBe(0)
    }
  })
})

describe('sync scheduling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

  it('turns a burst of typing into one push once typing pauses', async () => {
    fakeTimers()
    const server = new MemorySyncServer()
    const { repo, engine } = device(server, { debounce: 600, maxWait: 3000 })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    const before = server.requests

    const item = newItem({ text: '' })
    for (let i = 1; i <= 10; i++) {
      repo.saveItems([{ ...item, text: 'x'.repeat(i) }])
      engine.localChange()
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(server.requests).toBe(before)
    await vi.advanceTimersByTimeAsync(600)
    expect(server.requests).toBe(before + 1)
    expect(server.snapshot()[0].text).toBe('x'.repeat(10))
    await engine.stop()
  })

  it('still pushes every few seconds during continuous typing', async () => {
    fakeTimers()
    const server = new MemorySyncServer()
    const { repo, engine } = device(server, { debounce: 600, maxWait: 3000 })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    const before = server.requests
    const item = newItem({ text: '' })
    for (let i = 1; i <= 70; i++) {
      repo.saveItems([{ ...item, text: 'x'.repeat(i) }])
      engine.localChange()
      await vi.advanceTimersByTimeAsync(100)
    }
    // 7 seconds of typing: pushed at ~3s and ~6s without waiting for a pause.
    expect(server.requests - before).toBe(2)
    await engine.stop()
  })

  it('never pulls back its own changes', async () => {
    const server = new MemorySyncServer()
    const { repo, engine, received } = device(server)
    // Realtime hints go to every device, including the one that pushed.
    server.subscribe((seq) => engine.remoteChange(seq))
    await engine.sync()

    const start = server.requests
    repo.saveItems([newItem({ text: 'mine' })])
    await engine.flush()
    await engine.flush() // the run queued by the echoed hint
    expect(server.requests - start).toBe(1)
    expect(received).toHaveLength(0)
  })

  it('pulls as soon as another device pushes', async () => {
    const server = new MemorySyncServer()
    const desktop = device(server)
    const phone = device(server)
    server.subscribe((seq) => desktop.engine.remoteChange(seq))
    await desktop.engine.sync()

    phone.repo.saveItems([newItem({ text: 'from phone' })])
    await phone.engine.sync()
    await vi.waitFor(() => expect(desktop.received.map((i) => i.text)).toEqual(['from phone']))
  })

  it('backs off while offline, then recovers without losing anything', async () => {
    fakeTimers()
    const server = new MemorySyncServer()
    const { repo, engine } = device(server, { backoff: 1000, maxBackoff: 8000 })
    server.online = false
    repo.saveItems([newItem({ text: 'written offline' })])
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.status).toBe('offline')

    // Typing while offline doesn't add requests; the retry timer owns the schedule.
    const afterFirst = server.requests
    for (let i = 0; i < 20; i++) {
      repo.saveItems([newItem({ text: `more ${i}` })])
      engine.localChange()
    }
    await vi.advanceTimersByTimeAsync(30_000)
    // Retries at ~1, 2, 4, 8, 8, 8 s: a handful, not one per keystroke.
    expect(server.requests - afterFirst).toBeGreaterThanOrEqual(3)
    expect(server.requests - afterFirst).toBeLessThanOrEqual(7)
    expect(engine.status).toBe('offline')

    server.online = true
    await vi.advanceTimersByTimeAsync(10_000)
    expect(engine.status).toBe('idle')
    expect(server.snapshot()).toHaveLength(21)
    expect(repo.pendingCount()).toBe(0)
    await engine.stop()
  })

  it('starts over if the server was reset', async () => {
    const server = new MemorySyncServer()
    const a = device(server)
    a.repo.saveItems([newItem({ text: 'one' }), newItem({ text: 'two' })])
    await a.engine.sync()
    server.reset()

    a.repo.saveItems([newItem({ text: 'three' })])
    await a.engine.sync()
    expect(server.snapshot().map((i) => i.text).sort()).toEqual(['one', 'three', 'two'])
  })

  it('stops cleanly and does nothing afterwards', async () => {
    fakeTimers()
    const server = new MemorySyncServer()
    const { repo, engine } = device(server)
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    await engine.stop()
    const requests = server.requests
    repo.saveItems([newItem()])
    engine.localChange()
    engine.remoteChange(99)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(server.requests).toBe(requests)
    expect(repo.pendingCount()).toBe(1)
  })
})

describe('repository sync support', () => {
  it('queues imported records for upload and everything on joining an account', () => {
    const source: Repository = memoryRepo()
    const saved = source.saveItems([newItem({ text: 'from a backup' })])
    const repo = memoryRepo()
    repo.saveItems([newItem({ text: 'local' })])
    repo.acknowledge(repo.pendingChanges())
    expect(repo.pendingCount()).toBe(0)

    repo.applyRemote(saved, { upload: true })
    expect(repo.pendingChanges().map((i) => i.text)).toEqual(['from a backup'])
    repo.applyRemote([{ ...saved[0], text: 'pulled', version: saved[0].version.replace(/^0/, '1') }])
    expect(repo.pendingCount()).toBe(0)

    repo.queueAll()
    expect(repo.pendingCount()).toBe(2)
  })
})

/** Small deterministic PRNG so the randomized test is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
