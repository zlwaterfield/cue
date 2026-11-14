import { ScrollView, Pressable, StyleSheet, Text } from 'react-native'
import * as Haptics from 'expo-haptics'
import { SymbolView } from 'expo-symbols'
import type { ISODate } from '@shared/types'
import { SCRATCH } from '@shared/notes'
import { useNotePages, useNoteTitle } from '../core/notes'
import { useOutline } from '../editor/hooks'
import { editor } from '../editor/controller'
import { metrics, useColors } from './theme'

/**
 * The notes there are, where the week strip is while a day is open: scratch first, then the
 * starred notes, newest first, then a plus for a new one. Tap one to open it. There are only ever a few, so the row
 * scrolls sideways rather than growing a second way to browse.
 */
export function NoteStrip({ current }: { current: ISODate }) {
  const listed = useNotePages()
  // A new note isn't one until something is written on it; it still has its place in the row.
  const pages = listed.includes(current) ? listed : [listed[0], current, ...listed.slice(1)]
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled" accessibilityRole="tablist">
      {pages.map((date) => (
        <NoteTab key={date} date={date} selected={date === current} />
      ))}
      <NewNote />
    </ScrollView>
  )
}

function NoteTab({ date, selected }: { date: ISODate; selected: boolean }) {
  const c = useColors()
  const name = useNoteTitle(date)
  const title = useOutline(date).length || date === SCRATCH ? name : 'New note'
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

function NewNote() {
  const c = useColors()
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync()
        void editor.newNote()
      }}
      style={styles.add}
      accessibilityRole="button"
      accessibilityLabel="New note"
      testID="note-new"
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}
    >
      <SymbolView name="plus" size={17} weight="medium" tintColor={c.text2} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  add: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center'
  },
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
