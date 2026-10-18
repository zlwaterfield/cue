import { StyleSheet, useWindowDimensions } from 'react-native'
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
 *  left: tomorrow; past ~60% of the width, delete
 */

/** What a right swipe does to the line: 0 makes a to-do, 1 completes, 2 reopens. */
export type SwipeKind = 0 | 1 | 2

export const swipe = {
  id: makeMutable(''),
  kind: makeMutable<SwipeKind>(0),
  x: makeMutable(0)
}

export const SWIPE_ACT = 72
export const SWIPE_DELETE_FRACTION = 0.58
/**
 * A line let go springs home as quickly as a lively spring would, but stops there: going
 * past would flash the other side's underlay.
 */
export const SWIPE_HOME = { stiffness: 400, damping: 34, mass: 1, overshootClamping: true }

const ADVANCE_ICONS: SFSymbol[] = ['checklist', 'checkmark', 'arrow.uturn.backward']

export function SwipeUnderlay({ geometry }: { geometry: SharedValue<DayGeometry> }) {
  const c = useColors()
  const { width } = useWindowDimensions()
  const deleteAt = width * SWIPE_DELETE_FRACTION

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
    backgroundColor: -swipe.x.value >= SWIPE_ACT ? c.accent : c.bgSubtle
  }))
  const advance = [
    useAnimatedStyle(() => ({ opacity: swipe.kind.value === 0 ? 1 : 0 })),
    useAnimatedStyle(() => ({ opacity: swipe.kind.value === 1 ? 1 : 0 })),
    useAnimatedStyle(() => ({ opacity: swipe.kind.value === 2 ? 1 : 0 }))
  ]
  const tomorrow = useAnimatedStyle(() => ({ opacity: -swipe.x.value < deleteAt ? 1 : 0 }))
  const remove = useAnimatedStyle(() => ({ opacity: -swipe.x.value >= deleteAt ? 1 : 0 }))
  const ink = useAnimatedStyle(() => ({ opacity: Math.abs(swipe.x.value) >= SWIPE_ACT ? 0 : 1 }))
  const inkOn = useAnimatedStyle(() => ({ opacity: Math.abs(swipe.x.value) >= SWIPE_ACT ? 1 : 0 }))

  // Each icon twice, in quiet and in strong ink, crossfaded as the action arms.
  const icon = (name: SFSymbol) => (
    <>
      <Animated.View style={[styles.icon, ink]}>
        <SymbolView name={name} size={18} tintColor={c.text2} />
      </Animated.View>
      <Animated.View style={[styles.icon, inkOn]}>
        <SymbolView name={name} size={18} tintColor={c.onAccent} />
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
        <Animated.View style={[styles.slot, styles.trailing, remove]}>{icon('trash')}</Animated.View>
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
    left: metrics.gutter + 4
  },
  trailing: {
    right: metrics.gutter + 4
  },
  icon: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
