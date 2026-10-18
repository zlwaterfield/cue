import { useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { friendlyDate } from '@shared/dates'
import { matchRanges, searchTerms } from '@shared/text'
import type { SearchResult } from '@shared/types'
import { itemStore, repo } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { Marker } from '../editor/Marker'
import { metrics, useColors } from '../ui/theme'

/** Search every day, newest first; case and accents don't matter. The Mac's search, same index. */
export default function Search() {
  const c = useColors()
  const today = useStore(ui, (s) => s.today)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  useEffect(() => {
    let live = true
    // Anything just typed is saved first, so it can be found.
    void itemStore.persistence.settle().then(() => {
      if (live) setResults(query.trim() ? repo.search(query, 100) : [])
    })
    return () => {
      live = false
    }
  }, [query])

  const terms = searchTerms(query)

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={[styles.field, { backgroundColor: c.bgSubtle }]}>
          <SymbolView name="magnifyingglass" size={16} tintColor={c.text3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search every day"
            placeholderTextColor={c.text3}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            selectionColor={c.accent}
            style={[styles.input, { color: c.text }]}
          />
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.cancel, { color: c.text }]}>Cancel</Text>
        </Pressable>
      </View>
      <FlatList
        data={results}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          query.trim() ? <Text style={[styles.empty, { color: c.text3 }]}>Nothing found</Text> : undefined
        }
        renderItem={({ item: result }) => (
          <Pressable
            onPress={() => {
              router.back()
              void editor.show(result.id, result.date)
            }}
            style={({ pressed }) => [styles.result, pressed && { backgroundColor: c.bgHover }]}
          >
            <Text style={[styles.date, { color: c.text3 }]}>{friendlyDate(result.date, today)}</Text>
            <View style={styles.line}>
              <Marker type={result.type} done={result.done} />
              <Text
                style={[styles.text, { color: result.type === 'todo' && result.done ? c.text3 : c.text }, result.type === 'todo' && result.done && styles.done]}
                numberOfLines={3}
              >
                <Highlighted text={result.text} terms={terms} mark={c.accentSoft} />
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}

function Highlighted({ text, terms, mark }: { text: string; terms: string[]; mark: string }) {
  const ranges = matchRanges(text, terms)
  if (!ranges.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <Text key={i} style={{ backgroundColor: mark, fontWeight: '600' }}>
        {text.slice(start, end)}
      </Text>
    )
    at = end
  })
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: metrics.gutter,
    paddingTop: 16,
    paddingBottom: 8
  },
  field: {
    flex: 1,
    height: 40,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8
  },
  input: {
    flex: 1,
    fontSize: 17,
    height: 40
  },
  cancel: {
    fontSize: 17
  },
  result: {
    paddingLeft: metrics.gutter,
    paddingRight: metrics.gutter,
    paddingVertical: 8
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  date: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: metrics.marker
  },
  text: {
    flex: 1,
    fontSize: 17,
    lineHeight: metrics.lineHeight,
    paddingVertical: metrics.rowPadding
  },
  done: {
    textDecorationLine: 'line-through'
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 15
  }
})
