import './guard'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, powerMonitor, safeStorage, screen, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { todayISO } from '@shared/dates'
import { collectLinks, filterLinks, type LinkResults } from '@shared/linkList'
import type { ExportResult, ImportResult, Item, Settings, ThemePreference } from '@shared/types'
import { openDatabase } from './db'
import { LinkPreviews } from './links'
import { buildMenu } from './menu'
import { backupJSON, exportMarkdown, importJSON, readText, runDailyBackup } from './portability'
import { isTextOnlyChange, Repository } from '@shared/repository'
import { SyncService } from './sync/service'
import { UpdateService } from './updates'
import type { SyncConfig } from '@shared/sync/supabase'

// Tests and power users can point Cue at a different data directory. Unpackaged
// development builds use their own directory so they never touch real notes.
if (process.env.CUE_USER_DATA) app.setPath('userData', process.env.CUE_USER_DATA)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Cue Dev'))

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
// Automated tests show the window without stealing focus from the person at the Mac.
const isTest = process.env.CUE_E2E === '1'
// `pnpm bench` (scripts/bench.mjs) reads timings and memory from stdout.
const isBench = process.env.CUE_BENCH === '1'
const LIGHT_BG = '#ffffff'
const DARK_BG = '#18181a'

let db: DatabaseSync
let repo: Repository
let sync: SyncService
let links: LinkPreviews
let updates: UpdateService
let mainWindow: BrowserWindow | null = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start)
}

function start(): void {
  // Unpackaged builds run inside Electron's bundle; show Cue's icon in the Dock anyway.
  // Not while benchmarking: it's on the launch path, and packaged builds never pay for it.
  if (!app.isPackaged && !isBench && process.platform === 'darwin') app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  db = openDatabase(join(dataDir, 'cue.sqlite'))
  repo = new Repository(db)
  applyTheme(repo.getSettings().theme)
  sync = new SyncService(repo, {
    config: syncConfig(),
    // Tests can't answer a Keychain prompt, so they keep the session unencrypted.
    cipher: isTest ? undefined : keychainCipher,
    onState: (state) => broadcast('sync:state', state),
    onRemoteChanges: (items) => broadcast('items:changed', items),
    openBrowser: (url) => shell.openExternal(url)
  })
  links = new LinkPreviews(join(dataDir, 'links.sqlite'), (input, init) => net.fetch(input, init), (url, preview) =>
    broadcast('links:preview', { url, preview })
  )

  updates = new UpdateService({
    // Only `pnpm release` builds update themselves: a Cue built from source stays the one
    // you built, and tests and the bench never reach for the network.
    enabled: __CUE_UPDATES__ && app.isPackaged && !isTest && !isBench,
    load: async () => {
      const { MacUpdater } = await import('electron-updater')
      return new MacUpdater({ provider: 'github', owner: 'zlwaterfield', repo: 'cue' })
    },
    onState: (state) => broadcast('updates:state', state)
  })

  registerIpc()
  Menu.setApplicationMenu(buildMenu({ isDev, syncAvailable: sync.state().available, updatesAvailable: updates.state().available }))
  createWindow()

  // A consistent snapshot per day, kept for two weeks, off the startup path. SQLite copies
  // it on a worker thread, so typing never waits for it.
  const backup = (): void => {
    void runDailyBackup(db, join(dataDir, 'Backups')).catch((error) => console.error('Backup failed', error))
  }
  setTimeout(backup, 10_000).unref?.()
  setInterval(backup, 6 * 60 * 60 * 1000).unref?.()

  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
  // Catch up when the Mac wakes or Cue comes back to the front.
  powerMonitor.on('resume', () => sync.resume())
  app.on('browser-window-focus', () => sync.resume())
}

/**
 * The sync server for this build: baked in at build time (`CUE_SUPABASE_URL` and
 * `CUE_SUPABASE_KEY`, see docs/SYNC.md), or set in the environment for development and
 * tests. Without one, Cue doesn't offer sync at all.
 */
function syncConfig(): SyncConfig | null {
  const url = process.env.CUE_SUPABASE_URL || __CUE_SUPABASE_URL__
  const key = process.env.CUE_SUPABASE_KEY || __CUE_SUPABASE_KEY__
  // Chromium's network stack, so sync follows the Mac's proxy and certificate settings.
  return url && key ? { url, key, fetch: netFetch } : null
}

/**
 * `net.fetch`, except that a request with `redirect: 'manual'` (finding Apple's sign-in
 * page) answers with the redirect itself. `net.fetch` throws on those, so they go through
 * `net.request`, which can stop at a redirect, on the same network stack.
 */
const netFetch: typeof fetch = (input, init) => {
  const url = input instanceof URL ? input.href : input
  if (init?.redirect !== 'manual' || typeof url !== 'string') return net.fetch(url, init)
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: init.method ?? 'GET', redirect: 'manual' })
    new Headers(init.headers).forEach((value, name) => request.setHeader(name, value))
    const signal = init.signal
    signal?.addEventListener('abort', () => {
      request.abort()
      reject(signal.reason)
    })
    request.on('redirect', (status, _method, location) => {
      request.abort()
      resolve(new Response(null, { status, headers: { location } }))
    })
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(response.headers)) headers.set(name, [value].flat().join(', '))
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }))
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end(typeof init.body === 'string' ? init.body : undefined)
  })
}

const keychainCipher = {
  encrypt: (text: string) => safeStorage.encryptString(text).toString('base64'),
  decrypt: (data: string) => safeStorage.decryptString(Buffer.from(data, 'base64'))
}

function applyTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG)
}

function savedBounds(): Electron.Rectangle | null {
  try {
    const raw = repo.getMeta('window_bounds')
    if (!raw) return null
    const bounds = JSON.parse(raw) as Electron.Rectangle
    // Only restore if the window would still be visible on a connected display.
    const visible = screen.getAllDisplays().some(({ workArea: a }) => {
      return bounds.x < a.x + a.width - 80 && bounds.x + bounds.width > a.x + 80 && bounds.y >= a.y - 20 && bounds.y < a.y + a.height - 80
    })
    return visible ? bounds : null
  } catch {
    return null
  }
}

function createWindow(): void {
  const bounds = savedBounds()
  const win = new BrowserWindow({
    width: bounds?.width ?? 860,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: 'Cue',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: !isTest,
      backgroundThrottling: !isTest
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    if (isTest) {
      win.showInactive()
      return
    }
    win.show()
    win.focus()
  })

  let boundsTimer: NodeJS.Timeout | undefined
  const rememberBounds = (): void => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFullScreen() && !win.isMinimized()) {
        repo.setMeta('window_bounds', JSON.stringify(win.getNormalBounds()))
      }
    }, 400)
  }
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Links open in the browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isDev || !url.startsWith(process.env.ELECTRON_RENDERER_URL!)) event.preventDefault()
  })
  win.webContents.on('context-menu', (_event, params) => showContextMenu(win, params))
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer gone', details.reason)
    if (!quitting && details.reason !== 'clean-exit') win.reload()
  })

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showContextMenu(win: BrowserWindow, params: Electron.ContextMenuParams): void {
  const template: Electron.MenuItemConstructorOptions[] = []
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
    }
    if (!params.dictionarySuggestions.length) template.push({ label: 'No Guesses Found', enabled: false })
    template.push({
      label: 'Learn Spelling',
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
    })
    template.push({ type: 'separator' })
  }
  if (params.isEditable || params.selectionText) {
    template.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll' }
    )
  }
  if (params.linkURL && /^https?:/i.test(params.linkURL)) {
    if (template.length) template.push({ type: 'separator' })
    template.push(
      { label: 'Open Link', click: () => void shell.openExternal(params.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) }
    )
  }
  if (params.selectionText.trim()) {
    template.push({ type: 'separator' }, { label: `Look Up “${params.selectionText.trim().slice(0, 24)}”`, click: () => win.webContents.showDefinitionForSelection() })
  }
  if (template.length) Menu.buildFromTemplate(template).popup({ window: win })
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

/**
 * Store edits from the editor. With sync on, anything but typing (a new line, a move, a
 * toggle, a delete) goes to the server right away rather than after the typing pause.
 */
function saveItems(items: Item[]): Item[] {
  const soon =
    sync.isOn() &&
    items.some((item) => {
      const existing = typeof item?.id === 'string' ? repo.get(item.id) : null
      return !existing || !isTextOnlyChange(existing, item)
    })
  const saved = repo.saveItems(items)
  if (saved.length) sync.localChange({ soon })
  return saved
}

function registerIpc(): void {
  ipcMain.handle('items:load', (_e, dates: string[]) => repo.loadDates(dates))
  ipcMain.handle('items:save', (_e, items: Item[]) => saveItems(items).map(({ id, version }) => ({ id, version })))
  ipcMain.on('items:saveSync', (event, items: Item[]) => {
    try {
      saveItems(items)
      event.returnValue = true
    } catch (error) {
      console.error('Synchronous save failed', error)
      event.returnValue = false
    }
  })
  ipcMain.handle('items:search', (_e, query: string, limit?: number) => repo.search(query, limit))
  ipcMain.handle('items:dates', (_e, from: string, to: string) => repo.datesWithItems(from, to))
  ipcMain.handle('items:openTodoDates', (_e, from: string, to: string) => repo.datesWithOpenTodos(from, to))

  ipcMain.handle('settings:get', () => repo.getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = repo.setSettings(patch)
    applyTheme(next.theme)
    return next
  })

  ipcMain.handle('export:markdown', async (): Promise<ExportResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = await dialog.showOpenDialog(win!, {
      title: 'Export as Markdown',
      buttonLabel: 'Export',
      message: 'Choose a folder. Cue will create a dated export folder inside it.',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false }
    try {
      const dir = join(result.filePaths[0], `Cue Export ${todayISO()}`)
      mkdirSync(dir, { recursive: true })
      const count = exportMarkdown(repo, dir)
      shell.showItemInFolder(dir)
      return { ok: true, path: dir, count }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('export:json', async (): Promise<ExportResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export JSON Backup',
      defaultPath: join(app.getPath('documents'), `Cue Backup ${todayISO()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    try {
      writeFileSync(result.filePath, backupJSON(repo), 'utf8')
      return { ok: true, path: result.filePath }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('import:json', async (): Promise<ImportResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import JSON Backup',
      buttonLabel: 'Import',
      filters: [{ name: 'Cue Backup', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false }
    try {
      const { applied, skipped } = importJSON(repo, readText(result.filePaths[0]))
      if (applied.length) {
        broadcast('items:changed', applied)
        sync.localChange()
      }
      return { ok: true, applied: applied.length, skipped }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('sync:state', () => sync.state())
  ipcMain.handle('sync:sendCode', (_e, email: string) => sync.sendCode(String(email)))
  ipcMain.handle('sync:verifyCode', (_e, email: string, code: string) => sync.verifyCode(String(email), String(code)))
  ipcMain.handle('sync:signInWithApple', async () => {
    const result = await sync.signInWithApple()
    // Back from the browser: bring Cue forward, signed in or saying why not.
    if (result.ok || result.error) {
      mainWindow?.show()
      app.focus({ steal: true })
    }
    return result
  })
  ipcMain.handle('sync:cancelSignIn', () => sync.cancelSignIn())
  ipcMain.handle('sync:now', () => sync.syncNow())
  ipcMain.handle('sync:signOut', () => sync.signOut())
  ipcMain.handle('sync:deleteAccount', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const { response } = await dialog.showMessageBox(win!, {
      type: 'warning',
      message: 'Delete your sync account?',
      detail: 'Your notes are removed from the sync server and your other devices stop syncing. Notes on this Mac stay here.',
      buttons: ['Delete Account', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    return response === 0 ? sync.deleteAccount() : null
  })

  ipcMain.handle('updates:state', () => updates.state())
  ipcMain.handle('updates:check', () => updates.check())
  ipcMain.handle('updates:install', () => updates.install())

  ipcMain.handle('app:revealData', () => {
    shell.showItemInFolder(join(app.getPath('userData'), 'cue.sqlite'))
  })
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('links:preview', (_e, url: string) => links.get(String(url)))
  ipcMain.handle('links:list', (_e, query: string, limit?: number) => listLinks(String(query ?? ''), limit))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url)
  })
  ipcMain.on('app:interactive', () => {
    // Sync and update checks start once the first screen is up, so they never compete
    // with launch.
    void sync.start()
    updates.start()
    // Links written on other devices, or before the Links list, are read for it a while
    // after launch, so searching them works before the list is ever opened.
    if (!isTest && !isBench) setTimeout(() => links.fill(collectLinks(repo.linkLines()).map((l) => l.url)), 30_000).unref?.()
    // `pnpm bench` measures launch → first editable screen from this signal.
    if (!isBench) return
    process.stdout.write(`CUE_INTERACTIVE ${Date.now()}\n`)
    // Cue's processes a few seconds after launch; the bench reads their settled memory.
    setTimeout(() => process.stdout.write(`CUE_PIDS ${app.getAppMetrics().map((m) => m.pid).join(',')}\n`), 3000)
  })
}

/**
 * The Links list: the first `limit` links written, matching `query`, and how many match.
 * Opening the list (an empty query) also reads the pages it can't find links by yet, in
 * the background.
 */
function listLinks(query: string, limit = 200): LinkResults {
  const all = collectLinks(repo.linkLines())
  if (!query.trim()) links.fill(all.map((l) => l.url))
  const pages = links.searchText()
  return filterLinks(all, query, (url) => pages.get(url), Math.max(1, Number(limit) || 200))
}

let finalSync = false
app.on('before-quit', (event) => {
  quitting = true
  // Give the last edits a moment to reach the server, so they're on your other devices
  // even if you quit right after typing. Typing has paused by the time you press ⌘Q, so
  // the editor has already saved them.
  if (finalSync || !sync?.hasUnsentChanges()) return
  finalSync = true
  event.preventDefault()
  void sync.flush(2000).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  // Standard macOS behavior: the app stays running until explicitly quit.
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  links?.close()
  try {
    db?.close()
  } catch {
    // already closed
  }
})
