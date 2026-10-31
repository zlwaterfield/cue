import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { linkDay, linkGroup, linkNote, type LinkEntry, type LinkResults } from '@shared/linkList'
import { bareLabel } from '@shared/links'
import { matchRanges, searchTerms } from '@shared/text'
import type { ISODate } from '@shared/types'
import { itemStore } from '../core/app'
import { listLinks, onPageRead, useLinkPreview } from '../core/links'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { SiteIcon } from '../editor/LinkLine'
import { openLink } from '../editor/Row'
import { metrics, useColors } from '../ui/theme'

/** After the first character, search again once typing pauses this long (as search does). */
const SETTLE = 30
/** Links asked for at a time; more as the list nears its end. */
const PAGE = 100
/** Pages read in the background arrive in bursts; a search runs again once they've settled. */
const PAGES_SETTLE = 400

/** Go to the line a link is on. */
const showLine = (link: LinkEntry): void => {
  router.back()
  void editor.show(link.id, link.date)
}

/**
 * Every link written on any day, newest first, under this week, last week and then the
 * month: the Mac's ⌘L. Typing finds a link by its line or by what its page says
 * (`core/linkList.ts`). Tap a link to open it; tap its day to go to the line it's on.
 */
export default function Links() {
  const c = useColors()
  const today = useStore(ui, (s) => s.today)
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  const [query, setQuery] = useState('')
  // Results stay with the query that found them, so "No matching links" is never said
  // about a query that's still being looked up.
  const [found, setFound] = useState<({ query: string } & LinkResults) | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [pagesRead, setPagesRead] = useState(0)
  const first = useRef(true)
  const searching = useRef(false)
  searching.current = !!query.trim()

  // Pages read while the list is open can make more links match a search: look again
  // once they've settled.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onPageRead(() => {
      if (!searching.current) return
      clearTimeout(timer)
      timer = setTimeout(() => setPagesRead((n) => n + 1), PAGES_SETTLE)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let live = true
    const run = (): void =>
      // Anything just typed is saved first, so its links are listed.
      void itemStore.persistence.settle().then(() => {
        if (live) setFound({ query: query.trim(), ...listLinks(query, limit) })
      })
    const timer = setTimeout(run, first.current ? 0 : SETTLE)
    first.current = false
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, limit, pagesRead])

  const sections = useMemo(() => {
    const out: Array<{ title: string; data: LinkEntry[] }> = []
    for (const link of found?.links ?? []) {
      const title = linkGroup(link.date, today, weekStartsOn)
      if (out[out.length - 1]?.title !== title) out.push({ title, data: [] })
      out[out.length - 1].data.push(link)
    }
    return out
  }, [found, today, weekStartsOn])

  const terms = searchTerms(found?.query ?? '').join(' ')
  const q = query.trim()
  const empty = !found ? null : q ? (found.query === q ? 'No matching links' : null) : 'Links you write or share show up here.'
  const renderItem = useCallback(({ item }: { item: LinkEntry }) => <LinkRow link={item} terms={terms} today={today} />, [terms, today])

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={[styles.field, { backgroundColor: c.bgSubtle }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <SymbolView name="link" size={16} tintColor={c.text3} />
          </View>
          <TextInput
            value={query}
            onChangeText={(text) => {
              setQuery(text)
              setLimit(PAGE)
            }}
            placeholder="Search links"
            placeholderTextColor={c.text3}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            selectionColor={c.accent}
            style={[styles.input, { color: c.text }]}
          />
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.done, { color: c.text }]}>Done</Text>
        </Pressable>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(link) => link.url}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.group, { color: c.text2, backgroundColor: c.bgElevated }]} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        stickySectionHeadersEnabled
        initialNumToRender={14}
        maxToRenderPerBatch={14}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={1}
        onEndReached={() => {
          if (found && found.links.length < found.total) setLimit((n) => Math.max(n, found.links.length) + PAGE)
        }}
        ListEmptyComponent={empty ? <Text style={[styles.empty, { color: c.text2 }]}>{empty}</Text> : undefined}
      />
    </View>
  )
}

const LinkRow = memo(function LinkRow({
  link,
  terms,
  today
}: {
  link: LinkEntry
  /** The query's terms joined by spaces, so rows stay equal while the terms do. */
  terms: string
  today: ISODate
}) {
  const c = useColors()
  const preview = useLinkPreview(link.url)
  const done = link.type === 'todo' && link.done
  const title = preview?.title ?? bareLabel(link.url)
  const note = linkNote(link.text)
  const sub = [preview?.title ? preview.byline : null, note || null].filter(Boolean).join(' · ')
  const words = terms ? terms.split(' ') : []
  return (
    <Pressable
      onPress={() => void openLink(link.url)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.bgHover }]}
      accessibilityRole="link"
      accessibilityHint="Opens the page"
      testID={`links-row:${link.url}`}
    >
      <SiteIcon url={link.url} done={done} style={styles.icon} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: done ? c.text3 : c.text }, done && styles.struck]} numberOfLines={2}>
          <Highlighted text={title} terms={words} mark={c.accentSoft} />
        </Text>
        {sub ? (
          <Text style={[styles.sub, { color: done ? c.text3 : c.text2 }]} numberOfLines={1}>
            <Highlighted text={sub} terms={words} mark={c.accentSoft} />
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => showLine(link)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Show on ${linkDay(link.date, today)}`}
        style={({ pressed }) => [styles.day, pressed && { backgroundColor: c.bgSubtle }]}
      >
        <Text style={[styles.dayText, { color: c.text2 }]} maxFontSizeMultiplier={1.4}>
          {linkDay(link.date, today)}
        </Text>
      </Pressable>
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
  done: {
    fontSize: 17,
    fontWeight: '600'
  },
  group: {
    paddingHorizontal: metrics.gutter,
    paddingTop: 14,
    paddingBottom: 4,
    fontSize: 13,
    fontWeight: '600'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: metrics.gutter,
    paddingRight: metrics.gutter - 6,
    paddingVertical: 8
  },
  icon: {
    width: metrics.marker,
    height: metrics.lineHeight,
    justifyContent: 'center'
  },
  text: {
    flex: 1,
    minWidth: 0
  },
  title: {
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight
  },
  struck: {
    textDecorationLine: 'line-through'
  },
  sub: {
    fontSize: 15,
    lineHeight: 20
  },
  day: {
    marginLeft: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    height: metrics.lineHeight,
    justifyContent: 'center'
  },
  dayText: {
    fontSize: 15
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 15
  }
})
