import { ScrollView, StyleSheet, Text } from 'react-native'
import { router } from 'expo-router'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { DatePicker } from '../ui/Calendar'
import { metrics, useColors } from '../ui/theme'

/** Go to any day. */
export default function CalendarSheet() {
  const c = useColors()
  const date = useStore(ui, (s) => s.date)
  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: c.text }]}>Go to a day</Text>
      <DatePicker
        selected={date}
        action="Open"
        onPick={(day) => {
          router.back()
          void editor.goTo(day)
        }}
      />
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
  }
})
