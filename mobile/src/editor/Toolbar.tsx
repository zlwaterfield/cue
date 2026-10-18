import { useRef } from 'react'
import { Keyboard, Pressable, StyleSheet, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { useColors } from '../ui/theme'
import { editor } from './controller'
import { useItem } from './hooks'

/** Height of the bar; the page keeps the line being edited clear of it. */
export const TOOLBAR_HEIGHT = 46

/**
 * The bar above the keyboard while writing. Line types are one tap each: ☐ makes the line
 * a to-do and • a bullet, and tapping the lit one turns it back into plain text. Then
 * indent, undo, and "move to another day".
 */
export function Toolbar() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  // Focus passes through nothing for a moment when it moves between lines; the bar keeps
  // showing the line it had rather than flickering.
  const current = useStore(ui, (s) => s.focusedId)
  const last = useRef(current)
  if (current) last.current = current
  const focused = last.current
  const item = useItem(focused ?? '')
  const type = item?.type ?? 'text'

  return (
    // Rides on top of the keyboard, following it as it opens, closes, and is dragged away.
    <KeyboardStickyView style={styles.sticky} offset={{ closed: -insets.bottom, opened: 0 }} pointerEvents="box-none">
      {current && (
        <View style={[styles.bar, { borderTopColor: c.line, backgroundColor: c.bgElevated }]}>
          <Tool id="todo" icon="checkmark.square" label="To-do" active={type === 'todo'} onPress={() => focused && editor.toggleType(focused, 'todo')} />
          <Tool id="bullet" icon="list.bullet" label="Bullet" active={type === 'bullet'} onPress={() => focused && editor.toggleType(focused, 'bullet')} />
          <View style={[styles.divider, { backgroundColor: c.line }]} />
          <Tool id="outdent" icon="decrease.indent" label="Outdent" onPress={() => focused && editor.outdent(focused)} />
          <Tool id="indent" icon="increase.indent" label="Indent" onPress={() => focused && editor.indent(focused)} />
          <View style={[styles.divider, { backgroundColor: c.line }]} />
          <Tool id="undo" icon="arrow.uturn.backward" label="Undo" onPress={() => editor.undoAction()} />
          <Tool
            id="move"
            icon="calendar"
            label="Move to another day"
            disabled={!item}
            onPress={() => item && router.push({ pathname: '/move', params: { id: item.id } })}
          />
          <View style={styles.spacer} />
          <Tool id="hide" icon="keyboard.chevron.compact.down" label="Hide keyboard" onPress={() => Keyboard.dismiss()} />
        </View>
      )}
    </KeyboardStickyView>
  )
}

function Tool({
  id,
  icon,
  label,
  active,
  disabled,
  onPress
}: {
  id: string
  icon: SFSymbol
  label: string
  active?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const c = useColors()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      hitSlop={4}
      testID={`tool-${id}`}
      style={({ pressed }) => [
        styles.tool,
        active && { backgroundColor: c.accent },
        pressed && !active && { backgroundColor: c.bgHover }
      ]}
    >
      <SymbolView name={icon} size={19} weight="medium" tintColor={active ? c.onAccent : disabled ? c.text3 : c.text} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0
  },
  bar: {
    height: TOOLBAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  tool: {
    width: 40,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center'
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    marginHorizontal: 4
  },
  spacer: {
    flex: 1
  }
})
