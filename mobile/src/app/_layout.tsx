import '../core/app'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { sync } from '../core/app'
import { useStore } from '../core/store'
import { useColors } from '../ui/theme'

// The splash stays up until the first screen has its content, so launch goes straight
// to a finished page.
void SplashScreen.preventAutoHideAsync()
SplashScreen.setOptions({ fade: true, duration: 150 })

export default function RootLayout() {
  const c = useColors()
  const phase = useStore(sync.state, (s) => s.phase)
  if (phase === 'starting') return null
  const signedIn = phase === 'signedIn'
  const sheet = {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: c.bgElevated }
  }
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="index" />
            <Stack.Screen name="search" options={{ presentation: 'modal', contentStyle: { backgroundColor: c.bgElevated } }} />
            <Stack.Screen name="settings" options={{ ...sheet, sheetAllowedDetents: [0.7, 1] }} />
            <Stack.Screen name="move" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
            <Stack.Screen name="calendar" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
