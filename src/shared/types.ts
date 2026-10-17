/**
 * Core domain types shared by the main process (storage) and the renderer (editor).
 *
 * The model is deliberately flat: every line on a daily page is an Item. Pages are
 * identified by their ISO calendar date ("2026-10-17"), which doubles as a stable,
 * conflict-free page identity across devices — two devices "creating" the same day
 * can never produce duplicate pages.
 */

export type ItemType = 'text' | 'bullet' | 'todo'

export const ITEM_TYPES: readonly ItemType[] = ['text', 'bullet', 'todo']

/** ISO calendar date, `YYYY-MM-DD`, always interpreted in the user's local calendar. */
export type ISODate = string

export interface Item {
  /** Globally unique, stable identifier (UUIDv7). Never reused. */
  id: string
  /** The daily page this item belongs to. */
  date: ISODate
  /** Parent item when nested; null for top-level items. */
  parentId: string | null
  /** Fractional index key; orders siblings (ties broken by id). */
  position: string
  type: ItemType
  text: string
  /** Completion state (meaningful for to-dos, preserved across conversions). */
  done: boolean
  /** Unix epoch milliseconds. */
  createdAt: number
  /** Unix epoch milliseconds, stamped by the repository on every write. */
  updatedAt: number
  /** Tombstone flag. Deleted items are kept so deletions can synchronize. */
  deleted: boolean
  /**
   * Hybrid logical clock timestamp of the last write, stamped by the repository.
   * Lexicographically comparable; used for last-write-wins conflict resolution.
   */
  version: string
}

export interface SearchResult {
  id: string
  date: ISODate
  type: ItemType
  done: boolean
  text: string
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemePreference
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  weekStartsOn: 1
}

export interface ExportResult {
  ok: boolean
  path?: string
  count?: number
  error?: string
}

export interface ImportResult {
  ok: boolean
  applied?: number
  skipped?: number
  error?: string
}

/** The API the preload script exposes to the renderer as `window.cue`. */
export interface CueBridge {
  platform: string
  loadDates(dates: ISODate[]): Promise<Item[]>
  saveItems(items: Item[]): Promise<void>
  /** Synchronous save used while the window is closing so nothing is lost. */
  saveItemsSync(items: Item[]): void
  search(query: string, limit?: number): Promise<SearchResult[]>
  datesWithItems(from: ISODate, to: ISODate): Promise<ISODate[]>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  exportMarkdown(): Promise<ExportResult>
  exportJSON(): Promise<ExportResult>
  importJSON(): Promise<ImportResult>
  revealDataFolder(): Promise<void>
  clipboardWrite(text: string): Promise<void>
  clipboardRead(): Promise<string>
  openExternal(url: string): Promise<void>
  /** Signals that the first screen is ready for typing (used for startup timing). */
  markInteractive(): void
  /** Commands invoked from the native menu. Returns an unsubscribe function. */
  onCommand(callback: (commandId: string) => void): () => void
  /** Items changed outside the renderer (import, future sync). */
  onItemsChanged(callback: (items: Item[]) => void): () => void
}
