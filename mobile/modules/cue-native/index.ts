import { findNodeHandle } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

interface CueNativeModule {
  focusAt(view: number, x: number, y: number): Promise<number>
  beginBackgroundTask(): Promise<number>
  endBackgroundTask(id: number): Promise<void>
  sharedInbox(): SharedEntry[]
  removeShared(names: string[]): void
}

/** Something shared to Cue from another app, waiting to be added to today. */
export interface SharedEntry {
  /** The inbox file it's in. */
  name: string
  text: string
  /** When it was shared (ms since 1970). */
  at: number
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

/** What's waiting in the share extension's inbox, oldest first. */
export function sharedInbox(): SharedEntry[] {
  return native?.sharedInbox() ?? []
}

/** Take shares out of the inbox once they're in the notes. */
export function removeShared(names: string[]): void {
  if (names.length) native?.removeShared(names)
}
