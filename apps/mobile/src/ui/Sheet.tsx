import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router, useNavigation } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useColors } from './theme'

/**
 * A sheet's title, with a close button at the trailing edge (a drag down closes it too).
 * A sheet that pushes (Settings) names the screen behind in `back`: the way back and the
 * way out share a row above the title, clear of the grabber, and the title stays the same
 * size wherever you are.
 */
export function SheetTitle({ title, back }: { title: string; back?: string }) {
  const c = useColors()
  // Close goes to the day, not back a screen. An action raised here reaches the innermost
  // stack first, and a stack answers "dismiss" by popping to its own first screen
  // (`expo-router`'s `findActionHandler`), so inside Settings it's the sheet that's asked.
  const sheet = useNavigation().getParent()
  const close = (
    <Pressable
      onPress={() => (back && sheet ? sheet.goBack() : router.back())}
      hitSlop={7}
      accessibilityRole="button"
      accessibilityLabel="Close"
      testID="sheet-close"
      style={({ pressed }) => [styles.close, { backgroundColor: pressed ? c.bgHover : c.bgSubtle }]}
    >
      <SymbolView name="xmark" size={13} weight="semibold" tintColor={c.text2} />
    </Pressable>
  )
  const heading = (
    <Text style={[styles.title, { color: c.text }]} accessibilityRole="header" numberOfLines={2} maxFontSizeMultiplier={1.6}>
      {title}
    </Text>
  )
  if (!back)
    return (
      <View style={styles.head}>
        {heading}
        {close}
      </View>
    )
  return (
    <View style={styles.stacked}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" testID="settings-back" style={styles.back}>
          {({ pressed }) => (
            <>
              <SymbolView name="chevron.left" size={14} weight="semibold" tintColor={pressed ? c.text3 : c.text2} />
              <Text style={[styles.backText, { color: pressed ? c.text3 : c.text2 }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {back}
              </Text>
            </>
          )}
        </Pressable>
        {close}
      </View>
      {heading}
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  // The back row sits where the title row sits on a sheet's first screen, so the close
  // button doesn't move as you go in and out.
  stacked: {
    gap: 10
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    // A title's line box, so the close button lands on the same spot on every screen.
    minHeight: 24
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: -3,
    flexShrink: 1
  },
  backText: {
    fontSize: 16
  },
  title: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '700'
  },
  // 30 pt, with the slop making a 44 pt target; it doesn't make the title row taller.
  close: {
    width: 30,
    height: 30,
    marginVertical: -3,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
