import { useEffect, useState } from 'react'
import { AppState, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import { addDays } from '@shared/dates'
import { itemStore, sync } from '../core/app'
import { receiveShared } from '../core/inbox'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { arriving } from '../editor/hooks'
import { DayPage } from '../editor/DayPage'
import { Toolbar } from '../editor/Toolbar'
import { Header } from '../ui/Header'
import { useColors } from '../ui/theme'
import { Toast } from '../ui/Toast'

/** The day on screen, with the week above it. */
export default function Day() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const date = useStore(ui, (s) => s.date)
  const [ready, setReady] = useState(() => itemStore.isLoaded(ui.get().today))

  useEffect(() => {
    const { today } = ui.get()
    // An empty today is an invitation to write: put the caret there, once. During the
    // first download onto this phone, that's decided once today's notes are here.
    let loaded = false
    let invited = false
    const invite = (): void => {
      const { today, date, focusedId } = ui.get()
      if (!loaded || invited || arriving(sync.state.get(), today, today)) return
      invited = true
      if (date === today && !focusedId && !itemStore.outline(today).length) editor.focus(editor.ghostId(today), 0)
    }
    const unsubscribe = sync.state.subscribe(() => {
      invite()
      if (loaded) void receiveShared()
    })
    void itemStore.ensureLoaded([addDays(today, -1), today, addDays(today, 1)]).then(() => {
      setReady(true)
      void SplashScreen.hideAsync()
      loaded = true
      invite()
      // Links shared to Cue while it was away.
      void receiveShared()
    })
    const timer = setInterval(() => editor.checkToday(), 30_000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        editor.checkToday()
        void receiveShared()
      }
    })
    return () => {
      unsubscribe()
      clearInterval(timer)
      subscription.remove()
    }
  }, [])

  return (
    <View style={[styles.screen, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <Header />
      {ready && <DayPage key={date} date={date} />}
      <Toolbar />
      <Toast />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  }
})
