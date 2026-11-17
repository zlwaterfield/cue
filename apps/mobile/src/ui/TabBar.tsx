import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { isNotePage } from '@shared/notes'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { metrics, useColors } from './theme'

const BAR_HEIGHT = 56
const TAB_WIDTH = 84
const INSET = 4

/** How far the bar floats above the bottom of the screen: just over the home indicator. */
const barBottom = (inset: number): number => Math.max(inset - 12, 12)

/** Room the bar takes at the bottom of the screen; the toast keeps clear of it. */
export const tabBarSpace = (inset: number): number => barBottom(inset) + BAR_HEIGHT

// Liquid Glass where the system has it (iOS 26); before that, the keyboard toolbar's surface.
const glass = isLiquidGlassAvailable()

/**
 * The two places, and search, floating at the bottom of the screen: Today and Notes, the
 * Mac's Today and Notes tabs. Today is lit only on today, so from any other day it reads as
 * the way back; from a note it leaves for today. The keyboard covers the bar while writing,
 * where its own toolbar takes over.
 */
export function TabBar() {
  const insets = useSafeAreaInsets()
  const date = useStore(ui, (s) => s.date)
  const today = useStore(ui, (s) => s.today)
  const writing = useStore(ui, (s) => !!s.focusedId)
  const note = isNotePage(date)

  return (
    // Under the keyboard while it's up; it takes no touches then, so a drag past the
    // keyboard's edge can't land on a tab.
    <View style={[styles.row, { bottom: barBottom(insets.bottom) }]} pointerEvents={writing ? 'none' : 'box-none'}>
      <Surface style={styles.tabs} accessibilityRole="tablist">
        <Tab
          id="today"
          icon="sun.max"
          label="Today"
          selected={date === today}
          onPress={() => {
            if (date !== today) void Haptics.selectionAsync()
            void editor.goTo(today)
          }}
        />
        <Tab
          id="notes"
          icon="note.text"
          label="Notes"
          selected={note}
          onPress={() => {
            if (!note) void Haptics.selectionAsync()
            void editor.openNotes()
          }}
        />
      </Surface>
      <Surface style={styles.search}>
        <Pressable onPress={() => router.push('/search')} accessibilityRole="button" accessibilityLabel="Search" testID="tab-search" style={styles.searchButton}>
          <Icon name="magnifyingglass" size={21} selected />
        </Pressable>
      </Surface>
    </View>
  )
}

/** A capsule of glass, or of the page's elevated colour with a hairline and a soft shadow. */
function Surface({ style, children, accessibilityRole }: { style: StyleProp<ViewStyle>; children: React.ReactNode; accessibilityRole?: 'tablist' }) {
  const c = useColors()
  if (glass)
    return (
      <GlassView glassEffectStyle="regular" isInteractive style={style} accessibilityRole={accessibilityRole}>
        {children}
      </GlassView>
    )
  return (
    <View style={[style, styles.solid, { backgroundColor: c.bgElevated, borderColor: c.line }]} accessibilityRole={accessibilityRole}>
      {children}
    </View>
  )
}

function Icon({ name, size, selected }: { name: SFSymbol; size: number; selected: boolean }) {
  const c = useColors()
  return <SymbolView name={name} size={size} weight={selected ? 'semibold' : 'regular'} tintColor={selected ? c.text : c.text2} />
}

function Tab({ id, icon, label, selected, onPress }: { id: string; icon: SFSymbol; label: string; selected: boolean; onPress: () => void }) {
  const c = useColors()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={`tab-${id}`}
      style={[styles.tab, selected && { backgroundColor: c.accentSoft }]}
    >
      <Icon name={icon} size={20} selected={selected} />
      <Text style={[styles.label, { color: selected ? c.text : c.text2 }, selected && styles.selectedLabel]} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: metrics.gutter,
    right: metrics.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  tabs: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    padding: INSET,
    flexDirection: 'row',
    gap: 2
  },
  tab: {
    width: TAB_WIDTH,
    height: BAR_HEIGHT - 2 * INSET,
    borderRadius: (BAR_HEIGHT - 2 * INSET) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2
  },
  label: {
    fontSize: 10.5,
    fontWeight: '500',
    letterSpacing: 0.1
  },
  selectedLabel: {
    fontWeight: '600'
  },
  search: {
    width: BAR_HEIGHT,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2
  },
  searchButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  // The keyboard toolbar's surface.
  solid: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 }
  }
})
