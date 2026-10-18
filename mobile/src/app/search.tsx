import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { friendlyDate } from '@shared/dates'
import { matchRanges, searchTerms } from '@shared/text'
import type { ISODate, SearchResult } from '@shared/types'
import { itemStore, repo } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { Marker } from '../editor/Marker'
import { metrics, useColors } from '../ui/theme'

/** After the first character, search again once typing pauses this long. */
const SETTLE = 100

const open = (result: SearchResult): void => {
  router.back()
  void editor.show(result.id, result.date)
}

/** Search every day, newest first; case and accents don't matter. The Mac's search, same index. */
export default function Search() {
  const c = useColors()
  const today = useStore(ui, (s) => s.today)
  const [query, setQuery] = useState('')
  // Results stay with the query that found them: while a newer one is on its way the last
  // results stay up, and "No matches" is never said about a query that might match.
  const [found, setFound] = useState<{ query: string; results: SearchResult[] }>({ query: '', results: [] })
  const previous = useRef('')

  useEffect(() => {
    const q = query.trim()
    const first = !previous.current
    previous.current = q
    if (!q) {
      setFound({ query: '', results: [] })
      return
    }
    let live = true
    const run = (): void =>
      // Anything just typed is saved first, so it can be found.
      void itemStore.persistence.settle().then(() => {
        if (live) setFound({ query: q, results: repo.search(q, 100) })
      })
    const timer = setTimeout(run, first ? 0 : SETTLE)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  const terms = searchTerms(found.query).join(' ')
  const renderItem = useCallback(
    ({ item }: { item: SearchResult }) => <ResultRow result={item} terms={terms} today={today} onOpen={open} />,
    [terms, today]
  )

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={[styles.field, { backgroundColor: c.bgSubtle }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <SymbolView name="magnifyingglass" size={16} tintColor={c.text3} />
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search all notes"
            placeholderTextColor={c.text3}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
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
        data={found.results}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Typing on from a query with no matches can't find any either.
        ListEmptyComponent={
          found.query && query.trim().startsWith(found.query) ? <Text style={[styles.empty, { color: c.text2 }]}>No matches</Text> : undefined
        }
      />
    </View>
  )
}

const ResultRow = memo(function ResultRow({
  result,
  terms,
  today,
  onOpen
}: {
  result: SearchResult
  /** The query's terms joined by spaces, so rows stay equal while the terms do. */
  terms: string
  today: ISODate
  onOpen: (result: SearchResult) => void
}) {
  const c = useColors()
  const done = result.type === 'todo' && result.done
  return (
    <Pressable onPress={() => onOpen(result)} style={({ pressed }) => [styles.result, pressed && { backgroundColor: c.bgHover }]} testID="search-result">
      <Text style={[styles.date, { color: c.text2 }]}>{friendlyDate(result.date, today)}</Text>
      <View style={styles.line}>
        <Marker type={result.type} done={result.done} />
        <Text style={[styles.text, { color: done ? c.text3 : c.text }, done && styles.done]} numberOfLines={3}>
          <Highlighted text={result.text} terms={terms ? terms.split(' ') : []} mark={c.accentSoft} />
        </Text>
      </View>
    </Pressable>
  )
})

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
