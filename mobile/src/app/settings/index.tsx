import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { SvgXml } from 'react-native-svg'
import { statusLine } from '@shared/sync/status'
import { sync } from '../../core/app'
import { useStore } from '../../core/store'
import { ui } from '../../core/ui'
import { lockup } from '../../ui/lockup'
import { Row, Section, styles } from '../../ui/SettingsList'
import { SheetTitle } from '../../ui/Sheet'
import { useColors } from '../../ui/theme'

const THEMES = { system: 'System', light: 'Light', dark: 'Dark' } as const

/**
 * The categories, with each one's state beside it, and what sync is doing underneath.
 * Sync is missing from builds without a sync server, as on the Mac.
 */
export default function Settings() {
  const c = useColors()
  const state = useStore(sync.state, (s) => s)
  const theme = useStore(ui, (s) => s.settings.theme)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  const version = Constants.expoConfig?.version ?? '1.0.0'
  const footnote = state.needsSignIn
    ? (state.message ?? undefined)
    : state.email
      ? statusLine(state, now)
      : 'Your notes are stored only on this iPhone. Turn on sync to keep them on your other devices too.'

  return (
    <ScrollView contentContainerStyle={styles.sheet}>
      <SheetTitle title="Settings" />

      <Section footnote={state.available ? footnote : undefined}>
        <Row label="General" value={THEMES[theme]} chevron onPress={() => router.push('/settings/general')} testID="settings-general" />
        {state.available && (
          <Row
            label="Sync"
            value={state.email ?? (state.needsSignIn ? 'Sign in' : 'Off')}
            chevron
            onPress={() => router.push('/settings/sync')}
            testID="settings-sync"
          />
        )}
        <Row label="About & Help" chevron onPress={() => router.push('/settings/about')} testID="settings-about" />
      </Section>

      <View style={styles.about}>
        <SvgXml xml={lockup(c.text3)} width={56} height={28} />
        <Text style={[styles.version, { color: c.text2 }]}>Version {version} · beta</Text>
      </View>
    </ScrollView>
  )
}
