import './polyfills'
import { Appearance } from 'react-native'
import Constants from 'expo-constants'
import { ItemStore, type StoreBackend } from '@shared/itemStore'
import { isTextOnlyChange, Repository } from '@shared/repository'
import type { SyncConfig } from '@shared/sync/supabase'
import type { Item, Settings } from '@shared/types'
import { openDatabase } from './db'
import { MobileSync } from './sync'
import { ui } from './ui'

/**
 * The app's long-lived pieces, created once at launch. On iPhone there's no process
 * boundary: the editor's store writes behind to the repository in the same JavaScript
 * runtime, and sync runs alongside them.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseKey?: string; appleSignIn?: boolean }

function syncConfig(): SyncConfig | null {
  return extra.supabaseUrl && extra.supabaseKey ? { url: extra.supabaseUrl, key: extra.supabaseKey } : null
}

/** Built with the Sign in with Apple capability (`CUE_APPLE_SIGN_IN`, see app.config.ts). */
export const appleSignIn = extra.appleSignIn !== false

export const repo = new Repository(openDatabase())

/** Store edits. Anything but typing (a new line, a move, a toggle) syncs without the typing pause. */
function save(items: Item[]): Item[] {
  const soon = items.some((item) => {
    const existing = repo.get(item.id)
    return !existing || !isTextOnlyChange(existing, item)
  })
  const saved = repo.saveItems(items)
  if (saved.length) sync.localChange({ soon })
  return saved
}

const backend: StoreBackend = {
  async loadDates(dates) {
    return repo.loadDates(dates)
  },
  async saveItems(items) {
    return save(items).map(({ id, version }) => ({ id, version }))
  },
  saveItemsSync(items) {
    save(items)
  }
}

export const itemStore = new ItemStore(backend)
export const sync = new MobileSync(repo, itemStore, syncConfig())

/** Light, dark, or follow the system; sheets and the keyboard follow too. */
export function applyTheme(theme: Settings['theme']): void {
  Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme)
}

export function updateSettings(patch: Partial<Settings>): void {
  const settings = repo.setSettings(patch)
  ui.set({ settings })
  applyTheme(settings.theme)
}

const settings = repo.getSettings()
ui.set({ settings })
applyTheme(settings.theme)
sync.start()
