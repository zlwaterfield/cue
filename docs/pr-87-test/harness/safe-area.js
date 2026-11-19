// The real library, with the insets a device would report supplied by the test (window.__insets).
export * from 'react-native-safe-area-context'
const ZERO = { top: 0, bottom: 0, left: 0, right: 0 }
export function useSafeAreaInsets() {
  return globalThis.__insets ?? ZERO
}
