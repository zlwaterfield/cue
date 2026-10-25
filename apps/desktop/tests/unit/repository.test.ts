import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { backupJSON, importJSON } from '../../src/main/portability'
import { Repository } from '@shared/repository'
import { memoryRepo, newItem, tempDir } from './helpers'

describe('Repository', () => {
  it('saves, stamps versions, and loads by date', () => {
    const repo = memoryRepo()
    const a = newItem({ text: 'Buy milk', type: 'todo' })
    const b = newItem({ date: '2026-10-18', text: 'Tomorrow thing' })
    const saved = repo.saveItems([a, b])
    expect(saved).toHaveLength(2)
    expect(saved[0].version > '').toBe(true)
    expect(saved[1].version > saved[0].version).toBe(true)
    expect(repo.loadDates(['2026-10-17']).map((i) => i.text)).toEqual(['Buy milk'])
    expect(repo.loadDates(['2026-10-17', '2026-10-18'])).toHaveLength(2)
  })

  it('records every local write in the outbox and skips no-op saves', () => {
    const repo = memoryRepo()
    const a = newItem()
    repo.saveItems([a])
    expect(repo.saveItems([a])).toHaveLength(0)
    repo.saveItems([{ ...a, text: 'changed' }])
    const pending = repo.pendingChanges()
    expect(pending).toHaveLength(1)
    expect(pending[0].text).toBe('changed')
    repo.acknowledge([{ id: a.id, version: pending[0].version }])
    expect(repo.pendingChanges()).toHaveLength(0)
  })

  it('keeps tombstones instead of deleting rows', () => {
    const repo = memoryRepo()
    const a = newItem()
    repo.saveItems([a])
    repo.saveItems([{ ...a, deleted: true }])
    expect(repo.loadDates([a.date])).toHaveLength(0)
    expect(repo.get(a.id)?.deleted).toBe(true)
    expect(repo.search('hello')).toHaveLength(0)
  })

  it('searches case- and accent-insensitively across all days, newest first', () => {
    const repo = memoryRepo()
    repo.saveItems([
      newItem({ date: '2025-01-02', text: 'Lunch at the Café' }),
      newItem({ date: '2026-10-17', text: 'CAFE meeting notes', type: 'todo', done: true }),
      newItem({ date: '2026-10-17', text: 'unrelated' })
    ])
    const results = repo.search('cafe')
    expect(results.map((r) => r.date)).toEqual(['2026-10-17', '2025-01-02'])
    expect(results[0]).toMatchObject({ type: 'todo', done: true })
    expect(repo.search('meeting cafe')).toHaveLength(1)
    expect(repo.search('   ')).toHaveLength(0)
  })

  it('lists the days with an unfinished to-do, oldest first', () => {
    const repo = memoryRepo()
    const gone = newItem({ date: '2026-10-12', type: 'todo', text: 'deleted' })
    repo.saveItems([
      newItem({ date: '2026-10-15', type: 'todo', text: 'open' }),
      newItem({ date: '2026-10-15', type: 'todo', text: 'open too' }),
      newItem({ date: '2026-10-10', type: 'todo', text: 'open, nested', parentId: 'p' }),
      newItem({ date: '2026-10-13', type: 'todo', text: 'done', done: true }),
      newItem({ date: '2026-10-14', type: 'bullet', text: 'not a to-do' }),
      newItem({ date: '2026-10-20', type: 'todo', text: 'after the range' }),
      gone
    ])
    repo.saveItems([{ ...gone, deleted: true }])
    expect(repo.datesWithOpenTodos('2026-10-01', '2026-10-19')).toEqual(['2026-10-10', '2026-10-15'])
    expect(repo.datesWithOpenTodos('2026-10-11', '2026-10-14')).toEqual([])
  })

  it('shows earlier to-dos on Today unless turned off, and keeps the choice', () => {
    const repo = memoryRepo()
    expect(repo.getSettings().looseEnds).toBe(true)
    repo.setSettings({ looseEnds: false })
    expect(repo.getSettings()).toEqual({ theme: 'system', weekStartsOn: 1, looseEnds: false })
    repo.setMeta('settings', JSON.stringify({ theme: 'dark', looseEnds: 'yes' }))
    expect(repo.getSettings()).toEqual({ theme: 'dark', weekStartsOn: 1, looseEnds: true })
  })

  it('skips malformed records without blocking the rest of the batch', () => {
    const repo = memoryRepo()
    const good = newItem({ text: 'still saved' })
    const saved = repo.saveItems([{ ...newItem(), date: '2026-13-01' }, good, { ...newItem(), type: 'heading' }])
    expect(saved.map((i) => i.text)).toEqual(['still saved'])
    expect(repo.allItems()).toHaveLength(1)
  })

  it('ignores remote records with malformed versions', () => {
    const repo = memoryRepo()
    const [saved] = repo.saveItems([newItem({ text: 'mine' })])
    expect(repo.applyRemote([{ ...saved, text: 'pinned', version: 'zzzzzzzzzzzzzz' }]).applied).toHaveLength(0)
    expect(repo.get(saved.id)?.text).toBe('mine')
  })

  it('applies remote records with last-write-wins and never resurrects', () => {
    const repo = memoryRepo()
    const a = newItem({ text: 'local' })
    const [saved] = repo.saveItems([a])
    // An older remote version loses.
    expect(repo.applyRemote([{ ...saved, text: 'stale', version: '0000000001-0000-zzz' }]).applied).toHaveLength(0)
    // A newer remote tombstone wins…
    const tomb = { ...saved, deleted: true, version: saved.version.replace(/^./, 'z') }
    expect(repo.applyRemote([tomb]).applied).toHaveLength(1)
    // …and the older live copy cannot bring it back.
    repo.applyRemote([{ ...saved }])
    expect(repo.get(a.id)?.deleted).toBe(true)
    // Applying the same batch twice is a no-op.
    expect(repo.applyRemote([tomb]).applied).toHaveLength(0)
    // Local writes after observing a remote version are newer still.
    const [after] = repo.saveItems([{ ...tomb, deleted: false, text: 'restored' }])
    expect(after.version > tomb.version).toBe(true)
  })

  it('persists across restarts', () => {
    const file = join(tempDir(), 'cue.sqlite')
    const first = new Repository(openDatabase(file))
    const a = newItem({ text: 'survives restart' })
    const [saved] = first.saveItems([a])
    const deviceId = first.deviceId
    const second = new Repository(openDatabase(file))
    expect(second.deviceId).toBe(deviceId)
    expect(second.get(a.id)?.text).toBe('survives restart')
    const [next] = second.saveItems([{ ...a, text: 'edited' }])
    expect(next.version > saved.version).toBe(true)
  })

  it('round-trips a JSON backup without duplicating or resurrecting', () => {
    const repo = memoryRepo()
    const live = newItem({ text: 'keep' })
    const gone = newItem({ text: 'gone' })
    repo.saveItems([live, gone])
    const backup = backupJSON(repo)
    repo.saveItems([{ ...gone, deleted: true }])

    expect(importJSON(repo, backup).applied).toHaveLength(0)
    expect(repo.loadDates([live.date]).map((i) => i.text)).toEqual(['keep'])

    const fresh = memoryRepo()
    expect(importJSON(fresh, backup).applied).toHaveLength(2)
    expect(importJSON(fresh, backup).applied).toHaveLength(0)
    expect(() => importJSON(fresh, '{"format":"other"}')).toThrow(/not a Cue backup/)
  })

  it('stays fast with years of data', () => {
    const repo = memoryRepo()
    const items = []
    const start = Date.UTC(2021, 0, 1)
    for (let d = 0; d < 365 * 5; d++) {
      const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10)
      for (let i = 0; i < 25; i++) items.push(newItem({ date, text: `day ${d} item ${i} lorem ipsum dolor` }))
    }
    repo.saveItems(items)
    let t = performance.now()
    const results = repo.search('item 7 lorem')
    const searchMs = performance.now() - t
    t = performance.now()
    repo.loadDates(['2024-06-01', '2024-06-02', '2024-06-03', '2024-06-04', '2024-06-05', '2024-06-06', '2024-06-07'])
    const loadMs = performance.now() - t
    expect(results.length).toBeGreaterThan(0)
    expect(searchMs).toBeLessThan(150)
    expect(loadMs).toBeLessThan(20)
  }, 60_000)
})
