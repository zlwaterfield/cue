import { Stack } from 'expo-router'
import { useColors } from '../../ui/theme'

/**
 * Settings is an index that pushes into one category, the way the Mac's rail switches
 * panes. The whole stack lives inside the sheet (`app/_layout.tsx`), so a push slides
 * within it and the sheet keeps its size. A deep link (the header's sync indicator)
 * still finds the index underneath.
 */
export const unstable_settings = { initialRouteName: 'index' }

export default function SettingsLayout() {
  const c = useColors()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bgElevated } }} />
}
