import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { backupJSON, exportMarkdown, runDailyBackup } from '../../src/main/portability'
import { markdownFiles } from '@shared/portability'
import { Repository } from '@shared/repository'
import { todayISO } from '@shared/dates'
import { memoryRepo, newItem, tempDir } from './helpers'

describe('export', () => {
  it('writes one Markdown file per day, organized by year', () => {
    const repo = memoryRepo()
    const parent = newItem({ date: '2026-10-17', type: 'todo', text: 'Ship it', position: 'a0' })
    repo.saveItems([
      newItem({ date: '2026-10-17', type: 'text', text: 'Morning notes', position: 'Zz' }),
      parent,
      newItem({ date: '2026-10-17', type: 'bullet', text: 'changelog', parentId: parent.id, position: 'a0' }),
      newItem({ date: '2025-01-02', type: 'todo', done: true, text: 'Old thing' }),
      newItem({ date: '2025-01-03', type: 'text', text: '   ' })
    ])
    const dir = tempDir()
    expect(exportMarkdown(repo, dir)).toBe(2)
    expect(readFileSync(join(dir, '2026', '2026-10-17.md'), 'utf8')).toBe(
      '# Saturday, October 17, 2026\n\nMorning notes\n\n- [ ] Ship it\n  - changelog\n'
    )
    expect(readFileSync(join(dir, '2025', '2025-01-02.md'), 'utf8')).toContain('- [x] Old thing')
    expect(existsSync(join(dir, '2025', '2025-01-03.md'))).toBe(false)
  })

  // The iPhone has no folder to write to: it zips these same files instead.
  it('names the same files for a device without folders', () => {
    const repo = memoryRepo()
    repo.saveItems([
      newItem({ date: '2026-10-17', type: 'text', text: 'Morning notes' }),
      newItem({ date: '2025-01-02', type: 'todo', done: true, text: 'Old thing' }),
      newItem({ date: '2025-01-03', type: 'text', text: '   ' })
    ])
    expect(markdownFiles(repo.allItems()).map((f) => f.path)).toEqual(['2025/2025-01-02.md', '2026/2026-10-17.md'])
  })

  it('backs up tombstones, so a restore cannot resurrect them', () => {
    const repo = memoryRepo()
    const gone = newItem({ date: '2026-10-17', text: 'Deleted later' })
    repo.saveItems([gone, newItem({ date: '2026-10-17', text: 'Still here' })])
    repo.saveItems([{ ...repo.get(gone.id)!, deleted: true }])
    const parsed = JSON.parse(backupJSON(repo))
    expect(parsed.format).toBe('cue.backup')
    expect(parsed.deviceId).toBe(repo.deviceId)
    expect(parsed.items.filter((i: { deleted: boolean }) => i.deleted).map((i: { id: string }) => i.id)).toEqual([gone.id])
    expect(repo.allItems().map((i: { text: string }) => i.text)).toEqual(['Still here'])
  })
})

describe('daily backups', () => {
  it('snapshots once per day and keeps a bounded history', async () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'cue.sqlite'))
    const repo = new Repository(db)
    repo.saveItems(Array.from({ length: 2000 }, (_, i) => newItem({ text: `backed up ${i}` })))
    const backups = join(dir, 'Backups')
    expect(await runDailyBackup(db, backups, 3)).toMatch(new RegExp(`cue-${todayISO()}\\.sqlite$`))
    expect(await runDailyBackup(db, backups, 3)).toBeNull()
    for (const day of ['2020-01-01', '2020-01-02', '2020-01-03']) writeFileSync(join(backups, `cue-${day}.sqlite`), '')
    await runDailyBackup(db, backups, 3)
    expect(readdirSync(backups).sort()).toEqual(['cue-2020-01-02.sqlite', 'cue-2020-01-03.sqlite', `cue-${todayISO()}.sqlite`])
    const restored = new Repository(openDatabase(join(backups, `cue-${todayISO()}.sqlite`)))
    expect(restored.allItems()).toHaveLength(2000)
    expect(restored.allItems().map((i) => i.text)).toEqual(repo.allItems().map((i) => i.text))
  })

  it('never leaves a half-written backup behind', async () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'cue.sqlite'))
    new Repository(db).saveItems([newItem({ text: 'backed up' })])
    const backups = join(dir, 'Backups')
    mkdirSync(backups)
    // Left by a backup cut short: today's, and an older day's.
    writeFileSync(join(backups, `cue-${todayISO()}.sqlite.partial`), 'half')
    writeFileSync(join(backups, 'cue-2020-01-01.sqlite.partial'), 'half')
    await runDailyBackup(db, backups)
    expect(readdirSync(backups)).toEqual([`cue-${todayISO()}.sqlite`])
    expect(new Repository(openDatabase(join(backups, `cue-${todayISO()}.sqlite`))).allItems().map((i) => i.text)).toEqual(['backed up'])
  })

  it('lets the app quit while a backup is still copying', async () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'cue.sqlite'))
    new Repository(db).saveItems(Array.from({ length: 5000 }, (_, i) => newItem({ text: `line ${i} with some words in it` })))
    const running = runDailyBackup(db, join(dir, 'Backups'))
    expect(() => db.close()).not.toThrow()
    await running.catch(() => {})
  })
})
