import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { router } from 'expo-router'
import { statusLine } from '@shared/sync/status'
import { sync } from '../../core/app'
import { useStore } from '../../core/store'
import { Row, Section, SettingsScreen } from '../../ui/SettingsList'

/**
 * The account and what sync is doing. Sync is the Mac's: off until you turn it on, and
 * turning it off keeps every note here. The words are the Mac's (`shared/sync/status`).
 */
export default function Sync() {
  const state = useStore(sync.state, (s) => s)
  const [now, setNow] = useState(Date.now())
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  const syncNow = async (): Promise<void> => {
    setSyncing(true)
    const result = await sync.syncNow()
    setSyncing(false)
    // Offline or paused needs no alert: the footnote already says why, as on the Mac.
    const { status } = sync.state.get()
    if (!result.ok && status !== 'offline' && status !== 'error') Alert.alert('Couldn’t sync', result.error)
  }

  const deleteAccount = (): void => {
    Alert.alert(
      'Delete your account?',
      'This deletes your account and every note in it from the sync server. Notes on this iPhone and your other devices stay there. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            const result = await sync.deleteAccount()
            if (!result.ok) Alert.alert('Couldn’t delete the account', result.error)
          }
        }
      ]
    )
  }

  if (!state.email) {
    return (
      <SettingsScreen title="Sync">
        <Section
          footnote={
            state.needsSignIn
              ? (state.message ?? undefined)
              : 'Your notes are stored only on this iPhone. Turn on sync to keep them on your other devices too.'
          }
        >
          <Row label={state.previousEmail ? 'Sign In Again…' : 'Turn On Sync…'} onPress={() => router.push('/sign-in')} />
          {state.needsSignIn && <Row label="Not Now" onPress={() => void sync.signOut()} />}
        </Section>
      </SettingsScreen>
    )
  }

  return (
    <SettingsScreen title="Sync">
      <Section footnote={statusLine(state, now)}>
        <Row label={state.email} action="Sync Now" onPress={syncNow} disabled={syncing || state.status === 'syncing'} />
      </Section>

      <Section footnote="Every note stays on this iPhone. Turn sync back on any time.">
        <Row label="Turn Off Sync" onPress={() => void sync.signOut()} />
      </Section>

      <Section footnote="Deletes your account and its notes from the sync server. Notes on this iPhone stay here.">
        <Row label="Delete Account…" onPress={deleteAccount} />
      </Section>
    </SettingsScreen>
  )
}
