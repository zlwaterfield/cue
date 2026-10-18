import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { addDays, addMonths, friendlyDate, longDate, MONTHS, parts, startOfMonth, startOfWeek } from '@shared/dates'
import { parseDateInput } from '@shared/dateParse'
import type { ISODate } from '@shared/types'
import { repo, sync } from '../core/app'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { metrics, useColors } from './theme'

/**
 * Pick a day: type it the way you'd say it ("fri", "oct 31", "in 3 days", "+2w") with the
 * Mac's parser, or tap it on the month grid. Days with notes get a quiet dot.
 */
export function DatePicker({ selected, action, onPick }: { selected: ISODate; action: string; onPick: (date: ISODate) => void }) {
  const c = useColors()
  const today = useStore(ui, (s) => s.today)
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  const [query, setQuery] = useState('')
  const parsed = query.trim() ? parseDateInput(query, today, { weekStartsOn }) : null

  return (
    <View style={styles.picker}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => parsed && onPick(parsed)}
        placeholder="Type a date: fri, oct 31, in 3 days"
        placeholderTextColor={c.text3}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="go"
        selectionColor={c.accent}
        style={[styles.query, { backgroundColor: c.bgSubtle, color: c.text }]}
        accessibilityLabel="Date"
      />
      {query.trim() !== '' && (
        <Pressable
          disabled={!parsed}
          onPress={() => parsed && onPick(parsed)}
          style={({ pressed }) => [styles.match, { backgroundColor: pressed ? c.bgHover : 'transparent' }]}
          accessibilityRole="button"
        >
          <Text style={[styles.matchText, { color: parsed ? c.text : c.text3 }]}>
            {parsed ? `${action} ${friendlyDate(parsed, today)} · ${longDate(parsed)}` : 'No date matches that yet'}
          </Text>
        </Pressable>
      )}
      <Month selected={selected} today={today} weekStartsOn={weekStartsOn} onPick={onPick} />
    </View>
  )
}

function Month({
  selected,
  today,
  weekStartsOn,
  onPick
}: {
  selected: ISODate
  today: ISODate
  weekStartsOn: 0 | 1
  onPick: (date: ISODate) => void
}) {
  const c = useColors()
  const [month, setMonth] = useState(() => startOfMonth(selected))
  const days = useMemo(() => {
    const first = startOfWeek(month, weekStartsOn)
    return Array.from({ length: 42 }, (_, i) => addDays(first, i))
  }, [month, weekStartsOn])
  // Read again after each sync, so notes arriving from another device get their dot.
  const synced = useStore(sync.state, (s) => s.lastSyncedAt)
  const marked = useMemo(() => new Set(repo.datesWithItems(days[0], days[days.length - 1])), [days, synced])
  const { year, month: m } = parts(month)
  const labels = weekStartsOn === 1 ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <View>
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.text }]}>
          {MONTHS[m - 1]} <Text style={{ color: c.text3 }}>{year}</Text>
        </Text>
        <View style={styles.nav}>
          <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={8} accessibilityLabel="Previous month" style={styles.navButton}>
            <SymbolView name="chevron.left" size={15} weight="semibold" tintColor={c.text2} />
          </Pressable>
          <Pressable onPress={() => setMonth(addMonths(month, 1))} hitSlop={8} accessibilityLabel="Next month" style={styles.navButton}>
            <SymbolView name="chevron.right" size={15} weight="semibold" tintColor={c.text2} />
          </Pressable>
        </View>
      </View>
      <View style={styles.grid}>
        {labels.map((label, i) => (
          <Text key={`l${i}`} style={[styles.label, { color: c.text2 }]}>
            {label}
          </Text>
        ))}
        {days.map((day) => {
          const inMonth = parts(day).month === m
          const isSelected = day === selected
          const isToday = day === today
          return (
            <Pressable
              key={day}
              style={styles.cell}
              onPress={() => {
                void Haptics.selectionAsync()
                onPick(day)
              }}
              accessibilityLabel={longDate(day)}
              accessibilityState={{ selected: isSelected }}
            >
              <View style={[styles.circle, isSelected && { backgroundColor: c.accent }, !isSelected && isToday && { borderWidth: 1, borderColor: c.lineStrong }]}>
                <Text style={[styles.day, { color: isSelected ? c.onAccent : inMonth ? c.text : c.text3 }, isToday && styles.today]}>
                  {parts(day).day}
                </Text>
              </View>
              <View style={[styles.dot, { backgroundColor: marked.has(day) && !isSelected ? c.text3 : 'transparent' }]} />
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  picker: {
    gap: 10
  },
  query: {
    height: 44,
    borderRadius: 11,
    paddingHorizontal: 12,
    fontSize: 16
  },
  match: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 4
  },
  matchText: {
    fontSize: 15
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6
  },
  title: {
    fontSize: 16,
    fontWeight: '600'
  },
  nav: {
    flexDirection: 'row',
    gap: 6
  },
  navButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center'
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  label: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    paddingBottom: 4
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 2
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  day: {
    fontSize: 16,
    fontVariant: ['tabular-nums']
  },
  today: {
    fontWeight: '700'
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 1
  }
})

export const sheetPadding = metrics.gutter
