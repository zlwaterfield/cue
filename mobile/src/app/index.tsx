import { useEffect, useState } from 'react'
import { AppState, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import { addDays } from '@shared/dates'
import { itemStore, sync } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
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
    void itemStore.ensureLoaded([addDays(today, -1), today, addDays(today, 1)]).then(() => {
      setReady(true)
      void SplashScreen.hideAsync()
      // An empty today is an invitation to write: put the caret there, unless the
      // first download onto this phone is still bringing the notes in.
      if (!itemStore.outline(today).length && !sync.state.get().downloading) editor.focus(editor.ghostId(today), 0)
    })
    const timer = setInterval(() => editor.checkToday(), 30_000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') editor.checkToday()
    })
    return () => {
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
