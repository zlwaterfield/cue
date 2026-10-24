import { fold, searchTerms } from '@shared/text'
import { DEFAULT_SETTINGS, SYNC_OFF, type CueBridge, type Item, type SearchResult, type Settings, type SyncBridge } from '@shared/types'

/**
 * The renderer's view of storage. In the desktop app this is the preload bridge to
 * the SQLite repository in the main process. When the renderer runs in a plain
 * browser (UI development, tests) an in-memory stand-in is used instead; it is never
 * used by the packaged app.
 */
export type Backend = CueBridge

declare global {
  interface Window {
    cue?: CueBridge
  }
}

class MemoryBackend implements Backend {
  platform = 'web'
  private items = new Map<string, Item>()
  private settings: Settings = { ...DEFAULT_SETTINGS }
  private commandListeners = new Set<(id: string) => void>()
  private version = 0

  constructor() {
    try {
      const raw = globalThis.sessionStorage?.getItem('cue-dev-items')
      if (raw) for (const item of JSON.parse(raw) as Item[]) this.items.set(item.id, item)
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      globalThis.sessionStorage?.setItem('cue-dev-items', JSON.stringify([...this.items.values()]))
    } catch {
      // ignore
    }
  }

  async loadDates(dates: string[]): Promise<Item[]> {
    const set = new Set(dates)
    return [...this.items.values()].filter((i) => set.has(i.date) && !i.deleted).map((i) => ({ ...i }))
  }

  async saveItems(items: Item[]): Promise<Array<Pick<Item, 'id' | 'version'>>> {
    this.saveItemsSync(items)
    return items.map(({ id }) => ({ id, version: this.items.get(id)!.version }))
  }

  saveItemsSync(items: Item[]): void {
    for (const item of items) {
      this.version += 1
      this.items.set(item.id, { ...item, updatedAt: Date.now(), version: String(this.version).padStart(12, '0') })
    }
    this.persist()
  }

  async search(query: string, limit = 50): Promise<SearchResult[]> {
    const terms = searchTerms(query)
    if (!terms.length) return []
    return [...this.items.values()]
      .filter((i) => !i.deleted && terms.every((t) => fold(i.text).includes(t)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.position < b.position ? -1 : 1))
      .slice(0, limit)
      .map(({ id, date, type, done, text }) => ({ id, date, type, done, text }))
  }

  async datesWithItems(from: string, to: string): Promise<string[]> {
    return [...new Set([...this.items.values()].filter((i) => !i.deleted && i.date >= from && i.date <= to).map((i) => i.date))].sort()
  }

  async datesWithOpenTodos(from: string, to: string): Promise<string[]> {
    const open = [...this.items.values()].filter((i) => !i.deleted && i.type === 'todo' && !i.done && i.date >= from && i.date <= to)
    return [...new Set(open.map((i) => i.date))].sort()
  }

  async getSettings(): Promise<Settings> {
    return { ...this.settings }
  }

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...patch }
    document.documentElement.dataset.theme = this.settings.theme
    return { ...this.settings }
  }

  async exportMarkdown() {
    return { ok: false, error: 'Export is available in the desktop app.' }
  }

  async exportJSON() {
    return { ok: false, error: 'Export is available in the desktop app.' }
  }

  async importJSON() {
    return { ok: false, error: 'Import is available in the desktop app.' }
  }

  async revealDataFolder(): Promise<void> {}

  async clipboardWrite(text: string): Promise<void> {
    await navigator.clipboard?.writeText(text)
  }

  async clipboardRead(): Promise<string> {
    return (await navigator.clipboard?.readText()) ?? ''
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener')
  }

  async linkPreview(): Promise<null> {
    return null
  }

  onLinkPreview(): () => void {
    return () => {}
  }

  markInteractive(): void {}

  onCommand(callback: (id: string) => void): () => void {
    this.commandListeners.add(callback)
    return () => this.commandListeners.delete(callback)
  }

  onItemsChanged(): () => void {
    return () => {}
  }

  sync: SyncBridge = {
    getState: async () => SYNC_OFF,
    onState: () => () => {},
    sendCode: async () => ({ ok: false, error: 'Sync is available in the desktop app.' }),
    verifyCode: async () => ({ ok: false, error: 'Sync is available in the desktop app.' }),
    signInWithApple: async () => ({ ok: false, error: 'Sync is available in the desktop app.' }),
    cancelSignIn: () => {},
    syncNow: async () => ({ ok: false, error: 'Sync is available in the desktop app.' }),
    signOut: async () => {},
    deleteAccount: async () => null,
    subscribe: async () => ({ ok: false, error: 'Sync is available in the desktop app.' }),
    manageSubscription: async () => ({ ok: false, error: 'Sync is available in the desktop app.' })
  }
}

const bridge = typeof window !== 'undefined' ? window.cue : undefined

export const backend: Backend = bridge ?? new MemoryBackend()
export const isDesktop = !!bridge
