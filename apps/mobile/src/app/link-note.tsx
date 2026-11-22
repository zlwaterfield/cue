import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import type { ISODate } from '@shared/types'
import { useNotePages, useNoteTitle } from '../core/notes'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { SheetTitle } from '../ui/Sheet'
import { metrics, useColors } from '../ui/theme'

/**
 * Link a starred note from a line: the toolbar's note button, or "@" on an empty line. The
 * line becomes the note's name, and tapping it opens the note (`ops.linkNote`).
 */
export default function LinkNoteSheet() {
  const c = useColors()
  const { id } = useLocalSearchParams<{ id: string }>()
  const here = useStore(ui, (s) => s.date)
  // Scratch is for what you'll throw away, and a note isn't linked from itself.
  const choices = useNotePages()
    .slice(1)
    .filter((date) => date !== here)

  const link = (note: ISODate): void => {
    router.back()
    if (id) editor.linkNote(id, note)
  }

  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <SheetTitle title="Link a note…" />
      {choices.length ? (
        <View style={[styles.list, { backgroundColor: c.bgSubtle }]}>
          {choices.map((date, i) => (
            <Choice key={date} date={date} first={i === 0} onPress={() => link(date)} />
          ))}
        </View>
      ) : (
        <Text style={[styles.empty, { color: c.text2 }]}>No starred notes yet. Start one from the Notes tab.</Text>
      )}
    </ScrollView>
  )
}

function Choice({ date, first, onPress }: { date: ISODate; first: boolean; onPress: () => void }) {
  const c = useColors()
  const title = useNoteTitle(date)
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.choice, !first && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: c.bgHover }]}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={`link-note-${title}`}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView name="doc.text" size={18} tintColor={c.text2} />
      </View>
      <Text style={[styles.label, { color: c.text }]} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: {
    padding: metrics.gutter,
    paddingTop: 22,
    gap: 14
  },
  list: {
    borderRadius: 12,
    overflow: 'hidden'
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48
  },
  label: {
    flex: 1,
    fontSize: 16
  },
  empty: {
    fontSize: 15
  }
})
