import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, View, useWindowDimensions, type TextInputInstance } from 'react-native'
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler'
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { diffDays } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { focusAt } from '../../modules/cue-native'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { colors, metrics, useColors } from '../ui/theme'
import { editor } from './controller'
import { beginDrag, drag, dragTop, resetDrag, updateDrag } from './drag'
import { useItem } from './hooks'
import { Marker } from './Marker'
import { swipe, SWIPE_ACT, SWIPE_DELETE_FRACTION, type SwipeKind } from './Swipe'

const LIFT_DELAY = 340
/** Where a line not in its day's layout waits, out of sight. */
const HIDDEN = -10_000

function placeholderFor(date: ISODate, today: ISODate): string {
  const delta = diffDays(today, date)
  if (delta === 0) return 'Start typing…'
  if (delta > 0) return 'Nothing planned'
  return 'Nothing written'
}

const haptic = (kind: 'lift' | 'tick' | 'threshold'): void => {
  if (kind === 'lift') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  else if (kind === 'threshold') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  else void Haptics.selectionAsync()
}

const LINE_ACTIONS = [
  { name: 'tomorrow', label: 'Move to tomorrow' },
  { name: 'move', label: 'Move to another day' },
  { name: 'indent', label: 'Indent' },
  { name: 'outdent', label: 'Outdent' },
  { name: 'delete', label: 'Delete' }
]
const ACCESSIBILITY_ACTIONS = {
  todo: [{ name: 'advance', label: 'Complete' }, { name: 'bullet', label: 'Make a bullet' }, ...LINE_ACTIONS],
  done: [{ name: 'advance', label: 'Reopen' }, ...LINE_ACTIONS],
  other: [{ name: 'advance', label: 'Make a to-do' }, ...LINE_ACTIONS]
}

function onAccessibilityAction(id: string, action: string): void {
  if (action === 'advance') editor.advance(id)
  else if (action === 'bullet') editor.toggleType(id, 'bullet')
  else if (action === 'tomorrow') void editor.moveToTomorrow(id)
  else if (action === 'move') router.push({ pathname: '/move', params: { id } })
  else if (action === 'indent') editor.indent(id)
  else if (action === 'outdent') editor.outdent(id)
  else if (action === 'delete') editor.remove(id)
}

// Worklets can only call back into JavaScript through plain module-level functions.
const lifted = (): void => ui.set({ dragging: true })
const advance = (id: string): void => editor.advance(id)
// A line swiped away stays off-screen until it has actually left the page; then the
// shared offset resets, so Undo brings it back in place.
const settleSwipe = (): void => {
  swipe.x.value = 0
  swipe.id.value = ''
}
const remove = (id: string): void => {
  editor.remove(id)
  settleSwipe()
}
const toTomorrow = (id: string): void => void editor.moveToTomorrow(id).then(settleSwipe)
const dropped = (date: ISODate, id: string, index: number, depth: number): void => {
  // The new layout is in place before the drag ends, so every line, the dropped one
  // included, eases straight into it.
  editor.drop(date, id, index, depth)
  editor.layout(date).settle()
  resetDrag()
  ui.set({ dragging: false })
}

/**
 * One line of a day: the hanging marker and a plain-text input, positioned by the day's
 * layout. Lines not being edited don't take touches themselves. A tap is forwarded so
 * the caret lands where the finger did, which leaves long press free to lift the line
 * and horizontal swipes free for actions.
 *
 *  - tap the text: edit there            - tap a bullet: make it a to-do
 *  - tap a box: complete / reopen        - long press: lift, then drag (sideways nests)
 *  - swipe right: to-do, then done       - swipe left: tomorrow; further: delete
 */
export const Row = memo(function Row({ id, date, depth, empty }: { id: string; date: ISODate; depth: number; empty?: boolean }) {
  const item = useItem(id)
  const c = useColors()
  const focused = useStore(ui, (s) => s.focusedId === id)
  const today = useStore(ui, (s) => s.today)
  const { width } = useWindowDimensions()
  const layout = editor.layout(date)
  const geometry = layout.geometry
  const input = useRef<TextInputInstance | null>(null)
  const ghost = !item
  const done = item?.type === 'todo' && item.done
  const flash = useStore(ui, (s) => (s.flash?.id === id ? s.flash.at : 0))
  const kind: SwipeKind = item?.type !== 'todo' ? 0 : done ? 2 : 1

  const setRef = useCallback(
    (el: TextInputInstance | null) => {
      if (input.current && input.current !== el) editor.unregister(id, input.current)
      input.current = el
      if (el) editor.register(id, el)
    },
    [id]
  )

  // iOS doesn't shrink a text view whose text is replaced with something shorter (Return
  // in the middle of a paragraph, an edit from another device), and the row would keep
  // the old height. Typing shrinks it fine. So when the text got shorter without typing,
  // the input is remounted once it isn't being edited, and measures itself again.
  const text = item?.text ?? ''
  const typed = useRef(text)
  const [generation, setGeneration] = useState(0)
  useLayoutEffect(() => {
    if (text.length >= typed.current.length) typed.current = text
    else if (!focused) {
      typed.current = text
      setGeneration((g) => g + 1)
    }
  }, [text, focused])

  /* ------------------------------------------------------------ Position */

  // Each line keeps its own offsets and animates only when its own target changes, so a
  // wrap, a Return or a drag frame moves the lines that move and leaves the rest alone.
  const y = useSharedValue(layout.frameOf(id)?.top ?? HIDDEN)
  const lift = useSharedValue(0)
  const x = useSharedValue(0)
  const sx = useSharedValue(0)

  useAnimatedReaction(
    () => {
      const g = geometry.value
      const index = g.index[id]
      const d = drag.value
      const swiped = swipe.id.value === id
      const swipeX = swiped ? swipe.x.value : 0
      if (index === undefined) return { top: HIDDEN, lifted: false, liftX: 0, ms: 0, swiped, swipeX }
      if (d.active && d.date === date) {
        const at = dragTop(d, g, index)!
        return { top: at.top, lifted: at.lifted, liftX: at.x, ms: 160, swiped, swipeX }
      }
      return { top: g.tops[index], lifted: false, liftX: 0, ms: g.animate ? 200 : 0, swiped, swipeX }
    },
    (next, prev) => {
      if (next.top !== prev?.top) {
        // A lifted line follows the finger; a line arriving or leaving doesn't fly in.
        const jump = !prev || next.lifted || !next.ms || next.top === HIDDEN || prev.top === HIDDEN
        y.value = jump ? next.top : withTiming(next.top, { duration: next.ms })
      }
      if (next.lifted !== (prev?.lifted ?? false)) lift.value = withTiming(next.lifted ? 1 : 0, { duration: next.lifted ? 120 : 160 })
      if (next.liftX !== (prev?.liftX ?? 0)) x.value = next.lifted ? withSpring(next.liftX, { damping: 22, stiffness: 320 }) : withTiming(next.liftX, { duration: 160 })
      // Swiping slides the whole line over the page's swipe underlay; when another line
      // takes the swipe, this one eases home.
      if (next.swipeX !== (prev?.swipeX ?? 0)) sx.value = next.swiped || !prev?.swiped ? next.swipeX : withTiming(0, { duration: 160 })
    }
  )

  // In dark, a lifted line takes the raised surface and a deeper shadow to stand off the page.
  const raised = c.bgElevated
  const page = c.bg
  const shadow = c === colors.dark ? 0.5 : 0.16
  const position = useAnimatedStyle(() => ({
    opacity: y.value === HIDDEN ? 0 : 1,
    zIndex: lift.value > 0 ? 10 : 0,
    backgroundColor: lift.value > 0 ? raised : page,
    shadowOpacity: shadow * lift.value,
    transform: [{ translateY: y.value }, { translateX: lift.value > 0 ? x.value : sx.value }, { scale: 1 + 0.02 * lift.value }]
  }))

  /* --------------------------------------------------------------- Drag */

  const liftStart = (e: { absoluteY: number }): void => {
    'worklet'
    if (beginDrag(date, id, geometry.value, e.absoluteY)) {
      scheduleOnRN(haptic, 'lift')
      scheduleOnRN(lifted)
    }
  }
  const liftMove = (e: { translationX: number; translationY: number; absoluteY: number }): void => {
    'worklet'
    if (drag.value.id !== id) return
    if (updateDrag(e.translationX, e.translationY, e.absoluteY)) scheduleOnRN(haptic, 'tick')
  }
  const liftEnd = (): void => {
    'worklet'
    const d = drag.value
    if (!d.active || d.id !== id || d.dropping) return
    // The line stays where it was let go until the drop is committed; then everything
    // settles into the new layout together.
    drag.value = { ...d, dropping: true }
    scheduleOnRN(dropped, date, id, d.index, d.depth)
  }
  const markerLift = usePanGesture({
    activateAfterLongPress: LIFT_DELAY,
    enabled: !ghost,
    onActivate: liftStart,
    onUpdate: liftMove,
    onFinalize: liftEnd
  })
  // The line being edited lifts only by its marker: a long press on its text belongs to
  // the caret and the loupe. A finger already moving sideways is a swipe, however slowly
  // it started: the lift gives way after 8 pt sideways (a long press alone allows 10).
  const bodyLift = usePanGesture({
    activateAfterLongPress: LIFT_DELAY,
    failOffsetX: [-8, 8],
    enabled: !ghost && !focused,
    onActivate: liftStart,
    onUpdate: liftMove,
    onFinalize: liftEnd
  })

  /* -------------------------------------------------------------- Swipe */

  const deleteAt = width * SWIPE_DELETE_FRACTION
  const swipeGesture = usePanGesture({
    enabled: !ghost && !focused,
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onActivate: () => {
      'worklet'
      swipe.id.value = id
      swipe.kind.value = kind
      swipe.x.value = 0
    },
    onUpdate: (e) => {
      'worklet'
      if (swipe.id.value !== id) return
      const x = e.translationX
      // Resist beyond the furthest action so the line never flies off under the finger.
      const limit = x > 0 ? SWIPE_ACT * 1.6 : deleteAt * 1.15
      const next = Math.abs(x) <= limit ? x : Math.sign(x) * (limit + (Math.abs(x) - limit) * 0.25)
      const was = swipe.x.value
      const crossed = (t: number) => (Math.abs(was) < t) !== (Math.abs(next) < t)
      if (crossed(SWIPE_ACT) || (next < 0 && crossed(deleteAt))) scheduleOnRN(haptic, 'threshold')
      swipe.x.value = next
    },
    onDeactivate: () => {
      'worklet'
      if (swipe.id.value !== id) return
      const x = swipe.x.value
      if (x >= SWIPE_ACT) {
        scheduleOnRN(advance, id)
        swipe.x.value = withSpring(0, { damping: 20, stiffness: 260 })
      } else if (x <= -deleteAt) {
        swipe.x.value = withTiming(-width, { duration: 160 }, () => scheduleOnRN(remove, id))
      } else if (x <= -SWIPE_ACT) {
        swipe.x.value = withTiming(-width, { duration: 160 }, () => scheduleOnRN(toTomorrow, id))
      } else {
        swipe.x.value = withSpring(0, { damping: 20, stiffness: 260 })
      }
    }
  })


  /* --------------------------------------------------------------- Taps */

  const bodyTap = useTapGesture({
    enabled: !focused,
    runOnJS: true,
    onActivate: (e) => {
      if (ghost) {
        editor.focus(id, 0)
        return
      }
      const fallback = (): void => editor.focus(id, item?.text.length ?? 0)
      void focusAt(input.current, e.absoluteX, e.absoluteY).then((offset) => {
        if (offset >= 0) editor.onSelection(id, { start: offset, end: offset })
        else fallback()
      }, fallback)
    }
  })
  const markerTap = useTapGesture({
    runOnJS: true,
    onActivate: () => {
      if (ghost) editor.focus(id, 0)
      else editor.tapMarker(id)
    }
  })

  const markerGesture = useCompetingGestures(markerLift, markerTap)
  const bodyGesture = useCompetingGestures(bodyLift, swipeGesture, bodyTap)

  return (
    <Animated.View
      style={[styles.row, position]}
      onLayout={(e) => layout.measure(id, e.nativeEvent.layout.height)}
    >
      <View style={[styles.line, { paddingLeft: metrics.gutter + depth * metrics.indent }]}>
        {flash ? <Glow at={flash} /> : null}
        {/* The whole marker column takes the tap, the gutter to its left included. */}
        <GestureDetector gesture={markerGesture}>
          <View style={styles.markerHit} collapsable={false}>
            <Marker type={item?.type ?? 'text'} done={!!done} />
          </View>
        </GestureDetector>
        <GestureDetector gesture={bodyGesture}>
          {/* A line that isn't being edited takes touches as a whole ("box-only"), so they come
              to this row's gestures: tap, lift, swipe. The tap is passed on with the caret
              where it landed. The line being edited takes its own touches, so the caret,
              selection and loupe work as usual. (Its input stays interactive either way,
              which it must be to take focus.) */}
          <View style={styles.body} collapsable={false} pointerEvents={focused ? 'auto' : 'box-only'}>
            <TextInput
              key={generation}
              ref={setRef}
              value={text}
              onChangeText={(value) => {
                typed.current = value
                editor.onChangeText(id, date, value)
              }}
              onSelectionChange={(e) => editor.onSelection(id, e.nativeEvent.selection)}
              onSubmitEditing={() => editor.onSubmit(id)}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === 'Backspace') editor.onBackspace(id, date)
              }}
              onFocus={() => editor.onFocus(id)}
              onBlur={() => editor.onBlur(id)}
              multiline
              scrollEnabled={false}
              submitBehavior="submit"
              placeholder={ghost && (empty || focused) ? (empty ? placeholderFor(date, today) : 'Start typing…') : undefined}
              placeholderTextColor={c.text3}
              selectionColor={c.accent}
              autoCapitalize="sentences"
              style={[styles.text, { color: done ? c.text3 : c.text }, done && styles.done]}
              nativeID={`line-${id}`}
              // For end-to-end tests: depth, type and text, e.g. "1/todo-done:Book flights".
              testID={ghost ? `new-line-${date}` : `${depth}/${item.type}${done ? '-done' : ''}:${item.text}`}
              accessibilityLabel={ghost ? 'New line' : item.type === 'todo' ? (done ? 'Completed to-do' : 'To-do') : item.type === 'bullet' ? 'Bullet' : 'Text'}
              // What the marker, swipes and drag do, for VoiceOver's actions rotor.
              accessibilityActions={ghost ? undefined : ACCESSIBILITY_ACTIONS[item.type === 'todo' ? (done ? 'done' : 'todo') : 'other']}
              onAccessibilityAction={(e) => onAccessibilityAction(id, e.nativeEvent.actionName)}
            />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  )
})

/** A line opened from search lights up briefly. */
function Glow({ at }: { at: number }) {
  const c = useColors()
  const glow = useSharedValue(1)
  useEffect(() => {
    glow.value = 1
    glow.value = withDelay(700, withTiming(0, { duration: 900 }))
  }, [at, glow])
  const style = useAnimatedStyle(() => ({ opacity: glow.value }))
  return <Animated.View style={[styles.glow, { backgroundColor: c.accentSoft }, style]} pointerEvents="none" />
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    shadowOpacity: 0
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: metrics.gutter
  },
  glow: {
    ...StyleSheet.absoluteFill,
    marginHorizontal: metrics.gutter - 8,
    borderRadius: 8
  },
  markerHit: {
    width: metrics.gutter + metrics.marker,
    marginLeft: -metrics.gutter,
    paddingLeft: metrics.gutter
  },
  body: {
    flex: 1,
    minWidth: 0
  },
  text: {
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    paddingTop: metrics.rowPadding,
    paddingBottom: metrics.rowPadding,
    paddingLeft: 0,
    paddingRight: 0,
    margin: 0
  },
  done: {
    textDecorationLine: 'line-through'
  }
})
