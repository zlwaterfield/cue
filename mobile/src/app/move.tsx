import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { addDays, friendlyDate, nextWeekday, shortDate, startOfWeek, WEEKDAYS, weekday } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { useItem } from '../editor/hooks'
import { DatePicker } from '../ui/Calendar'
import { metrics, useColors } from '../ui/theme'

/** Move a line (and its children) to another day: the usual choices first, then any date. */
export default function MoveSheet() {
  const c = useColors()
  const { id } = useLocalSearchParams<{ id: string }>()
  const item = useItem(id ?? '')
  const today = useStore(ui, (s) => s.today)
  const weekStartsOn = useStore(ui, (s) => s.settings.weekStartsOn)
  if (!item) return null

  const move = (date: ISODate): void => {
    router.back()
    void editor.moveTo(item.id, date)
  }
  const tomorrow = addDays(today, 1)
  const weekdayNext = nextWeekday(today)
  const nextWeek = addDays(startOfWeek(today, weekStartsOn), 7)
  const options: Array<{ icon: SFSymbol; label: string; detail: string; date: ISODate }> = [
    { icon: 'sun.max', label: 'Today', detail: shortDate(today), date: today },
    { icon: 'sunrise', label: 'Tomorrow', detail: shortDate(tomorrow), date: tomorrow },
    { icon: 'briefcase', label: 'Next weekday', detail: WEEKDAYS[weekday(weekdayNext)], date: weekdayNext },
    { icon: 'calendar.badge.plus', label: 'Next week', detail: shortDate(nextWeek), date: nextWeek }
  ]
  const choices = options.filter((choice, i) => choice.date !== item.date && options.findIndex((other) => other.date === choice.date) === i)

  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: c.text }]}>Move to…</Text>
      <Text style={[styles.subject, { color: c.text2 }]} numberOfLines={2}>
        {item.text.trim() || 'Empty line'} · now on {friendlyDate(item.date, today).replace(/^(Today|Tomorrow|Yesterday)$/, (m) => m.toLowerCase())}
      </Text>
      <View style={[styles.list, { backgroundColor: c.bgSubtle }]}>
        {choices.map((choice, i) => (
          <Pressable
            key={choice.label}
            onPress={() => move(choice.date)}
            style={({ pressed }) => [styles.choice, i > 0 && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: c.bgHover }]}
            accessibilityRole="button"
          >
            <SymbolView name={choice.icon} size={18} tintColor={c.text2} />
            <Text style={[styles.choiceLabel, { color: c.text }]}>{choice.label}</Text>
            <Text style={[styles.choiceDetail, { color: c.text3 }]}>{choice.detail}</Text>
          </Pressable>
        ))}
      </View>
      <DatePicker selected={item.date} action="Move to" onPick={move} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  sheet: {
    padding: metrics.gutter,
    paddingTop: 22,
    gap: 14
  },
  title: {
    fontSize: 20,
    fontWeight: '700'
  },
  subject: {
    fontSize: 15,
    marginTop: -8
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
    height: 48
  },
  choiceLabel: {
    fontSize: 16,
    flex: 1
  },
  choiceDetail: {
    fontSize: 15
  }
})
