import { dayToMarkdown } from './markdown'
import { isNotePage, noteTitle, SCRATCH } from './notes'
import { buildOutline } from './outline'
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
  /** `<year>/<date>.md`, oldest first; then a note as `Notes/<its name>.md`. */
  path: string
  text: string
}

/** One Markdown file per day that has anything on it, oldest first, then one per note. */
export function markdownFiles(items: Item[]): ExportFile[] {
  const files: ExportFile[] = []
  const notes: Array<[string, Item[]]> = []
  for (const [date, day] of [...groupByDate(items)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!day.some((i) => i.text.trim() !== '')) continue
    if (isNotePage(date)) notes.push([date, day])
    else files.push({ path: `${date.slice(0, 4)}/${date}.md`, text: dayToMarkdown(date, day) })
  }
  const names = new Set<string>()
  for (const [date, page] of notes) {
    const live = page.filter((i) => !i.deleted)
    const source = { outline: () => buildOutline(live), get: (id: string) => live.find((i) => i.id === id) }
    const title = noteTitle(source, date)
    // A name a file can have, and its own: two notes called the same get "Name 2".
    const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled'
    let name = base
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} ${n}`
    names.add(name.toLowerCase())
    // A starred note's first line is its name, so it becomes the file's heading rather than repeating under it.
    const first = date === SCRATCH ? undefined : live.find((i) => i.id === buildOutline(live)[0]?.id)
    const body = first?.type === 'text' ? live.filter((i) => i !== first) : live
    files.push({ path: `Notes/${name}.md`, text: dayToMarkdown(date, body).replace(/^# .*$/m, `# ${title}`) })
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
