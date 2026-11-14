import { ScrollView, Pressable, StyleSheet, Text } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { ISODate } from '@shared/types'
import { useNotePages, useNoteTitle } from '../core/notes'
import { editor } from '../editor/controller'
import { metrics, useColors } from './theme'

/**
 * The notes there are, where the week strip is while a day is open: scratch first, then the
 * starred notes, newest first. Tap one to open it. There are only ever a few, so the row
 * scrolls sideways rather than growing a second way to browse.
 */
export function NoteStrip({ current }: { current: ISODate }) {
  const pages = useNotePages()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled" accessibilityRole="tablist">
      {pages.map((date) => (
        <NoteTab key={date} date={date} selected={date === current} />
      ))}
    </ScrollView>
  )
}

function NoteTab({ date, selected }: { date: ISODate; selected: boolean }) {
  const c = useColors()
  const title = useNoteTitle(date)
  return (
    <Pressable
      onPress={() => {
        if (!selected) void Haptics.selectionAsync()
        void editor.goTo(date)
      }}
      style={[styles.tab, selected && { backgroundColor: c.accent }]}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      testID={`note-${title}`}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      <Text style={[styles.title, { color: selected ? c.onAccent : c.text2 }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  strip: {
    gap: 6,
    // The first name starts on the screen's outer edge, like the week's first day.
    paddingHorizontal: metrics.gutter - 13,
    paddingTop: 6,
    paddingBottom: 12
  },
  tab: {
    maxWidth: 180,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 13,
    justifyContent: 'center'
  },
  title: {
    fontSize: 15,
    fontWeight: '500'
  }
})
