import { Pressable, StyleSheet, Text, useColorScheme } from 'react-native'
import Animated, { FadeInDown, FadeOutDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { TOOLBAR_SPACE } from '../editor/Toolbar'
import { useColors } from './theme'

/** A quiet confirmation after a move or a delete, with Undo. Sits above the keyboard. */
export function Toast() {
  const c = useColors()
  const toast = useStore(ui, (s) => s.toast)
  const insets = useSafeAreaInsets()
  const keyboard = useAnimatedKeyboard()
  // In dark the toast is close to the page, so a hairline gives it an edge.
  const dark = useColorScheme() === 'dark'
  // Above the keyboard and the toolbar on it, or above the home indicator.
  const lift = useAnimatedStyle(() => ({
    bottom: keyboard.height.value > 0 ? keyboard.height.value + TOOLBAR_SPACE + 10 : insets.bottom + 12
  }))
  if (!toast) return null
  return (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(140)}
      style={[styles.toast, { backgroundColor: c.toastBg }, dark && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }, lift]}
      accessibilityRole="alert"
    >
      <Text style={[styles.message, { color: c.toastText }]}>{toast.message}</Text>
      {toast.undo && (
        <Pressable onPress={() => editor.undoToast()} hitSlop={10} accessibilityRole="button">
          <Text style={[styles.undo, { color: c.toastText }]}>Undo</Text>
        </Pressable>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }
  },
  message: {
    fontSize: 15
  },
  undo: {
    fontSize: 15,
    fontWeight: '600'
  }
})
