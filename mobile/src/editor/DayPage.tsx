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
import type { ISODate } from '@shared/types'
import { itemStore } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { metrics, useColors } from '../ui/theme'
import { editor } from './controller'
import { drag, scrollState, updateDrag } from './drag'
import { TOOLBAR_SPACE } from './Toolbar'
import { useArriving, useOutline } from './hooks'
import { Row } from './Row'
import { SWIPE_HOME, SwipeUnderlay } from './Swipe'

const AnimatedScrollView = Animated.createAnimatedComponent(GestureScrollView)

/** Scroll while a dragged line is held this close to the top or bottom edge. */
const EDGE = 80
const MAX_SPEED = 16

/**
 * Swiping the page itself, anywhere but on a line, turns to the next or previous day:
 * left for the next, as a line swiped left goes to tomorrow. The page follows the finger
 * at half speed, carries on out, and the new day comes in from the side it was pulled from.
 */
const TURN_AT = 60
const TURN_OUT = 72
const TURN_IN = 40
/** Which side the next page to open comes in from: 1 the right (a later day), -1 the left. */
let turning = 0

const turnPage = (date: ISODate, days: number): void => {
  void Haptics.selectionAsync()
  turning = days
  void editor.goTo(addDays(date, days))
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
      // Far enough, or flicked the way it was going.
      const turn = Math.abs(e.translationX) > TURN_AT || e.velocityX * -days > 500
      if (turn) {
        shift.value = withTiming(-days * TURN_OUT, { duration: 140 })
        scheduleOnRN(turnPage, date, days)
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

/** One day: its title and its lines, as a scrolling page. */
export const DayPage = memo(function DayPage({ date }: { date: ISODate }) {
  const c = useColors()
  const rows = useOutline(date)
  const today = useStore(ui, (s) => s.today)
  const { height: screenHeight } = useWindowDimensions()
  const layout = editor.layout(date)
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const keyboard = useAnimatedKeyboard()
  const contentTop = useRef(0)
  const [loaded, setLoaded] = useState(() => itemStore.isLoaded(date))
  const arriving = useArriving(date)

  // A page opened by a swipe slides in; any other way, it's simply there.
  const shift = useSharedValue(turning * TURN_IN)
  useEffect(() => {
    turning = 0
    if (shift.value) shift.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) })
  }, [shift])
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
  const onViewport = useCallback((e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height
    // Where the page is on screen, for scrolling at the edges during a drag.
    frame.current?.measureInWindow((_x, y) => {
      scrollState.value = { ...scrollState.value, viewportTop: y, viewportHeight: height }
    })
  }, [])

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
    updateDrag(d.translationX, d.translationY, d.absoluteY)
  })

  useEffect(() => {
    editor.scroller = {
      reveal: (target, id) => {
        if (target !== date) return
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
    }
    // iOS scrolls a line above the keyboard when it opens, but not above the toolbar.
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      const id = ui.get().focusedId
      if (id) editor.scroller?.reveal(date, id)
    })
    // Opened from search: bring the line into view once this day is laid out.
    const flash = ui.get().flash
    if (flash && itemStore.get(flash.id)?.date === date) requestAnimationFrame(() => editor.scroller?.reveal(date, flash.id))
    return () => shown.remove()
  }, [date, layout, scrollRef])

  // Worklets get shared values, not the layout object that holds them.
  const geometry = layout.geometry
  const container = useAnimatedStyle(() => ({ height: geometry.value.total }))

  /* ---------------------------------------------------------- Rendering */

  const title = relativeDayName(date, today)
  const subtitle = daySubtitle(date, today)
  const empty = rows.length === 0
  // An empty day whose notes are still on their way can't be written in yet, so nothing
  // typed now lands beside the notes about to arrive.
  const waiting = empty && arriving

  return (
    <View ref={frame} style={styles.frame} onLayout={onViewport}>
    <AnimatedScrollView
      ref={scrollRef}
      style={[{ backgroundColor: c.bg }, slide]}
      // The space under the last line reaches the bottom of the screen, however short the day.
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      scrollEventThrottle={16}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
    >
      <Turn date={date} shift={shift}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]} accessibilityRole="header" testID="day-title" maxFontSizeMultiplier={1.4}>
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: c.text2 }]} maxFontSizeMultiplier={2}>
            {subtitle}
          </Text>
        </View>
      </Turn>
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
          loaded && order.map((id) => <Row key={id} id={id} date={date} depth={depths.get(id) ?? 0} empty={empty} />)
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
  title: {
    fontSize: 34,
    fontWeight: '700'
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
