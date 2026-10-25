import { removeShared, sharedInbox } from '../../modules/cue-native'
import { editor } from '../editor/controller'
import { arriving } from '../editor/hooks'
import { itemStore, sync } from './app'
import { ui } from './ui'

/**
 * Links and text shared to Cue from other apps. The share extension can't reach the notes,
 * so it leaves each share in the app group's inbox; here they're added to today when Cue
 * comes to the screen, and taken out of the inbox once they're stored. With sync on, they
 * sync like any other new line.
 */

let receiving = false

export async function receiveShared(): Promise<void> {
  if (receiving) return
  const { today } = ui.get()
  // During the first download onto this phone, today waits for its notes (and so do shares).
  if (arriving(sync.state.get(), today, today)) return
  const entries = sharedInbox()
  if (!entries.length) return
  receiving = true
  try {
    await itemStore.ensureLoaded([today])
    editor.receiveShared(entries.map((entry) => entry.text))
    await itemStore.persistence.settle()
    removeShared(entries.map((entry) => entry.name))
  } catch (error) {
    console.warn('Couldn’t add what was shared', error)
  } finally {
    receiving = false
  }
}
