import { useState } from 'react'
import { Alert } from 'react-native'
import { exportBackup, exportMarkdown, type ExportResult } from '../../core/export'
import { Row, Section, SettingsScreen } from '../../ui/SettingsList'

/**
 * Taking your notes with you. The Mac writes a folder you choose and can import one back;
 * a phone has nowhere to write, so both exports go to the share sheet (`core/export`).
 */
export default function Data() {
  const [exporting, setExporting] = useState(false)

  // Nothing to say when it works: the share sheet already showed up, and cancelling it
  // isn't a failure either.
  const runExport = async (run: () => Promise<ExportResult>): Promise<void> => {
    setExporting(true)
    const result = await run()
    setExporting(false)
    if (result.ok) return
    if (result.empty) Alert.alert('Nothing to export yet', 'Write something first, and it will be here.')
    else Alert.alert('Couldn’t export', result.error ?? 'Please try again.')
  }

  return (
    <SettingsScreen title="Your data">
      <Section title="Export" footnote="Markdown is one file per day, in a zip. The backup is everything, in the file the Mac imports.">
        <Row label="Export as Markdown…" onPress={() => void runExport(exportMarkdown)} disabled={exporting} />
        <Row label="Export a Backup…" onPress={() => void runExport(exportBackup)} disabled={exporting} />
      </Section>
    </SettingsScreen>
  )
}
