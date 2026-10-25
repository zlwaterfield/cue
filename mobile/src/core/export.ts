import { Share } from 'react-native'
import { Directory, File, Paths } from 'expo-file-system'
import { todayISO } from '@shared/dates'
import { backupJSON, markdownFiles } from '@shared/portability'
import { zip } from '@shared/zip'
import { repo } from './app'

/**
 * Taking your notes with you, the same two ways the Mac offers: Markdown, one file per
 * day, and a JSON backup of everything. The Mac writes a folder you choose; an iPhone has
 * no folder to write to, so both go to the share sheet, and Markdown's folder travels as
 * a zip (`shared/zip`). Save to Files, mail it, AirDrop it to the Mac — it's the system
 * sheet, so it's whatever you already use.
 *
 * Exports are built in the cache directory, which iOS may empty whenever it likes. That
 * is the right place for them: the copy that matters is the one the share sheet made.
 */

export type ExportResult = { ok: true; shared: boolean } | { ok: false; empty?: boolean; error?: string }

/** Everything written so far, as `<year>/<date>.md` in one zip. */
export async function exportMarkdown(): Promise<ExportResult> {
  const files = markdownFiles(repo.allItems())
  if (!files.length) return { ok: false, empty: true }
  return write(`Cue Export ${todayISO()}.zip`, zip(files))
}

/** Every item, tombstones included, in the format the Mac imports. */
export async function exportBackup(): Promise<ExportResult> {
  const items = repo.allItems({ includeDeleted: true })
  if (!items.length) return { ok: false, empty: true }
  return write(`Cue Backup ${todayISO()}.json`, backupJSON(repo.deviceId, items))
}

async function write(name: string, contents: string | Uint8Array): Promise<ExportResult> {
  try {
    const folder = new Directory(Paths.cache, 'export')
    if (!folder.exists) folder.create({ intermediates: true })
    const file = new File(folder, name)
    // The name carries today's date, so a second export on the same day lands on the first.
    file.create({ overwrite: true })
    file.writeSync(contents)
    const result = await Share.share({ url: file.uri })
    return { ok: true, shared: result.action === Share.sharedAction }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
