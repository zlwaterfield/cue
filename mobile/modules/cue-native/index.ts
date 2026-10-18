import { findNodeHandle } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

interface CueNativeModule {
  focusAt(view: number, x: number, y: number): Promise<number>
  beginBackgroundTask(): Promise<number>
  endBackgroundTask(id: number): Promise<void>
}

const native = requireOptionalNativeModule<CueNativeModule>('CueNative')

/**
 * Focus a text input with the caret nearest to a point in window coordinates (a tap).
 * Resolves with the caret offset, or -1 if the native module isn't in this build.
 */
export async function focusAt(input: Parameters<typeof findNodeHandle>[0], x: number, y: number): Promise<number> {
  const tag = findNodeHandle(input)
  if (!native || tag == null) return -1
  return native.focusAt(tag, x, y)
}

/** Ask iOS for time to finish work after the app leaves the screen. Returns a release function. */
export async function backgroundTask(): Promise<() => void> {
  if (!native) return () => {}
  const id = await native.beginBackgroundTask()
  return () => void native.endBackgroundTask(id)
}
