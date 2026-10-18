import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { todayISO } from '../shared/dates'
import { dayToMarkdown } from '../shared/markdown'
import type { Item } from '../shared/types'
import type { Repository } from '../shared/repository'

/** Export, import, and automatic backups. Users are never locked in. */

export const BACKUP_FORMAT = 'cue.backup'
export const BACKUP_FORMAT_VERSION = 1

export function groupByDate(items: Item[]): Map<string, Item[]> {
  const byDate = new Map<string, Item[]>()
  for (const item of items) {
    const list = byDate.get(item.date)
    if (list) list.push(item)
    else byDate.set(item.date, [item])
  }
  return byDate
}

/** Writes `<dir>/<year>/<date>.md` for every day with content. Returns the file count. */
export function exportMarkdown(repo: Repository, dir: string): number {
  const byDate = groupByDate(repo.allItems())
  let count = 0
  for (const [date, items] of [...byDate].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!items.some((i) => i.text.trim() !== '')) continue
    const yearDir = join(dir, date.slice(0, 4))
    mkdirSync(yearDir, { recursive: true })
    writeFileSync(join(yearDir, `${date}.md`), dayToMarkdown(date, items), 'utf8')
    count += 1
  }
  return count
}

export function backupJSON(repo: Repository): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      app: 'Cue',
      exportedAt: new Date().toISOString(),
      deviceId: repo.deviceId,
      // Tombstones are included so restoring a backup can never resurrect deletions.
      items: repo.allItems({ includeDeleted: true })
    },
    null,
    2
  )
}

export function importJSON(repo: Repository, json: string): { applied: Item[]; skipped: number } {
  let parsed: { format?: string; formatVersion?: number; items?: unknown }
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (parsed.format !== BACKUP_FORMAT || !Array.isArray(parsed.items)) {
    throw new Error('That file is not a Cue backup.')
  }
  if ((parsed.formatVersion ?? 0) > BACKUP_FORMAT_VERSION) {
    throw new Error('That backup was made by a newer version of Cue.')
  }
  // Same merge path as sync: newer versions win, so importing is idempotent and safe.
  // Imported records are uploaded like local edits if sync is on.
  return repo.applyRemote(parsed.items, { upload: true })
}

/** One consistent snapshot per day in `<dir>`, keeping the most recent `keep`. */
export function runDailyBackup(db: DatabaseSync, dir: string, keep = 14): string | null {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `cue-${todayISO()}.sqlite`)
  let created: string | null = null
  if (!existsSync(file)) {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    created = file
  }
  const backups = readdirSync(dir)
    .filter((f) => /^cue-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    rmSync(join(dir, old), { force: true })
  }
  return created
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8')
}
