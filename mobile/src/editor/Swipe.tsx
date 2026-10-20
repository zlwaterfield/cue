import { StyleSheet, useColorScheme, useWindowDimensions } from 'react-native'
import Animated, { interpolate, makeMutable, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { metrics, useColors } from '../ui/theme'
import type { DayGeometry } from './layout'

/**
 * Swiping a line. One line swipes at a time, so its offset is shared, and a single
 * underlay per page, positioned under that line, shows what letting go will do. Lines
 * themselves carry no swipe chrome, which keeps a day quick to open.
 *
 *  right: to-do (text, bullet) → done → reopened
 *  left: tomorrow; past 3/4 of the width, delete (the underlay turns red)
 */

/** What a right swipe does to the line: 0 makes a to-do, 1 completes, 2 reopens. */
export type SwipeKind = 0 | 1 | 2

/**
 * What a left swipe let go of is doing while the line leaves: 0 nothing yet, 1 tomorrow,
 * 2 delete. The underlay follows this rather than the offset, so a line sent to tomorrow
 * doesn't flash the trash as it flies past the delete point.
 */
export type SwipeLeaving = 0 | 1 | 2

export const swipe = {
  id: makeMutable(''),
  kind: makeMutable<SwipeKind>(0),
  leaving: makeMutable<SwipeLeaving>(0),
  x: makeMutable(0)
}

export const SWIPE_ACT = 72
/** Deleting takes a deliberate, long swipe, well past where tomorrow arms. */
export const SWIPE_DELETE_FRACTION = 0.75
/**
 * iOS's own destructive red, the one hue outside the graphite brand: an armed delete
 * should be impossible to mistake for tomorrow.
 */
const DELETE_RED = { light: '#FF3B30', dark: '#FF453A' }
/**
 * A line let go springs home as quickly as a lively spring would, but stops there: going
 * past would flash the other side's underlay.
 */
export const SWIPE_HOME = { stiffness: 400, damping: 34, mass: 1, overshootClamping: true }

const ADVANCE_ICONS: SFSymbol[] = ['checklist', 'checkmark', 'arrow.uturn.backward']

export function SwipeUnderlay({ geometry }: { geometry: SharedValue<DayGeometry> }) {
  const c = useColors()
  const red = useColorScheme() === 'dark' ? DELETE_RED.dark : DELETE_RED.light
  const { width } = useWindowDimensions()
  const deleteAt = width * SWIPE_DELETE_FRACTION
  // Styles only re-run for shared values they read themselves, so each passes them in.
  const deleting = (x: number, leaving: SwipeLeaving): boolean => {
    'worklet'
    return leaving === 0 ? -x >= deleteAt : leaving === 2
  }

  const frame = useAnimatedStyle(() => {
    const g = geometry.value
    const index = g.index[swipe.id.value]
    if (index === undefined || swipe.x.value === 0) return { opacity: 0, height: 0, transform: [{ translateY: 0 }] }
    return { opacity: 1, height: g.heights[index], transform: [{ translateY: g.tops[index] }] }
  })
  const leading = useAnimatedStyle(() => ({
    opacity: interpolate(swipe.x.value, [0, 24, SWIPE_ACT], [0, 0.6, 1], 'clamp'),
    backgroundColor: swipe.x.value >= SWIPE_ACT ? c.accent : c.bgSubtle
  }))
  const trailing = useAnimatedStyle(() => ({
    opacity: interpolate(-swipe.x.value, [0, 24, SWIPE_ACT], [0, 0.6, 1], 'clamp'),
    backgroundColor: deleting(swipe.x.value, swipe.leaving.value) ? red : -swipe.x.value >= SWIPE_ACT ? c.accent : c.bgSubtle
  }))
  const advance = [
    useAnimatedStyle(() => ({ opacity: swipe.kind.value === 0 ? 1 : 0 })),
    useAnimatedStyle(() => ({ opacity: swipe.kind.value === 1 ? 1 : 0 })),
    useAnimatedStyle(() => ({ opacity: swipe.kind.value === 2 ? 1 : 0 }))
  ]
  const tomorrow = useAnimatedStyle(() => ({ opacity: deleting(swipe.x.value, swipe.leaving.value) ? 0 : 1 }))
  const remove = useAnimatedStyle(() => ({ opacity: deleting(swipe.x.value, swipe.leaving.value) ? 1 : 0 }))
  const ink = useAnimatedStyle(() => ({ opacity: Math.abs(swipe.x.value) >= SWIPE_ACT ? 0 : 1 }))
  const inkOn = useAnimatedStyle(() => ({ opacity: Math.abs(swipe.x.value) >= SWIPE_ACT ? 1 : 0 }))

  // Each icon twice, in quiet and in strong ink, crossfaded as the action arms.
  const icon = (name: SFSymbol, on = c.onAccent) => (
    <>
      <Animated.View style={[styles.icon, ink]}>
        <SymbolView name={name} size={18} tintColor={c.text2} />
      </Animated.View>
      <Animated.View style={[styles.icon, inkOn]}>
        <SymbolView name={name} size={18} tintColor={on} />
      </Animated.View>
    </>
  )

  return (
    <Animated.View style={[styles.frame, frame]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.side, leading]}>
        {ADVANCE_ICONS.map((name, kind) => (
          <Animated.View key={name} style={[styles.slot, styles.leading, advance[kind]]}>
            {icon(name)}
          </Animated.View>
        ))}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.side, trailing]}>
        <Animated.View style={[styles.slot, styles.trailing, tomorrow]}>{icon('arrow.turn.down.right')}</Animated.View>
        <Animated.View style={[styles.slot, styles.trailing, remove]}>{icon('trash', '#FFFFFF')}</Animated.View>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0
  },
  side: {
    justifyContent: 'center'
  },
  slot: {
    position: 'absolute',
    width: 24,
    height: 24
  },
  leading: {
    left: metrics.gutter
  },
  trailing: {
    right: metrics.gutter
  },
  icon: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
