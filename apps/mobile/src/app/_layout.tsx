import '../core/app'
import { StyleSheet } from 'react-native'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { ClearOfSides } from '../ui/pane'
import { useColors } from '../ui/theme'

// The splash stays up until the first screen has its content, so launch goes straight
// to a finished page.
void SplashScreen.preventAutoHideAsync()
SplashScreen.setOptions({ fade: true, duration: 150 })

export default function RootLayout() {
  const c = useColors()
  const sheet = {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: c.bgElevated }
  }
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}
          // Everything opened over the day keeps clear of what the system holds at each side:
          // on iPhone Duo the status bar and Dynamic Island run down one edge. Each screen
          // gives up only what it's actually under, so a sheet floating in the middle of the
          // open display, touching neither edge, gives up nothing. The day lays itself out
          // (app/index.tsx): its toolbar stays as wide as the keyboard it rides on.
          screenLayout={({ children, route }) =>
            route.name === 'index' ? (
              children
            ) : (
              <ClearOfSides style={FITTED.has(route.name) ? undefined : styles.fill}>{children}</ClearOfSides>
            )
          }
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="search" options={{ presentation: 'modal', contentStyle: { backgroundColor: c.bgElevated } }} />
          <Stack.Screen name="links" options={{ presentation: 'modal', contentStyle: { backgroundColor: c.bgElevated } }} />
          <Stack.Screen name="settings" options={{ ...sheet, sheetAllowedDetents: [0.7, 1] }} />
          <Stack.Screen name="move" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
          <Stack.Screen name="calendar" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
          {/* Turning sync on, from Settings. */}
          <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        </Stack>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}

/** Sheets as tall as what's in them: a wrapper that filled the sheet would stretch them. */
const FITTED = new Set(['move', 'calendar'])

const styles = StyleSheet.create({
  fill: {
    flex: 1
  }
})
