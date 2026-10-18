import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type ViewInstance } from 'react-native'
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler'
import Animated, {
  scrollTo,
  useAnimatedKeyboard,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback
} from 'react-native-reanimated'
import { daySubtitle, relativeDayName } from '@shared/dates'
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
import { SwipeUnderlay } from './Swipe'

const AnimatedScrollView = Animated.createAnimatedComponent(GestureScrollView)

/** Scroll while a dragged line is held this close to the top or bottom edge. */
const EDGE = 80
const MAX_SPEED = 16

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
      style={{ backgroundColor: c.bg }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.text }]} accessibilityRole="header" testID="day-title" maxFontSizeMultiplier={1.4}>
          {title}
        </Text>
        <Text style={[styles.subtitle, { color: c.text2 }]} maxFontSizeMultiplier={2}>
          {subtitle}
        </Text>
      </View>
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
      <Pressable
        style={{ minHeight: screenHeight * 0.45 }}
        onPress={() => editor.focus(editor.ghostId(date), 0)}
        disabled={waiting}
        accessibilityLabel="New line"
      />
    </AnimatedScrollView>
    </View>
  )
})

const styles = StyleSheet.create({
  frame: {
    flex: 1
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
