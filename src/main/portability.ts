import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backup, type DatabaseSync } from 'node:sqlite'
import { todayISO } from '@shared/dates'
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, markdownFiles, backupJSON as serializeBackup } from '@shared/portability'
import type { Item } from '@shared/types'
import type { Repository } from '@shared/repository'

/**
 * The Mac's half of export, import and automatic backups: the filesystem around
 * `core/portability`, which the iPhone shares. Users are never locked in.
 */

export { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, groupByDate } from '@shared/portability'

/** Writes `<dir>/<year>/<date>.md` for every day with content. Returns the file count. */
export function exportMarkdown(repo: Repository, dir: string): number {
  const files = markdownFiles(repo.allItems())
  for (const file of files) {
    const path = join(dir, file.path)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.text, 'utf8')
  }
  return files.length
}

export function backupJSON(repo: Repository): string {
  return serializeBackup(repo.deviceId, repo.allItems({ includeDeleted: true }))
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

/**
 * One consistent snapshot per day in `<dir>`, keeping the most recent `keep`. SQLite
 * copies the pages on a worker thread, a hundred at a time, so saves are never stuck
 * behind it. The copy is written under a temporary name, so one cut short never passes
 * for a backup.
 */
export async function runDailyBackup(db: DatabaseSync, dir: string, keep = 14): Promise<string | null> {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `cue-${todayISO()}.sqlite`)
  let created: string | null = null
  if (!existsSync(file)) {
    const partial = `${file}.partial`
    rmSync(partial, { force: true })
    await backup(db, partial, { rate: 100 })
    renameSync(partial, file)
    created = file
  }
  const names = readdirSync(dir)
  const backups = names.filter((f) => /^cue-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort()
  const leftovers = names.filter((f) => f.endsWith('.sqlite.partial'))
  for (const old of [...backups.slice(0, Math.max(0, backups.length - keep)), ...leftovers]) {
    rmSync(join(dir, old), { force: true })
  }
  return created
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8')
}
