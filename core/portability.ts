import { dayToMarkdown } from './markdown'
import type { Item } from './types'

/**
 * What export is, without a filesystem: the Markdown tree, and the backup's JSON. The Mac
 * writes these to a folder and a file (`main/portability`); the iPhone puts the same tree
 * in a zip and hands both to the share sheet (`mobile/core/export`). Users are never
 * locked in, on either one.
 */

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

export interface ExportFile {
  /** `<year>/<date>.md`, oldest first. */
  path: string
  text: string
}

/** One Markdown file per day that has anything on it, oldest first. */
export function markdownFiles(items: Item[]): ExportFile[] {
  const files: ExportFile[] = []
  for (const [date, day] of [...groupByDate(items)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!day.some((i) => i.text.trim() !== '')) continue
    files.push({ path: `${date.slice(0, 4)}/${date}.md`, text: dayToMarkdown(date, day) })
  }
  return files
}

/**
 * The backup file's contents. Tombstones are included so restoring a backup can never
 * resurrect deletions.
 */
export function backupJSON(deviceId: string, items: Item[]): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      app: 'Cue',
      exportedAt: new Date().toISOString(),
      deviceId,
      items
    },
    null,
    2
  )
}
