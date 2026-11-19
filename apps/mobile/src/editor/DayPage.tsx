import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type ViewInstance } from 'react-native'
import { GestureDetector, ScrollView as GestureScrollView, usePanGesture } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  interpolate,
  scrollTo,
  useAnimatedKeyboard,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import * as Haptics from 'expo-haptics'
import { addDays, daySubtitle, relativeDayName } from '@shared/dates'
import { isNotePage, SCRATCH } from '@shared/notes'
import type { ISODate } from '@shared/types'
import { itemStore } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { metrics, useColors } from '../ui/theme'
import { editor } from './controller'
import { drag, scrollStateOf, updateDrag } from './drag'
import { TOOLBAR_SPACE } from './Toolbar'
import { useArriving, useOutline } from './hooks'
import { LooseEnds } from './LooseEnds'
import { Row } from './Row'
import { SWIPE_HOME, SwipeUnderlay } from './Swipe'

const AnimatedScrollView = Animated.createAnimatedComponent(GestureScrollView)

/** Scroll while a dragged line is held this close to the top or bottom edge. */
const EDGE = 80
const MAX_SPEED = 16
/** After the page changes width, long enough for its lines to wrap and report their heights. */
const RESETTLE_AFTER = 350

/** Swiping a page off its lines turns the day: left for the next, as a swiped line goes to tomorrow. */
const TURN_AT = 60
const TURN_OUT = 72
const TURN_IN = 40
/** Which side the next page to open comes in from: 1 the right (a later day), -1 the left. */
let turning = 0

const turnPage = (date: ISODate, days: number, shift: SharedValue<number>): void => {
  void Haptics.selectionAsync()
  turning = days
  // A note turns to the note before or after it; at either end the page springs back.
  // Beside another day, either page turns both: on from the first of the two.
  const turned = isNotePage(date) ? editor.stepNote(days < 0 ? -1 : 1) : editor.goTo(addDays(ui.get().date, days))
  turned.catch(() => {
    turning = 0
    shift.value = withSpring(0, SWIPE_HOME)
  })
}

/** The open parts of a page (its title and the space under the last line) turn it. */
function Turn({ date, shift, children }: { date: ISODate; shift: SharedValue<number>; children: React.ReactElement }) {
  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet'
      shift.value = e.translationX * 0.5
    },
    onDeactivate: (e) => {
      'worklet'
      const days = e.translationX < 0 ? 1 : -1
      const turn = Math.abs(e.translationX) > TURN_AT || e.velocityX * -days > 500
      if (turn) {
        shift.value = withTiming(-days * TURN_OUT, { duration: 140 })
        scheduleOnRN(turnPage, date, days, shift)
      } else {
        shift.value = withSpring(0, SWIPE_HOME)
      }
    }
  })
  return <GestureDetector gesture={pan}>{children}</GestureDetector>
}

/**
 * Views stay in the order they were first rendered; the layout places them. New lines go
 * to the end, removed ones drop out, and nothing already on screen is ever moved in the
 * view tree (see layout.ts).
 */
function useStableOrder(ids: string[]): string[] {
  const order = useRef<string[]>([])
  return useMemo(() => {
    const present = new Set(ids)
    const next = order.current.filter((id) => present.has(id))
    const kept = new Set(next)
    for (const id of ids) if (!kept.has(id)) next.push(id)
    order.current = next
    return next
  }, [ids])
}

/** One day, or one note: its title and its lines, as a scrolling page. */
export const DayPage = memo(function DayPage({ date }: { date: ISODate }) {
  const c = useColors()
  const rows = useOutline(date)
  const today = useStore(ui, (s) => s.today)
  const { height: screenHeight } = useWindowDimensions()
  const layout = editor.layout(date)
  const scrollState = scrollStateOf(date)
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const keyboard = useAnimatedKeyboard()
  const contentTop = useRef(0)
  const [loaded, setLoaded] = useState(() => itemStore.isLoaded(date))
  const arriving = useArriving(date)

  const shift = useSharedValue(turning * TURN_IN)
  // Beside another day, a page can stay on screen when the day is turned (the second
  // becomes the first): it comes back from where the turn left it, like one arriving.
  const open = useStore(ui, (s) => s.date)
  useEffect(() => {
    turning = 0
    if (shift.value) shift.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) })
  }, [shift, open])
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value }],
    opacity: interpolate(Math.abs(shift.value), [0, TURN_OUT], [1, 0.35], 'clamp')
  }))

  useEffect(() => {
    if (loaded) return
    let live = true
    void itemStore.ensureLoaded([date]).then(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [date, loaded])

  // Before the first paint, so lines appear in place on the frame the day opens.
  useLayoutEffect(() => layout.attach(), [layout])

  const ghost = editor.ghostId(date)
  const ids = useMemo(() => [...rows.map((r) => r.id), ghost], [rows, ghost])
  const order = useStableOrder(ids)
  const depths = useMemo(() => new Map(rows.map((r) => [r.id, r.depth])), [rows])
  const accessibilityOrder = useMemo(() => ids.map((id) => `line-${id}`), [ids])

  /* ---------------------------------------------------------- Scrolling */

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollState.value = {
      ...scrollState.value,
      y: e.contentOffset.y,
      maxY: Math.max(0, e.contentSize.height - e.layoutMeasurement.height + e.contentInset.bottom)
    }
  })

  const frame = useRef<ViewInstance>(null)
  const viewport = useRef({ width: 0, height: 0 })
  const resettle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onViewport = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout
      // Where the page is on screen, for scrolling at the edges during a drag.
      frame.current?.measureInWindow((_x, y) => {
        scrollState.value = { ...scrollState.value, viewportTop: y, viewportHeight: height }
      })
      // The page changed shape under a line being edited (an iPhone Duo opened or closed,
      // Split View): its text wraps differently now, so where the page was scrolled to no
      // longer means anything, and can be past the end. Find the line again once the lines
      // have their new heights.
      const was = viewport.current
      viewport.current = { width, height }
      if (!was.width || was.width === width) return
      if (resettle.current) clearTimeout(resettle.current)
      resettle.current = setTimeout(() => {
        const id = ui.get().focusedId
        if (id) editor.scroller?.reveal(date, id)
      }, RESETTLE_AFTER)
    },
    [date]
  )
  useEffect(() => () => void (resettle.current && clearTimeout(resettle.current)), [])

  // Keep a dragged line moving when it's held at an edge.
  useFrameCallback(() => {
    const d = drag.value
    if (!d.active || d.dropping || d.date !== date) return
    const s = scrollState.value
    const bottom = Math.min(s.viewportTop + s.viewportHeight, screenHeight - keyboard.height.value)
    let speed = 0
    if (d.absoluteY < s.viewportTop + EDGE) speed = -Math.min(MAX_SPEED, (s.viewportTop + EDGE - d.absoluteY) / 4)
    else if (d.absoluteY > bottom - EDGE) speed = Math.min(MAX_SPEED, (d.absoluteY - bottom + EDGE) / 4)
    if (!speed) return
    const y = Math.max(0, Math.min(s.maxY, s.y + speed))
    if (y === s.y) return
    scrollTo(scrollRef, 0, y, false)
    scrollState.value = { ...s, y }
    updateDrag(d.translationX, d.translationY, d.absoluteY, y)
  })

  useEffect(() => {
    const forget = editor.scrolls(date, {
      reveal: (_target, id) => {
        const frame = layout.frameOf(id)
        if (!frame) return
        const s = scrollState.value
        // Not measured yet: the page is still coming on screen (the caret can land in an
        // empty today as it does, after sign-in), and the keyboard opening will reveal it.
        if (!s.viewportHeight) return
        const keyboard = Keyboard.metrics()
        // Above the keyboard and the toolbar riding on it.
        const keyboardTop = keyboard ? keyboard.screenY - TOOLBAR_SPACE : s.viewportTop + s.viewportHeight
        const visible = Math.min(s.viewportHeight, keyboardTop - s.viewportTop)
        const top = contentTop.current + frame.top
        const bottom = top + frame.height
        if (bottom > s.y + visible - 12) scrollRef.current?.scrollTo({ y: bottom - visible + 28, animated: true })
        else if (top < s.y + 8) scrollRef.current?.scrollTo({ y: Math.max(0, top - 16), animated: true })
      }
    })
    // iOS scrolls a line above the keyboard when it opens, but not above the toolbar.
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      const id = ui.get().focusedId
      if (id) editor.scroller?.reveal(date, id)
    })
    // Opened from search: bring the line into view once this day is laid out.
    const flash = ui.get().flash
    if (flash && itemStore.get(flash.id)?.date === date) requestAnimationFrame(() => editor.scroller?.reveal(date, flash.id))
    return () => {
      shown.remove()
      forget()
    }
  }, [date, layout, scrollRef, scrollState])

  // Worklets get shared values, not the layout object that holds them.
  const geometry = layout.geometry
  const container = useAnimatedStyle(() => ({ height: geometry.value.total }))

  /* ---------------------------------------------------------- Rendering */

  const note = isNotePage(date)
  const scratch = date === SCRATCH
  const empty = rows.length === 0
  // Scratch is titled like a day. A starred note's first line is its name, so that line
  // is the title (Row) and the head above it only says what kind of page this is.
  const title = scratch ? 'Scratch' : note ? null : relativeDayName(date, today)
  const subtitle = scratch ? (empty ? 'Type or paste anything. It stays until you clear it.' : null) : note ? null : daySubtitle(date, today)
  // An empty day whose notes are still on their way can't be written in yet, so nothing
  // typed now lands beside the notes about to arrive.
  const waiting = empty && arriving

  return (
    <View ref={frame} style={styles.frame} onLayout={onViewport}>
    <AnimatedScrollView
      ref={scrollRef}
      style={[{ backgroundColor: c.bg }, slide]}
      // So the space under the last line fills the screen on a short day.
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      scrollEventThrottle={16}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
    >
      <Turn date={date} shift={shift}>
        <View style={[styles.head, note && !scratch && styles.starredHead]}>
          <View style={styles.titleRow}>
            {title ? (
              <Text style={[styles.title, { color: c.text }]} accessibilityRole="header" testID="day-title" maxFontSizeMultiplier={1.4}>
                {title}
              </Text>
            ) : (
              <Text style={[styles.kind, { color: c.text2 }]} maxFontSizeMultiplier={1.6}>
                ★ Starred
              </Text>
            )}
            {note && !empty && (
              <View style={styles.actions}>
                <NoteAction label="Share" onPress={() => editor.sharePage(date)} />
                <NoteAction label={scratch ? 'Clear' : 'Delete'} onPress={() => editor.discardNote(date)} />
              </View>
            )}
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: c.text2 }]} maxFontSizeMultiplier={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Turn>
      {date === today && <LooseEnds today={today} />}
      <Animated.View
        style={[styles.rows, container]}
        onLayout={(e) => (contentTop.current = e.nativeEvent.layout.y)}
        // Views are in creation order; VoiceOver reads them in the day's order.
        experimental_accessibilityOrder={waiting ? undefined : accessibilityOrder}
      >
        <SwipeUnderlay geometry={geometry} />
        {waiting ? (
          <Text style={[styles.waiting, { color: c.text3 }]}>Getting your notes…</Text>
        ) : (
          loaded && order.map((id) => <Row key={id} id={id} date={date} depth={depths.get(id) ?? 0} empty={empty} title={note && !scratch && id === (rows[0]?.id ?? ghost)} />)
        )}
      </Animated.View>
      {/* Tapping the open space below the last line starts a new one. */}
      <Turn date={date} shift={shift}>
        <Pressable
          style={[styles.below, { minHeight: screenHeight * 0.45 }]}
          onPress={() => editor.focus(editor.ghostId(date), 0)}
          disabled={waiting}
          accessibilityLabel="New line"
        />
      </Turn>
    </AnimatedScrollView>
    </View>
  )
})

/** What can be done with a whole note, in words beside its title. */
function NoteAction({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors()
  return (
    <Pressable onPress={onPress} hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} accessibilityRole="button" testID={`note-${label.toLowerCase()}`}>
      <Text style={[styles.action, { color: c.text2 }]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  frame: {
    flex: 1
  },
  content: {
    flexGrow: 1
  },
  below: {
    flexGrow: 1
  },
  head: {
    // Aligned with the text of the lines; markers hang in the margin to its left.
    paddingLeft: metrics.gutter + metrics.marker,
    paddingRight: metrics.gutter,
    paddingTop: 14,
    paddingBottom: 10
  },
  starredHead: {
    paddingBottom: 2
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  title: {
    flexShrink: 1,
    fontSize: 34,
    fontWeight: '700'
  },
  kind: {
    fontSize: 14,
    fontWeight: '500'
  },
  actions: {
    flexDirection: 'row',
    gap: 18
  },
  action: {
    fontSize: 15
  },
  subtitle: {
    fontSize: 15,
    marginTop: 2
  },
  rows: {
    position: 'relative'
  },
  waiting: {
    // Where the blank line's text would be.
    paddingLeft: metrics.gutter + metrics.marker,
    paddingVertical: metrics.rowPadding,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight
  }
})
