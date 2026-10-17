import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { exportMarkdown, runDailyBackup } from '../../src/main/portability'
import { Repository } from '../../src/main/repository'
import { todayISO } from '../../src/shared/dates'
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
})

describe('daily backups', () => {
  it('snapshots once per day and keeps a bounded history', () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'cue.sqlite'))
    new Repository(db).saveItems([newItem({ text: 'backed up' })])
    const backups = join(dir, 'Backups')
    expect(runDailyBackup(db, backups, 3)).toMatch(new RegExp(`cue-${todayISO()}\\.sqlite$`))
    expect(runDailyBackup(db, backups, 3)).toBeNull()
    for (const day of ['2020-01-01', '2020-01-02', '2020-01-03']) writeFileSync(join(backups, `cue-${day}.sqlite`), '')
    runDailyBackup(db, backups, 3)
    expect(readdirSync(backups).sort()).toEqual(['cue-2020-01-02.sqlite', 'cue-2020-01-03.sqlite', `cue-${todayISO()}.sqlite`])
    const restored = new Repository(openDatabase(join(backups, `cue-${todayISO()}.sqlite`)))
    expect(restored.allItems().map((i) => i.text)).toEqual(['backed up'])
  })
})
