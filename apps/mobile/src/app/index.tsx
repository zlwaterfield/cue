import { useEffect, useLayoutEffect, useState } from 'react'
import { AppState, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import { addDays } from '@shared/dates'
import { isNotePage } from '@shared/notes'
import { itemStore, sync } from '../core/app'
import { receiveShared } from '../core/inbox'
import { refreshNotes } from '../core/notes'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { arriving } from '../editor/hooks'
import { DayPage } from '../editor/DayPage'
import { Toolbar } from '../editor/Toolbar'
import { Header } from '../ui/Header'
import { TabBar } from '../ui/TabBar'
import { pane, PaneWidth, useSafeWidth } from '../ui/pane'
import { metrics, useColors } from '../ui/theme'
import { Toast } from '../ui/Toast'

/**
 * The narrowest a day is shown beside another: about forty characters of a line. An open
 * iPhone Duo and an iPad have room for two days this wide or wider; a phone doesn't, and
 * neither does a Duo's open display held upright.
 */
const MIN_PAGE = 360

/**
 * The day on screen, with the week above it. Where there's room, the next day is open
 * beside it: the same days in the same order, with one more of them in sight.
 */
export default function Day() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const date = useStore(ui, (s) => s.date)
  const width = useSafeWidth()
  const { width: windowWidth } = useWindowDimensions()
  // Two days meet in the middle of the window, not of what's left beside the system's
  // strip: on an open iPhone Duo that is where it folds, so neither day lies across it.
  // The day on the strip's side is the narrower one, and each still knows its own width.
  const first = windowWidth / 2 - insets.left
  const second = width - first
  const spread = !isNotePage(date) && Math.min(first, second) >= MIN_PAGE
  // A page on its own is no wider than a line reads well.
  const single = Math.min(width, metrics.column)
  pane.width = spread ? Math.min(first, second) : single
  // The editor asks whether a day is on screen (undo, a change from another device).
  useLayoutEffect(() => ui.set({ spread }), [spread])
  const next = addDays(date, 1)
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
      // Scratch and the starred notes, on hand before the Notes tab is pressed.
      refreshNotes()
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
    // The page's colour runs to every edge; what's on it keeps clear of each side on its own.
    <View style={[styles.screen, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={[styles.screen, { marginLeft: insets.left, marginRight: insets.right }]}>
        <PaneWidth value={width}>
          <Header />
          {ready && (
            <View style={styles.pages}>
              {/* Keyed by day: turning on a day slides the second page into the first's place as it is. */}
              <View key={date} style={spread ? { width: first } : [styles.screen, { maxWidth: single }]}>
                <PaneWidth value={spread ? first : single}>
                  <DayPage date={date} />
                </PaneWidth>
              </View>
              {spread && (
                <View key={next} style={[styles.screen, styles.second, { borderLeftColor: c.line }]}>
                  <PaneWidth value={second}>
                    <DayPage date={next} />
                  </PaneWidth>
                </View>
              )}
            </View>
          )}
          <TabBar />
          <Toast />
        </PaneWidth>
      </View>
      {/* Rides on the keyboard, which is as wide as the window. */}
      <Toolbar />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  pages: {
    flex: 1,
    flexDirection: 'row'
  },
  second: {
    borderLeftWidth: StyleSheet.hairlineWidth
  }
})
