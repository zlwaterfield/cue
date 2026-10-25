import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useColors } from './theme'

/** A sheet's title, with a close button at the trailing edge (a drag down closes it too). */
export function SheetTitle({ title }: { title: string }) {
  const c = useColors()
  return (
    <View style={styles.head}>
      <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Pressable
        onPress={() => router.back()}
        hitSlop={7}
        accessibilityRole="button"
        accessibilityLabel="Close"
        testID="sheet-close"
        style={({ pressed }) => [styles.close, { backgroundColor: pressed ? c.bgHover : c.bgSubtle }]}
      >
        <SymbolView name="xmark" size={13} weight="semibold" tintColor={c.text2} />
      </Pressable>
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
