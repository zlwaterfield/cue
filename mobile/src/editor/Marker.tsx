import { memo, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import type { ItemType } from '@shared/types'
import { metrics, useColors } from '../ui/theme'

const BOX = 18

/**
 * The hanging marker: a dot for bullets, a box for to-dos, nothing for text. Changing type
 * or checking a box gives a small, quick pop so the change registers under a finger.
 */
export const Marker = memo(function Marker({ type, done }: { type: ItemType; done: boolean }) {
  const c = useColors()
  const pop = useSharedValue(1)
  const mounted = useRef(false)

  useEffect(() => {
    // Only changes pop; a day opening doesn't.
    if (!mounted.current) {
      mounted.current = true
      return
    }
    pop.value = 0.72
    pop.value = withSpring(1, { damping: 12, stiffness: 420, mass: 0.6 })
  }, [type, done, pop])

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }))

  return (
    <View style={styles.marker} pointerEvents="none">
      {type === 'bullet' ? (
        <Animated.View style={[styles.dot, { backgroundColor: c.text2 }, style]} />
      ) : type === 'todo' ? (
        <Animated.View
          style={[
            styles.box,
            done ? { backgroundColor: c.accent, borderColor: c.accent } : { borderColor: c.lineStrong },
            style
          ]}
        >
          {done && <Check color={c.onAccent} animate={mounted.current} />}
        </Animated.View>
      ) : null}
    </View>
  )
})

function Check({ color, animate }: { color: string; animate: boolean }) {
  const draw = useSharedValue(animate ? 0 : 1)
  useEffect(() => {
    draw.value = withTiming(1, { duration: 160 })
  }, [draw])
  const style = useAnimatedStyle(() => ({ opacity: draw.value }))
  return (
    <Animated.View style={style}>
      <Svg width={BOX - 2} height={BOX - 2} viewBox="0 0 16 16">
        <Path d="M4.2 8.4l2.4 2.4 5.2-5.6" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  marker: {
    width: metrics.marker,
    height: metrics.lineHeight + 2 * metrics.rowPadding,
    justifyContent: 'center'
  },
  dot: {
    width: 6,
    height: 6,
    marginLeft: 7,
    borderRadius: 3,
    opacity: 0.8
  },
  box: {
    width: BOX,
    height: BOX,
    marginLeft: 1,
    borderRadius: 5.5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
