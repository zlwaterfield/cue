import '../core/app'
import { Stack } from 'expo-router'
import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { useColors } from '../ui/theme'

// The splash stays up until the first screen has its content, so launch goes straight
// to a finished page.
void SplashScreen.preventAutoHideAsync()
SplashScreen.setOptions({ fade: true, duration: 150 })

export default function RootLayout() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const sheet = {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: c.bgElevated }
  }
  // iOS shows a modal as a card below the status bar. Android shows it full screen, edge to
  // edge, so the status bar and the gesture bar are kept clear here.
  const modal = (backgroundColor: string) => ({
    presentation: 'modal' as const,
    contentStyle: { backgroundColor, ...(Platform.OS === 'android' ? { paddingTop: insets.top, paddingBottom: insets.bottom } : {}) }
  })
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="search" options={modal(c.bgElevated)} />
          <Stack.Screen name="links" options={modal(c.bgElevated)} />
          <Stack.Screen name="settings" options={{ ...sheet, sheetAllowedDetents: [0.7, 1] }} />
          <Stack.Screen name="move" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
          <Stack.Screen name="calendar" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
          {/* Turning sync on, from Settings. */}
          <Stack.Screen name="sign-in" options={modal(c.bg)} />
        </Stack>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
