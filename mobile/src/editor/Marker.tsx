import { memo, useState, type ReactNode } from 'react'
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { FadeIn, withSpring } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import type { ItemType } from '@shared/types'
import { metrics, useColors } from '../ui/theme'

const BOX = 18

/** A marker that just changed comes in with a small spring, so it registers under a finger. */
const pop = () => {
  'worklet'
  return {
    initialValues: { transform: [{ scale: 0.72 }] },
    animations: { transform: [{ scale: withSpring(1, { damping: 12, stiffness: 420, mass: 0.6 }) }] }
  }
}
const drawCheck = FadeIn.duration(160)

/**
 * The hanging marker: a dot for bullets, a box for to-dos, nothing for text. Changing type
 * or checking a box gives a small, quick pop. At rest it's plain views, with nothing for
 * the animation system to track, so a day of many lines stays light.
 *
 * It sits on the centre of the first line's capitals at every text size. iOS puts a line's
 * extra height above the glyphs, so that centre is the line's bottom less about 0.59 em.
 */
export const Marker = memo(function Marker({ type, done }: { type: ItemType; done: boolean }) {
  const c = useColors()
  const { fontScale } = useWindowDimensions()
  // Only changes pop; a day opening doesn't.
  const [shown, setShown] = useState({ type, done, changes: 0 })
  if (shown.type !== type || shown.done !== done) setShown({ type, done, changes: shown.changes + 1 })

  const capCentre = metrics.rowPadding + metrics.lineHeight * fontScale - metrics.fontSize * fontScale * 0.593
  const box = Math.min(24, Math.max(BOX, Math.round(BOX * fontScale)))

  return (
    <View style={[styles.marker, { height: metrics.lineHeight * fontScale + 2 * metrics.rowPadding }]} pointerEvents="none">
      {type === 'bullet' ? (
        <Glyph changes={shown.changes} style={[styles.dot, { marginTop: capCentre - 3, backgroundColor: c.text2 }]} />
      ) : type === 'todo' ? (
        <Glyph
          changes={shown.changes}
          style={[
            styles.box,
            { width: box, height: box, borderRadius: (box * 5.5) / BOX, marginTop: capCentre - box / 2 },
            done ? { backgroundColor: c.accent, borderColor: c.accent } : { borderColor: c.lineStrong }
          ]}
        >
          {done && <Check color={c.onAccent} size={box - 2} draw={shown.changes > 0} />}
        </Glyph>
      ) : null}
    </View>
  )
})

/** Plain at rest; remounted with the pop each time the marker changes. */
function Glyph({ changes, style, children }: { changes: number; style: StyleProp<ViewStyle>; children?: ReactNode }) {
  if (!changes) return <View style={style}>{children}</View>
  return (
    <Animated.View key={changes} entering={pop} style={style}>
      {children}
    </Animated.View>
  )
}

function Check({ color, size, draw }: { color: string; size: number; draw: boolean }) {
  const svg = (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path d="M4.2 8.4l2.4 2.4 5.2-5.6" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
  return draw ? <Animated.View entering={drawCheck}>{svg}</Animated.View> : svg
}

const styles = StyleSheet.create({
  marker: {
    width: metrics.marker
  },
  // Centred on the box, whose left edge is the marker edge.
  dot: {
    width: 6,
    height: 6,
    marginLeft: (BOX - 6) / 2,
    borderRadius: 3,
    opacity: 0.8
  },
  box: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
