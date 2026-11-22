import { dayToMarkdown } from './markdown'
import { isNotePage, noteTitle, SCRATCH, soleNote } from './notes'
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

/**
 * One Markdown file per day that has anything on it, oldest first, then one per note. A line
 * that links to a note (`soleNote`) becomes a Markdown link to that note's file.
 */
export function markdownFiles(items: Item[]): ExportFile[] {
  const days: Array<[string, Item[]]> = []
  const notes: Array<{ date: string; page: Item[]; title: string; name: string }> = []
  const names = new Set<string>()
  for (const [date, day] of [...groupByDate(items)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!day.some((i) => i.text.trim() !== '')) continue
    if (!isNotePage(date)) {
      days.push([date, day])
      continue
    }
    const page = day.filter((i) => !i.deleted)
    const source = { outline: () => buildOutline(page), get: (id: string) => page.find((i) => i.id === id) }
    const title = noteTitle(source, date)
    // A name a file can have, and its own: two notes called the same get "Name 2".
    const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled'
    let name = base
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} ${n}`
    names.add(name.toLowerCase())
    notes.push({ date, page, title, name })
  }

  const byPage = new Map(notes.map((note) => [note.date, note]))
  // Every file is one folder down (`2026/…`, `Notes/…`), so a note's file is the same path from each.
  const linked = (list: Item[]): Item[] =>
    list.map((item) => {
      const note = byPage.get(soleNote(item.text) ?? '')
      return note ? { ...item, text: `[${note.title.replace(/[[\]\\]/g, '\\$&')}](../Notes/${fileLink(note.name)}.md)` } : item
    })

  const files: ExportFile[] = days.map(([date, day]) => ({ path: `${date.slice(0, 4)}/${date}.md`, text: dayToMarkdown(date, linked(day)) }))
  for (const { date, page, title, name } of notes) {
    // A starred note's first line is its name, so it becomes the file's heading rather than repeating under it.
    const first = date === SCRATCH ? undefined : page.find((i) => i.id === buildOutline(page)[0]?.id)
    const body = first?.type === 'text' ? page.filter((i) => i !== first) : page
    files.push({ path: `Notes/${name}.md`, text: dayToMarkdown(date, linked(body)).replace(/^# .*$/m, `# ${title}`) })
  }
  return files
}

/** A file name in a Markdown link: parentheses too, which would end the link early. */
function fileLink(name: string): string {
  return encodeURIComponent(name).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
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
