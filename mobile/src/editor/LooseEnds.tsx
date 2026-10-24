import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { shortDate } from '@shared/dates'
import { collectLooseEnds, looseEndDays, looseEndsLabel, looseEndsRange } from '@shared/looseEnds'
import type { ISODate, Item } from '@shared/types'
import { itemStore, repo } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { metrics, useColors } from '../ui/theme'
import { editor } from './controller'
import { BOX } from './Marker'

/**
 * The top of Today: one quiet line, "3 open from earlier days", that unfolds into those
 * to-dos. They stay on their own days; checking one off or moving it here is the same
 * edit as on its page. One checked off here stays, crossed out, until Today is next
 * opened, so the list doesn't jump under a finger. Same rules as the Mac (shared/looseEnds).
 */
export function LooseEnds({ today }: { today: ISODate }) {
  const c = useColors()
  const enabled = useStore(ui, (s) => s.settings.looseEnds)
  const open = useStore(ui, (s) => s.looseEndsOpen)
  // Checked off here this session; forgotten when the day changes.
  const finished = useRef({ today, ids: new Set<string>() })
  if (finished.current.today !== today) finished.current = { today, ids: new Set() }
  const kept = useCallback(() => finished.current.ids, [])
  const dates = useOpenTodoDates(today, enabled, kept)
  const version = useDays(dates)

  // `version` changes whenever one of the days does.
  const items = useMemo(() => collectLooseEnds(itemStore, dates, finished.current.ids), [dates, version])

  if (!enabled || !items.length) return null

  const openIds = items.filter((i) => !i.done).map((i) => i.id)
  const count = openIds.length
  const toggle = (): void => {
    void Haptics.selectionAsync()
    ui.set({ looseEndsOpen: !open })
  }
  const complete = (id: string): void => {
    finished.current.ids.add(id)
    editor.completeElsewhere(id)
  }

  return (
    <View style={[styles.block, open && { borderBottomColor: c.line, borderBottomWidth: StyleSheet.hairlineWidth }]} testID="loose-ends">
      <View style={styles.head}>
        <Pressable
          onPress={toggle}
          style={styles.toggle}
          hitSlop={{ top: 6, bottom: 6 }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          testID="loose-ends-toggle"
        >
          <View style={styles.chevronCell}>
            <SymbolView name={open ? 'chevron.down' : 'chevron.right'} size={11} weight="semibold" tintColor={c.text2} />
          </View>
          <Text style={[styles.label, { color: c.text2 }]} maxFontSizeMultiplier={1.6}>
            {looseEndsLabel(count)}
          </Text>
        </Pressable>
        {open && count > 1 && (
          <Pressable onPress={() => void editor.pullToToday(openIds)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Move all to today">
            {({ pressed }) => (
              <Text style={[styles.label, { color: pressed ? c.text : c.text2 }]} maxFontSizeMultiplier={1.6}>
                Move all
              </Text>
            )}
          </Pressable>
        )}
      </View>
      {open && items.map((item) => <LooseEnd key={item.id} item={item} today={today} onComplete={complete} />)}
    </View>
  )
}

function LooseEnd({ item, today, onComplete }: { item: Item; today: ISODate; onComplete: (id: string) => void }) {
  const c = useColors()
  const date = shortDate(item.date, today)
  return (
    <View style={styles.row} testID={`loose-end-${item.id}`}>
      {/* The whole margin cell checks it, not just the box. */}
      <Pressable
        onPress={() => onComplete(item.id)}
        style={styles.markerCell}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.done ? `Reopen ${item.text}` : `Complete ${item.text}`}
      >
        <View style={[styles.box, item.done ? { backgroundColor: c.accent, borderColor: c.accent } : { borderColor: c.lineStrong }]}>
          {item.done && (
            <Svg width={BOX - 2} height={BOX - 2} viewBox="0 0 16 16">
              <Path d="M4.2 8.4l2.4 2.4 5.2-5.6" fill="none" stroke={c.onAccent} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          )}
        </View>
      </Pressable>
      <Pressable
        onPress={() => void editor.show(item.id, item.date)}
        style={styles.textCell}
        accessibilityRole="button"
        accessibilityLabel={`${item.text}, ${date}`}
        accessibilityHint="Opens its day"
      >
        <Text
          numberOfLines={1}
          style={[styles.text, { color: item.done ? c.text3 : c.text }, item.done && styles.done]}
          maxFontSizeMultiplier={2}
        >
          {item.text}
        </Text>
        <Text style={[styles.date, { color: c.text2 }]} maxFontSizeMultiplier={1.6}>
          {date}
        </Text>
      </Pressable>
      {!item.done && (
        <Pressable
          onPress={() => void editor.pullToToday([item.id])}
          hitSlop={8}
          style={({ pressed }) => [styles.move, { backgroundColor: pressed ? c.bgHover : c.bgSubtle }]}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.text} to today`}
        >
          <Text style={[styles.moveText, { color: c.text }]} maxFontSizeMultiplier={1.4}>
            Today
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/**
 * The earlier days that have an unfinished to-do, loaded into the store, plus the days of
 * those checked off here (`kept`). Asked again when the day changes, when edits here are
 * saved (a to-do moved back to an earlier day), and when sync or a sign-out changes things.
 */
function useOpenTodoDates(today: ISODate, enabled: boolean, kept: () => ReadonlySet<string>): ISODate[] {
  const [dates, setDates] = useState<ISODate[]>([])
  useEffect(() => {
    if (!enabled) return
    let latest = 0
    const refresh = async (): Promise<void> => {
      const seq = ++latest
      await itemStore.persistence.settle()
      const { from, to } = looseEndsRange(today)
      const found = repo.datesWithOpenTodos(from, to)
      await itemStore.ensureLoaded(found)
      // A later refresh started meanwhile; it has the newer answer.
      if (seq !== latest) return
      const next = looseEndDays(found, kept(), itemStore, today)
      setDates((prev) => (prev.length === next.length && prev.every((d, i) => d === next[i]) ? prev : next))
    }
    void refresh()
    const offSaved = itemStore.persistence.subscribe(() => {
      if (itemStore.persistence.status.state === 'saved') void refresh()
    })
    const offExternal = itemStore.onExternal(() => void refresh())
    const offReset = itemStore.onReset(() => void refresh())
    return () => {
      latest = -1
      offSaved()
      offExternal()
      offReset()
    }
  }, [today, enabled, kept])
  return dates
}

/**
 * A number that changes whenever anything on these days does. Days only announce lines
 * arriving, leaving and moving, so each line is watched too (checked off, retyped).
 */
function useDays(dates: ISODate[]): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const offs = dates.flatMap((date) => [
      itemStore.subscribeDate(date, bump),
      ...itemStore.outline(date).map((row) => itemStore.subscribeItem(row.id, bump))
    ])
    return () => offs.forEach((off) => off())
  }, [dates, version])
  return version
}

const styles = StyleSheet.create({
  block: {
    marginTop: -4,
    marginBottom: 8,
    paddingBottom: 4
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: metrics.gutter,
    minHeight: 36
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    paddingLeft: metrics.gutter,
    paddingVertical: 6
  },
  // The chevron hangs in the marker column, so the words start on the text edge.
  chevronCell: {
    width: metrics.marker,
    paddingLeft: 3
  },
  label: {
    fontSize: 15
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingRight: metrics.gutter
  },
  markerCell: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingLeft: metrics.gutter,
    width: metrics.gutter + metrics.marker
  },
  box: {
    width: BOX,
    height: BOX,
    borderRadius: 5.5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center'
  },
  textCell: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 5,
    paddingRight: 12
  },
  text: {
    fontSize: 16,
    lineHeight: 21
  },
  done: {
    textDecorationLine: 'line-through'
  },
  date: {
    fontSize: 13,
    lineHeight: 17,
    marginTop: 1
  },
  move: {
    borderRadius: 8,
    paddingHorizontal: 11,
    height: 30,
    justifyContent: 'center'
  },
  moveText: {
    fontSize: 14,
    fontWeight: '500'
  }
})
