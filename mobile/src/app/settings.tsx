import { Children, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { SvgXml } from 'react-native-svg'
import type { Settings } from '@shared/types'
import { sync, updateSettings } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { lockup } from '../ui/lockup'
import { metrics, useColors } from '../ui/theme'

function syncedLabel(at: number | null, now: number): string {
  if (!at) return 'Not synced yet'
  const seconds = Math.round((now - at) / 1000)
  if (seconds < 45) return 'Synced just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Synced ${minutes} min ago`
  return `Synced at ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

/** Account and sync, appearance, and the week. */
export default function SettingsSheet() {
  const c = useColors()
  const state = useStore(sync.state, (s) => s)
  const settings = useStore(ui, (s) => s.settings)
  const [now, setNow] = useState(Date.now())
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  let status = syncedLabel(state.lastSyncedAt, now)
  if (state.downloading) status = 'Getting your notes…'
  else if (state.status === 'offline') status = state.pending ? `Offline · ${state.pending} ${state.pending === 1 ? 'change' : 'changes'} waiting` : 'Offline'
  else if (state.status === 'error') status = state.message ?? 'Sync paused. It will retry shortly.'

  const syncNow = async (): Promise<void> => {
    setSyncing(true)
    const result = await sync.syncNow()
    setSyncing(false)
    if (!result.ok) Alert.alert('Couldn’t sync', result.error)
  }

  const signOut = async (): Promise<void> => {
    const unsent = await sync.drain()
    const finish = async (): Promise<void> => {
      router.back()
      await sync.signOut()
    }
    if (!unsent) {
      Alert.alert('Sign out?', 'Your notes stay in your account and on your other devices. This iPhone’s copy is removed.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => void finish() }
      ])
      return
    }
    Alert.alert(
      'Some changes haven’t synced',
      `${unsent} ${unsent === 1 ? 'change' : 'changes'} on this iPhone haven’t reached your account yet. If you sign out now, they’ll be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out Anyway', style: 'destructive', onPress: () => void finish() }
      ]
    )
  }

  const deleteAccount = (): void => {
    Alert.alert(
      'Delete your account?',
      'This deletes your account and every note in it from the sync server and this iPhone. Copies already on your other devices stay there. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            const result = await sync.deleteAccount()
            if (result.ok) router.back()
            else Alert.alert('Couldn’t delete the account', result.error)
          }
        }
      ]
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.sheet}>
      <Section title="Account">
        <Row label={state.email ?? ''} />
        <Row label={status} muted action={syncing ? 'Syncing…' : 'Sync Now'} onPress={syncNow} />
      </Section>

      <Section title="Appearance">
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

      <Section>
        <Row label="Sign Out" action="" onPress={signOut} />
        <Row label="Delete Account…" action="" onPress={deleteAccount} />
      </Section>

      <View style={styles.about}>
        <SvgXml xml={lockup(c.text3)} width={56} height={28} />
        <Text style={[styles.version, { color: c.text3 }]}>
          Version {Constants.expoConfig?.version ?? '0.1.0'} · alpha. Your notes sync across your devices.
        </Text>
      </View>
    </ScrollView>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  const c = useColors()
  return (
    <View style={styles.section}>
      {title && <Text style={[styles.sectionTitle, { color: c.text3 }]}>{title}</Text>}
      <View style={[styles.group, { backgroundColor: c.bgSubtle }]}>
        {Children.toArray(children).map((child, i) => (
          <View key={i}>
            {i > 0 && <View style={[styles.separator, { backgroundColor: c.line }]} />}
            {child}
          </View>
        ))}
      </View>
    </View>
  )
}

function Row({ label, muted, action, onPress }: { label: string; muted?: boolean; action?: string; onPress?: () => void }) {
  const c = useColors()
  const content = (
    <>
      <Text style={[styles.rowLabel, { color: muted ? c.text2 : c.text }]} numberOfLines={2}>
        {label}
      </Text>
      {action ? <Text style={[styles.rowAction, { color: c.text }]}>{action}</Text> : null}
    </>
  )
  if (!onPress) return <View style={styles.row}>{content}</View>
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.bgHover }]} accessibilityRole="button">
      {content}
    </Pressable>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  const c = useColors()
  return (
    <View style={styles.segmented}>
      {options.map(([option, label]) => {
        const selected = option === value
        return (
          <Pressable
            key={String(option)}
            onPress={() => onChange(option)}
            style={[styles.segment, selected && { backgroundColor: c.bgElevated, shadowOpacity: 0.08 }]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.segmentText, { color: selected ? c.text : c.text2 }, selected && styles.segmentSelected]}>{label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    padding: metrics.gutter,
    paddingTop: 26,
    gap: 22
  },
  section: {
    gap: 8
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginLeft: 4
  },
  group: {
    borderRadius: 12,
    overflow: 'hidden'
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14
  },
  row: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  rowLabel: {
    flex: 1,
    fontSize: 16
  },
  rowAction: {
    fontSize: 16,
    fontWeight: '600'
  },
  segmented: {
    flexDirection: 'row',
    padding: 3,
    gap: 3
  },
  segment: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 0
  },
  segmentText: {
    fontSize: 15
  },
  segmentSelected: {
    fontWeight: '600'
  },
  about: {
    alignItems: 'center',
    gap: 8,
    marginTop: 8
  },
  version: {
    fontSize: 13,
    textAlign: 'center'
  }
})
