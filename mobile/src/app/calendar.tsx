import { ScrollView, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useStore } from '../core/store'
import { ui } from '../core/ui'
import { editor } from '../editor/controller'
import { DatePicker } from '../ui/Calendar'
import { SheetTitle } from '../ui/Sheet'
import { metrics } from '../ui/theme'

/** Go to any day. */
export default function CalendarSheet() {
  const date = useStore(ui, (s) => s.date)
  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <SheetTitle title="Go to a day" />
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
  }
})
