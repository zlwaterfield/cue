import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { router } from 'expo-router'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { addDays, dateRange, longDate, MONTHS, parts, startOfWeek, weekday, WEEKDAYS } from '@shared/dates'
import { indicator, INDICATOR_DELAY, INDICATOR_FADE } from '@shared/sync/status'
import type { ISODate } from '@shared/types'
import { itemStore, sync } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { metrics, useColors } from './theme'

const DAY_MAX_FONT_SCALE = 1.3
const DAY_CIRCLE = 34
const ICON_BUTTON = 36
const ICON_SIZE = 21

/**
 * The week strip's side margins: its seven days share the rest equally, and the first and
 * last day circles land on the screen's outer edge (`metrics.gutter`).
 */
const stripInset = (width: number): number => ((metrics.gutter + DAY_CIRCLE / 2 - width / 14) * 7) / 6

/** Another week opens on its first day, or on today in this week. */
const shiftWeek = (weeks: number): void => {
  const { date, today, settings } = ui.get()
  const start = addDays(startOfWeek(date, settings.weekStartsOn), 7 * weeks)
  void Haptics.selectionAsync()
  void editor.goTo(startOfWeek(today, settings.weekStartsOn) === start ? today : start)
}

/**
 * The top of the screen: the month (tap for a calendar), search and settings, and a week
 * strip. Tap a day to open it; swipe the strip for the previous or next week. Sync stays
 * out of sight unless it needs attention, as on the Mac.
 */
export function Header() {
  const c = useColors()
  const date = useStore(ui, (s) => s.date)
  const today = useStore(ui, (s) => s.today)
  const { year, month } = parts(date)
  const isToday = date === today

  return (
    <View style={[styles.header, { backgroundColor: c.bg }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => router.push('/calendar')}
          accessibilityRole="button"
          accessibilityLabel={`${MONTHS[month - 1]} ${year}`}
          accessibilityHint="Opens the calendar"
          style={styles.month}
          hitSlop={8}
        >
          {/* At the largest text sizes the month gives way, so search and settings stay on screen. */}
          <Text style={[styles.monthText, { color: c.text }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {MONTHS[month - 1]} <Text style={{ color: c.text3 }}>{year}</Text>
          </Text>
          <SymbolView name="chevron.down" size={12} weight="semibold" tintColor={c.text3} />
        </Pressable>
        <View style={styles.actions}>
          <SyncIndicator compact={!isToday} />
          {!isToday && (
            <Pressable
              onPress={() => void editor.goTo(today)}
              style={[styles.todayPill, { borderColor: c.lineStrong }]}
              accessibilityRole="button"
              hitSlop={6}
            >
              <Text style={[styles.todayText, { color: c.text }]} maxFontSizeMultiplier={1.3}>
                Today
              </Text>
            </Pressable>
          )}
          <IconButton icon="magnifyingglass" label="Search" onPress={() => router.push('/search')} />
          <IconButton icon="person.crop.circle" label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </View>
      <WeekStrip date={date} today={today} />
    </View>
  )
}

function IconButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const c = useColors()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.icon}>
      <SymbolView name={icon} size={ICON_SIZE} tintColor={c.text2} />
    </Pressable>
  )
}

/** Days with something written get a dot. Reads the loaded days, so it follows every edit and sync. */
function useMarked(days: ISODate[]): Set<ISODate> {
  useEffect(() => {
    void itemStore.ensureLoaded(days)
  }, [days])
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const offs = days.map((d) => itemStore.subscribeDate(d, listener))
      return () => offs.forEach((off) => off())
    },
    [days]
  )
  const key = useSyncExternalStore(subscribe, () => days.map((d) => (itemStore.outline(d).length ? '1' : '0')).join(''))
  return useMemo(() => new Set(days.filter((_, i) => key[i] === '1')), [days, key])
}

function WeekStrip({ date, today }: { date: ISODate; today: ISODate }) {
  const c = useColors()
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  const start = startOfWeek(date, weekStartsOn)
  const days = useMemo(() => dateRange(start, addDays(start, 6)), [start])
  const marked = useMarked(days)
  const { width } = useWindowDimensions()
  const offset = useSharedValue(0)

  useEffect(() => {
    offset.value = withTiming(0, { duration: 180 })
  }, [start, offset])

  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet'
      offset.value = e.translationX * 0.6
    },
    onDeactivate: (e) => {
      'worklet'
      const flick = Math.abs(e.translationX) > 50 || Math.abs(e.velocityX) > 500
      if (flick) {
        const weeks = e.translationX < 0 ? 1 : -1
        offset.value = -weeks * 24
        scheduleOnRN(shiftWeek, weeks)
      } else {
        offset.value = withTiming(0, { duration: 160 })
      }
    }
  })

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
    opacity: 1 - Math.min(0.5, Math.abs(offset.value) / 120)
  }))

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.strip, { paddingHorizontal: stripInset(width) }, slide]} accessibilityRole="tablist">
        {days.map((day) => {
          const selected = day === date
          const isToday = day === today
          return (
            <Pressable
              key={day}
              style={styles.day}
              onPress={() => {
                if (day !== date) void Haptics.selectionAsync()
                void editor.goTo(day)
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={longDate(day)}
              testID={`day-${day}`}
            >
              <Text style={[styles.weekday, { color: isToday ? c.text : c.text2 }]} maxFontSizeMultiplier={1.3}>
                {WEEKDAYS[weekday(day)].slice(0, 1)}
              </Text>
              <View style={[styles.dayNumber, selected && { backgroundColor: c.accent }, !selected && isToday && { borderColor: c.lineStrong, borderWidth: 1 }]}>
                <Text style={[styles.dayText, { color: selected ? c.onAccent : c.text }, isToday && styles.todayDay]} maxFontSizeMultiplier={DAY_MAX_FONT_SCALE}>
                  {parts(day).day}
                </Text>
              </View>
              <View style={[styles.dot, { backgroundColor: marked.has(day) && !selected ? c.text3 : 'transparent' }]} />
            </Pressable>
          )
        })}
      </Animated.View>
    </GestureDetector>
  )
}

/** True once `active` has held for `ms`; false again the moment it stops. */
function useHeld(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setHeld(true), ms)
    return () => {
      clearTimeout(timer)
      setHeld(false)
    }
  }, [active, ms])
  return active && held
}

/**
 * Sync shows only when it can't keep up: offline, paused, or the first download onto
 * this phone. A long sync fades in "Syncing…"; quick ones never take space. The words
 * are the Mac title bar's (`shared/sync/status`). Beside the Today pill, and during the
 * first download (the page itself says "Getting your notes…"), only the dot shows, as in
 * a narrow Mac window; VoiceOver still reads the words.
 */
function SyncIndicator({ compact }: { compact: boolean }) {
  const c = useColors()
  const state = useStore(sync.state, (s) => s)
  const shown = indicator(state)
  const held = useHeld(!!shown?.delayed, INDICATOR_DELAY)
  if (!shown || (shown.delayed && !held)) return null
  const dotOnly = compact || (state.downloading && state.status !== 'offline' && state.status !== 'error')
  return (
    <Animated.View entering={shown.delayed ? FadeIn.duration(INDICATOR_FADE) : undefined}>
      <Pressable
        onPress={() => router.push('/settings')}
        hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={shown.label}
        accessibilityHint="Opens Settings"
        style={[styles.sync, dotOnly && styles.syncDotOnly]}
      >
        {(dotOnly || !shown.delayed) && <View style={[styles.syncDot, { backgroundColor: c.text2 }]} />}
        {!dotOnly && (
          <Text style={[styles.syncText, { color: c.text2 }, !shown.delayed && styles.syncAttention]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {shown.label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 2
  },
  bar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    // The month and the glyph of the last icon sit on the outer edge.
    paddingLeft: metrics.gutter,
    paddingRight: metrics.gutter - (ICON_BUTTON - ICON_SIZE) / 2
  },
  month: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0
  },
  monthText: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0
  },
  icon: {
    width: ICON_BUTTON,
    height: ICON_BUTTON,
    alignItems: 'center',
    justifyContent: 'center'
  },
  todayPill: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 4,
    marginRight: 4
  },
  todayText: {
    fontSize: 14,
    fontWeight: '600'
  },
  // As on the Mac: a dot and weight 500 when sync needs a word, plain for a long sync.
  sync: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 2
  },
  // The dot alone is still a 24 pt target, like the Mac's narrow title bar.
  syncDotOnly: {
    minWidth: 24,
    minHeight: 24,
    justifyContent: 'center'
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  syncText: {
    fontSize: 13
  },
  syncAttention: {
    fontWeight: '500'
  },
  strip: {
    flexDirection: 'row',
    paddingBottom: 6
  },
  day: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4
  },
  weekday: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 4
  },
  dayNumber: {
    width: DAY_CIRCLE,
    height: DAY_CIRCLE,
    borderRadius: DAY_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dayText: {
    fontSize: 16,
    fontVariant: ['tabular-nums']
  },
  todayDay: {
    fontWeight: '700'
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 4
  }
})
