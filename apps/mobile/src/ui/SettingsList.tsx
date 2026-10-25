import { Children } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useNavigation } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { metrics, useColors } from './theme'

/**
 * The parts every Settings screen is made of: an inset group with a title above and a
 * footnote below, its rows, and the segmented control a choice uses. The Mac's rail is
 * this screen's index, so each category is a push (`app/settings/`).
 */

/** A sub-screen of Settings: back to the index on the left, close the sheet on the right. */
export function SettingsScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors()
  // Close goes to the day, not back to the index. An action raised here reaches this
  // stack first, and a stack answers "dismiss" by popping to its own first screen
  // (`expo-router`'s `findActionHandler`), so it has to be the sheet that's asked.
  const sheet = useNavigation().getParent()
  return (
    <View style={[styles.screen, { backgroundColor: c.bgElevated }]}>
      <View style={[styles.nav, { borderBottomColor: c.line }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" testID="settings-back" style={styles.back}>
          {({ pressed }) => (
            <>
              <SymbolView name="chevron.left" size={15} weight="semibold" tintColor={pressed ? c.text2 : c.text} />
              <Text style={[styles.backText, { color: pressed ? c.text2 : c.text }]} maxFontSizeMultiplier={1.4}>
                Settings
              </Text>
            </>
          )}
        </Pressable>
        <Text
          style={[styles.navTitle, { color: c.text }]}
          pointerEvents="none"
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={1.4}
        >
          {title}
        </Text>
        <Pressable
          onPress={() => sheet?.goBack()}
          hitSlop={7}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID="sheet-close"
          style={({ pressed }) => [styles.close, { backgroundColor: pressed ? c.bgHover : c.bgSubtle }]}
        >
          <SymbolView name="xmark" size={13} weight="semibold" tintColor={c.text2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
    </View>
  )
}

export function Section({ title, footnote, children }: { title?: string; footnote?: string; children: React.ReactNode }) {
  const c = useColors()
  return (
    <View style={styles.section}>
      {title && <Text style={[styles.sectionTitle, { color: c.text2 }]}>{title}</Text>}
      <View style={[styles.group, { backgroundColor: c.bgSubtle }]}>
        {Children.toArray(children).map((child, i) => (
          <View key={i}>
            {i > 0 && <View style={[styles.separator, { backgroundColor: c.line }]} />}
            {child}
          </View>
        ))}
      </View>
      {footnote && <Text style={[styles.footnote, { color: c.text2 }]}>{footnote}</Text>}
    </View>
  )
}

/**
 * A row is a button, or, with an `action` word, a label with that button at its end.
 * `value` is the setting as it stands, and `chevron` marks a row that opens a screen.
 */
export function Row({
  label,
  action,
  value,
  chevron,
  onPress,
  disabled,
  testID
}: {
  label: string
  action?: string
  value?: string
  chevron?: boolean
  onPress?: () => void
  disabled?: boolean
  testID?: string
}) {
  const c = useColors()
  const text = (
    <Text style={[styles.rowLabel, { color: c.text }]} numberOfLines={2}>
      {label}
    </Text>
  )
  const trailing = (
    <>
      {value && (
        <Text style={[styles.rowValue, { color: c.text2 }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {chevron && <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.text3} />}
    </>
  )
  if (action) {
    return (
      <View style={styles.row}>
        {text}
        <Pressable onPress={onPress} disabled={disabled} hitSlop={12} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}>
          {({ pressed }) => <Text style={[styles.rowAction, { color: c.text }, (pressed || disabled) && styles.rowDimmed]}>{action}</Text>}
        </Pressable>
      </View>
    )
  }
  if (!onPress)
    return (
      <View style={styles.row}>
        {text}
        {trailing}
      </View>
    )
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.bgHover }, disabled && styles.rowDimmed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      {text}
      {trailing}
    </Pressable>
  )
}

export function Segmented<T extends string | number | boolean>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  const c = useColors()
  return (
    <View style={styles.segmented}>
      {options.map(([option, label]) => {
        const selected = option === value
        return (
          <Pressable
            key={String(option)}
            onPress={() => onChange(option)}
            style={[styles.segment, selected && { backgroundColor: c.bgSelected, shadowOpacity: 0.08 }]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            {/* Like iOS's own segmented controls, the words stop growing before they'd break mid-word. */}
            <Text style={[styles.segmentText, { color: selected ? c.text : c.text2 }, selected && styles.segmentSelected]} maxFontSizeMultiplier={1.6}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  nav: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: -4
  },
  backText: {
    fontSize: 16
  },
  // Centred over the whole bar, so it doesn't shift with the back label's width.
  navTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 46,
    lineHeight: 46,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600'
  },
  close: {
    width: 30,
    height: 30,
    marginLeft: 'auto',
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center'
  },
  body: {
    padding: metrics.gutter,
    paddingTop: 20,
    gap: 22
  },
  sheet: {
    padding: metrics.gutter,
    paddingTop: 22,
    gap: 22
  },
  section: {
    gap: 8
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginLeft: 4
  },
  group: {
    borderRadius: 12,
    overflow: 'hidden'
  },
  footnote: {
    fontSize: 13,
    marginHorizontal: 4
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14
  },
  row: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  rowLabel: {
    flex: 1,
    fontSize: 16
  },
  rowValue: {
    fontSize: 16,
    flexShrink: 1
  },
  rowAction: {
    fontSize: 16,
    fontWeight: '600'
  },
  rowDimmed: {
    opacity: 0.45
  },
  segmented: {
    flexDirection: 'row',
    padding: 3,
    gap: 3
  },
  segment: {
    flex: 1,
    minHeight: 36,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 0
  },
  segmentText: {
    fontSize: 15,
    textAlign: 'center'
  },
  segmentSelected: {
    fontWeight: '600'
  },
  about: {
    alignItems: 'center',
    gap: 8,
    marginTop: 8
  },
  version: {
    fontSize: 13,
    textAlign: 'center'
  }
})
