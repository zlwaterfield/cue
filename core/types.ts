/**
 * Core domain types shared by the main process (storage) and the renderer (editor).
 *
 * The model is deliberately flat: every line on a daily page is an Item. Pages are
 * identified by their ISO calendar date ("2026-10-17"), which doubles as a stable,
 * conflict-free page identity across devices — two devices "creating" the same day
 * can never produce duplicate pages.
 */

import type { LinkPreview } from './links'

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
  /** Today opens with the unfinished to-dos left on earlier days ("loose ends"). */
  looseEnds: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  weekStartsOn: 1,
  looseEnds: true
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

/**
 * Sync as the UI sees it. Sync is off until someone signs in, and Cue works the same
 * either way; the only difference is whether changes also go to the server.
 */
export interface SyncState {
  /** False when this build has no sync server configured. Sync isn't offered at all. */
  available: boolean
  /** That server's URL, which says where an assistant connects (`assistantUrls`). */
  server: string | null
  /** The signed-in account. Null means sync is off. */
  email: string | null
  status: 'off' | 'idle' | 'syncing' | 'offline' | 'error'
  /** Last time a sync finished, this session. */
  lastSyncedAt: number | null
  /** Local changes not yet uploaded. */
  pending: number
  /** Why sync stopped or failed, in words a person can act on. Never raw server text. */
  message: string | null
  /**
   * The server ended the session (it expired, or the account was deleted elsewhere), so
   * sync is off until someone signs in again. Notes stay on this Mac. Cleared by signing
   * in, or by `signOut`.
   */
  needsSignIn: boolean
  /** With `needsSignIn`, the account to offer signing in again to. Null if it was deleted. */
  previousEmail: string | null
  /** How that account signed in, so signing in again goes the same way. */
  previousMethod: SignInMethod | null
}

/** An emailed six-digit code, or Sign in with Apple. */
export type SignInMethod = 'email' | 'apple'

export const SYNC_OFF: SyncState = {
  available: false,
  server: null,
  email: null,
  status: 'off',
  lastSyncedAt: null,
  pending: 0,
  message: null,
  needsSignIn: false,
  previousEmail: null,
  previousMethod: null
}

/** The outcome of an account action. `error` is always written for people. */
export type SyncResult = { ok: true } | { ok: false; error: string }

export interface SyncBridge {
  getState(): Promise<SyncState>
  onState(callback: (state: SyncState) => void): () => void
  /** Email a sign-in code. */
  sendCode(email: string): Promise<SyncResult>
  /** Finish signing in; sync starts right away. */
  verifyCode(email: string, code: string): Promise<SyncResult>
  /**
   * Sign in with Apple in the browser; sync starts once it comes back. Resolves with an
   * empty error if cancelled (`cancelSignIn`).
   */
  signInWithApple(): Promise<SyncResult>
  /** Stop waiting for the browser. */
  cancelSignIn(): void
  /** Offline, this fails with "Offline. Changes will sync when you’re back online." */
  syncNow(): Promise<SyncResult>
  /** Stop syncing on this Mac (or dismiss `needsSignIn`). Notes stay here. */
  signOut(): Promise<void>
  /** Asks for confirmation, then deletes the account and its server copy. Notes stay here. */
  deleteAccount(): Promise<SyncResult | null>
}

/**
 * The Mac app updating itself (`apps/desktop/src/main/updates.ts`). Only builds from
 * `pnpm release` do; everything else reports `available: false` and never checks.
 */
export interface UpdateState {
  /** False when this build doesn't update itself (development, tests, built from source). */
  available: boolean
  /** `downloading` and `ready` are about `version`, a newer Cue than this one. */
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  version: string | null
  /** Why the last check you asked for failed, in words a person can act on. */
  message: string | null
}

export const UPDATES_OFF: UpdateState = { available: false, status: 'idle', version: null, message: null }

export interface UpdateBridge {
  getState(): Promise<UpdateState>
  onState(callback: (state: UpdateState) => void): () => void
  /** Checks now, resolving once the check is done (a download carries on afterwards). */
  check(): Promise<UpdateState>
  /** Quits, installs the update that's ready, and opens Cue again. */
  install(): void
}

/** The API the preload script exposes to the renderer as `window.cue`. */
export interface CueBridge {
  platform: string
  loadDates(dates: ISODate[]): Promise<Item[]>
  /** Resolves with the version stored for each item that changed. */
  saveItems(items: Item[]): Promise<Array<Pick<Item, 'id' | 'version'>>>
  /** Synchronous save used while the window is closing so nothing is lost. */
  saveItemsSync(items: Item[]): void
  search(query: string, limit?: number): Promise<SearchResult[]>
  datesWithItems(from: ISODate, to: ISODate): Promise<ISODate[]>
  /** Days in the range with an unfinished to-do, oldest first. */
  datesWithOpenTodos(from: ISODate, to: ISODate): Promise<ISODate[]>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  exportMarkdown(): Promise<ExportResult>
  exportJSON(): Promise<ExportResult>
  importJSON(): Promise<ImportResult>
  revealDataFolder(): Promise<void>
  clipboardWrite(text: string): Promise<void>
  clipboardRead(): Promise<string>
  openExternal(url: string): Promise<void>
  /** The stored preview of a line that is only a link; fetches it in the background when due. */
  linkPreview(url: string): Promise<LinkPreview | null>
  /** A link's preview arrived or changed. Returns an unsubscribe function. */
  onLinkPreview(callback: (update: { url: string; preview: LinkPreview | null }) => void): () => void
  /** Signals that the first screen is ready for typing (used for startup timing). */
  markInteractive(): void
  /** Commands invoked from the native menu. Returns an unsubscribe function. */
  onCommand(callback: (commandId: string) => void): () => void
  /** Items changed outside the renderer (import, sync). */
  onItemsChanged(callback: (items: Item[]) => void): () => void
  sync: SyncBridge
  updates: UpdateBridge
}
