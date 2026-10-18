import './polyfills'
import { Appearance } from 'react-native'
import Constants from 'expo-constants'
import { ItemStore, type StoreBackend } from '@shared/itemStore'
import { Repository } from '@shared/repository'
import type { SyncConfig } from '@shared/sync/supabase'
import type { Settings } from '@shared/types'
import { openDatabase } from './db'
import { MobileSync } from './sync'
import { ui } from './ui'

/**
 * The app's long-lived pieces, created once at launch. On iPhone there's no process
 * boundary: the editor's store writes behind to the repository in the same JavaScript
 * runtime, and sync runs alongside them.
 */

function syncConfig(): SyncConfig | null {
  const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseKey?: string }
  return extra.supabaseUrl && extra.supabaseKey ? { url: extra.supabaseUrl, key: extra.supabaseKey } : null
}

export const repo = new Repository(openDatabase())

const backend: StoreBackend = {
  async loadDates(dates) {
    return repo.loadDates(dates)
  },
  async saveItems(items) {
    const saved = repo.saveItems(items)
    if (saved.length) sync.localChange()
    return saved.map(({ id, version }) => ({ id, version }))
  },
  saveItemsSync(items) {
    if (repo.saveItems(items).length) sync.localChange()
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
