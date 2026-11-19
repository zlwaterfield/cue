import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { View, useWindowDimensions, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * The width a screen can draw its content in: the window, less what the system keeps on
 * each side. On most iPhones that's the whole window. On iPhone Duo the status bar and
 * Dynamic Island run down one side, on either display, and which side depends on how the
 * phone is held and on which half of a Split View Cue is in. So each edge is taken as it
 * is, never one side doubled, and the answer is read again whenever the window changes
 * (opening, closing, rotating, Split View).
 */
export function useSafeWidth(): number {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  return width - insets.left - insets.right
}

/**
 * The same width, handed down to a screen's parts. A week strip, a line being swiped and a
 * toast all size themselves against the pane they're in, not the window.
 */
export const PaneWidth = createContext(0)

export function usePaneWidth(): number {
  return useContext(PaneWidth)
}

/** For code outside React (a day's first-guess line heights). */
export const pane = { width: 0 }

/**
 * Keeps a screen that's presented over the day (a sheet, a modal) clear of what the system
 * holds at each side of the window.
 *
 * A presented screen isn't told about that itself: its own safe area has no sides. And it
 * may not reach the edge at all. On an open iPhone Duo a sheet floats in the middle of the
 * display, and padding it by the window's insets would take 84 pt from a sheet that's
 * nowhere near the status bar. So the screen is measured where it is, and gives up only
 * the part of itself that lies under the reserved strip.
 */
export function ClearOfSides({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const { width: windowWidth } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const view = useRef<ViewInstance>(null)
  const [frame, setFrame] = useState<{ x: number; width: number } | null>(null)
  const measure = useCallback(() => {
    view.current?.measureInWindow((x, _y, width) => {
      if (!width) return
      setFrame((was) => (was && was.x === x && was.width === width ? was : { x, width }))
    })
  }, [])
  // Until it's measured, a screen is taken to span the window, which is right for a phone.
  const x = frame?.x ?? 0
  const width = frame?.width ?? windowWidth
  const left = Math.max(0, insets.left - x)
  const right = Math.max(0, x + width - (windowWidth - insets.right))
  return (
    <View ref={view} onLayout={measure} style={[style, { paddingLeft: left, paddingRight: right }]}>
      {children}
    </View>
  )
}
