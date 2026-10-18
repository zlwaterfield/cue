import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { addDays, friendlyDate, nextWeekday, shortDate, startOfWeek } from '@shared/dates'
import type { ISODate } from '@shared/types'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { useItem } from '../editor/hooks'
import { DatePicker } from '../ui/Calendar'
import { SheetTitle } from '../ui/Sheet'
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
  const options: Array<{ icon: SFSymbol; label: string; date: ISODate }> = [
    { icon: 'sun.max', label: 'Today', date: today },
    { icon: 'sunrise', label: 'Tomorrow', date: addDays(today, 1) },
    { icon: 'briefcase', label: 'Next weekday', date: nextWeekday(today) },
    { icon: 'calendar.badge.plus', label: 'Next week', date: addDays(startOfWeek(today, weekStartsOn), 7) }
  ]
  // Each date once ("Next weekday" is often "Tomorrow"), and never the day the line is on.
  const choices = options
    .filter((choice, i) => choice.date !== item.date && options.findIndex((other) => other.date === choice.date) === i)
    .map((choice) => ({ ...choice, detail: shortDate(choice.date, today) }))

  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <SheetTitle title="Move to…" />
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
            accessibilityLabel={`${choice.label}, ${choice.detail}`}
          >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <SymbolView name={choice.icon} size={18} tintColor={c.text2} />
            </View>
            <Text style={[styles.choiceLabel, { color: c.text }]}>{choice.label}</Text>
            <Text style={[styles.choiceDetail, { color: c.text2 }]}>{choice.detail}</Text>
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
