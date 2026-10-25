import type { Settings } from '@shared/types'
import { updateSettings } from '../../core/app'
import { useStore } from '../../core/store'
import { ui } from '../../core/ui'
import { Section, Segmented, SettingsScreen } from '../../ui/SettingsList'

/** Appearance and the week: the Mac's General pane, in the same order. */
export default function General() {
  const settings = useStore(ui, (s) => s.settings)
  return (
    <SettingsScreen title="General">
      <Section title="Appearance" footnote="Follows your iPhone unless you choose otherwise.">
        <Segmented<Settings['theme']>
          value={settings.theme}
          options={[
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark']
          ]}
          onChange={(theme) => updateSettings({ theme })}
        />
      </Section>

      <Section title="Week starts on">
        <Segmented<Settings['weekStartsOn']>
          value={settings.weekStartsOn}
          options={[
            [1, 'Monday'],
            [0, 'Sunday']
          ]}
          onChange={(weekStartsOn) => updateSettings({ weekStartsOn })}
        />
      </Section>

      <Section title="Earlier to-dos on Today" footnote="Today starts with the to-dos you didn’t finish in the last 30 days, folded into one line.">
        <Segmented<boolean>
          value={settings.looseEnds}
          options={[
            [true, 'Show'],
            [false, 'Hide']
          ]}
          onChange={(looseEnds) => updateSettings({ looseEnds })}
        />
      </Section>
    </SettingsScreen>
  )
}
