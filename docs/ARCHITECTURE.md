# Architecture

Cue is two apps and a server function around one shared core. This page maps the modules,
follows a request through them, and says where to make common changes. The deeper stories
live elsewhere: [SYNC.md](SYNC.md) for sync, [MCP.md](MCP.md) for the assistant endpoint,
[core/README.md](../core/README.md) for the rules of the shared core, and
[apps/mobile/README.md](../apps/mobile/README.md) for the iPhone app.

## Main modules

### The repository

| Folder | What it is |
| --- | --- |
| `core/` | The shared core: data model, SQLite schema, repository, clock, sync, MCP server, every editing operation. Imported as `@shared/*` by both apps and by relative path from the MCP function. |
| `apps/desktop/` | The Mac app: Electron main process, preload bridge, React renderer, and the unit, integration and end-to-end tests for everything, `core/` included. |
| `apps/mobile/` | The iPhone app: Expo / React Native, the same core in one JavaScript runtime. |
| `supabase/` | The sync server: Postgres migrations (`items`, `sync_push`, `sync_pull`, realtime hints, terms), the `mcp` Edge Function, the sign-in email template. |
| `site/` | usecue.today: static HTML, the OAuth consent page, and the `/mcp` proxy (`site/vercel.json`). |
| `brand/` | Brand kit: tokens (`brand/tokens/tokens.json`, `tokens.css`, `contrast.md`), icon, store art, video. |
| `docs/` | This page, [SYNC.md](SYNC.md), [MCP.md](MCP.md), [ACCEPTANCE.md](ACCEPTANCE.md). |
| `.github/workflows/ci.yml` | CI: both apps' typecheck and the Mac app's unit tests. |

The root `package.json` has no dependencies. Its scripts forward to `apps/desktop`
(`pnpm test` is `pnpm -C apps/desktop test`). Each app installs on its own.

### The Mac app

```
┌──────────────────────── Electron main process (src/main) ─────────────┐
│  index.ts       window, lifecycle, every IPC handler, dialogs,        │
│                 context menu, saveItems (save + sync trigger)         │
│  guard.ts       first import: network errors never freeze the app     │
│  db.ts          openDatabase: node:sqlite + PRAGMAS + migrate          │
│  menu.ts        native menu generated from core/commands.ts           │
│  sync/service.ts      SyncService: account, lifecycle, Keychain        │
│  sync/browserReturn.ts loopback server for Sign in with Apple (PKCE)  │
│  links.ts       LinkPreviews: link previews, cached in links.sqlite   │
│  updates.ts     UpdateService: self-update from GitHub releases       │
│  portability.ts export, import and the daily backup, on disk          │
└──────────────▲─────────────────────────────────────────────────────────┘
               │ narrow, typed IPC (src/preload/index.ts → window.cue,
               │ the CueBridge in core/types.ts)
┌──────────────┴──────────── Renderer, React (src/renderer/src) ─────────┐
│  main.tsx            boot: controller.init, render, focus, ready       │
│  App.tsx             the week or day column and the overlays           │
│  data/backend.ts     window.cue, or an in-memory stand-in in a browser │
│  store/items.ts      the ItemStore instance (core/itemStore.ts)        │
│  store/ui.ts         Store<T>, view, selection, overlay, toast         │
│  store/sync.ts, store/updates.ts   state pushed from main              │
│  store/links.ts      link previews for lines that are only a link      │
│  editor/controller.ts  focus, keys, selection, undo, every command     │
│  editor/ItemRow, DaySection, LinkLine, LooseEnds   rendering           │
│  editor/dom, caret, keys, pointer, highlights, hooks   DOM helpers     │
│  ui/       Palette, Sheets (settings, shortcuts, about), Chrome        │
│            (header, toast, save status), Calendar, Links,              │
│            SyncSettings, AssistantsSettings, icons                     │
│  styles/app.css      every style, brand tokens as CSS variables        │
└────────────────────────────────────────────────────────────────────────┘
```

Scripts in `apps/desktop/scripts/`: `dev.mjs`, `release.mjs` (sign, notarize, staple),
`upload-release.mjs`, `bench.mjs`, `seed.ts`, `screenshots.mjs`, the videos, and
`bins.mjs` (postinstall).

### The shared core

```
 core/   (no DOM, no React Native, no Node built-ins; see core/README.md)
   types.ts        Item, Settings, SyncState, UpdateState, CueBridge
   ids.ts, dates.ts, dateParse.ts, text.ts (fold, search terms), outline.ts
   markdown.ts     lines ⇄ Markdown, for copy, paste, export and MCP
   commands.ts     every command: id, title, group, shortcut
   sqlite.ts       SqlDatabase, MIGRATIONS, PRAGMAS, migrate, transaction
   repository.ts   the storage boundary (validation, versions, outbox, merge)
   hlc.ts          hybrid logical clock
   itemStore.ts    ItemStore (loaded days in memory) + PersistenceQueue (write-behind)
   editor/ops.ts   structural operations (pure functions over a draft)
   editor/tx.ts    Tx: draft transaction over the store
   editor/undo.ts  UndoManager and revert: application-level undo
   editor/geometry.ts  drop placement for touch drag and drop
   editor/rollover.ts  midnight while the iPhone app stays open
   looseEnds.ts    unfinished to-dos from the last 30 days, shown on Today
   links.ts        finding links, parsing page previews, fetchPage
   linkList.ts     the Links list: collectLinks, filterLinks, grouping
   sync/engine.ts  SyncEngine: push the outbox, pull the feed, retry
   sync/supabase.ts  SupabaseSync: auth, sync_push/sync_pull, realtime hints
   sync/memoryServer.ts  in-memory reference server for tests
   sync/status.ts  sync status in words
   mcp/server.ts   MCP JSON-RPC: handleMessage and the five tools
   mcp/notes.ts    Notes / SupabaseNotes: the tools' reads and writes
   portability.ts  what export is: the Markdown tree, and the backup's JSON
   zip.ts          the Markdown tree as one file, for a phone with no folders
   assistants.ts   assistantUrls: where an assistant connects
   terms.ts, feedback.ts   terms version and links, the report-an-issue URL
```

### The iPhone app and the server

`apps/mobile/src/core/app.ts` builds the same `Repository` and `ItemStore` over expo-sqlite
(`src/core/db.ts`), with sync in `src/core/sync.ts` (`MobileSync`). The editor is
`src/editor/controller.ts` (`Editor`), and the screens are in `src/app/`. The folder layout
is in [apps/mobile/README.md](../apps/mobile/README.md#layout).

`supabase/functions/mcp/index.ts` is a Deno Edge Function that hands each JSON-RPC message
to `core/mcp/server.ts`. `supabase/functions/mcp/deno.json` maps the core's
extensionless imports.

The Mac app and the iPhone app share everything about the data and how it changes: the
model, storage, merge rules, sync, and every editing operation. Each app adds only its
platform: Electron, IPC and contenteditable on the Mac; touch, the keyboard and the iOS
lifecycle on the phone ([apps/mobile/README.md](../apps/mobile/README.md)).

## How a request moves through them

### Typing a character on the Mac

1. **DOM.** Each line is a `contenteditable="plaintext-only"` div in
   `editor/ItemRow.tsx`. Its `onInput` calls `controller.onItemInput(id, el)`. Keys go to
   `onItemKeyDown` (Return calls `ops.splitAt` or `ops.enterOnEmpty`; Tab, Backspace and the
   rest work the same way). The trailing blank line (`GhostRow` in `DaySection.tsx`) calls
   `onGhostInput`, which creates the item.
2. **Controller.** `onItemInput` calls `controller.commit('Typing', tx => tx.update(id, { text }), { coalesce: 'text:<id>' })`.
   `commit` opens a `Tx` over `itemStore` (`core/editor/tx.ts`) and runs the edit, which is
   either a `tx` call or an operation from `core/editor/ops.ts`. It takes `tx.netChanges()`,
   applies them with `itemStore.commit(...)` inside `flushSync`, places the caret, and
   records an `UndoEntry` in `UndoManager` (`core/editor/undo.ts`). Typing runs coalesce by
   their key.
3. **Item store.** `ItemStore.commit` updates the in-memory maps and tells the subscribers
   of only that item and day (`useItem` / `useOutline` in `editor/hooks.ts`), so one row
   re-renders. Then it calls `PersistenceQueue.enqueue`.
4. **Write-behind.** `PersistenceQueue` (`core/itemStore.ts`) coalesces per item and
   flushes after 40 ms. It calls `backend.saveItems(batch)`. In the app that's
   `window.cue.saveItems`, from `src/preload/index.ts`, which is
   `ipcRenderer.invoke('items:save', items)`. On unload, `flushSync` sends
   `items:saveSync` with `ipcRenderer.sendSync`.
5. **Main process.** `ipcMain.handle('items:save')` in `src/main/index.ts` calls the local
   `saveItems`. That works out whether the change is only typing (`isTextOnlyChange`), calls
   `repo.saveItems(items)`, and then calls `sync.localChange({ soon })`.
6. **Repository → SQLite.** `Repository.saveItems` (`core/repository.ts`) runs
   `validateItem` on each record and skips records that didn't change (`sameContent`). Each
   changed record gets a version from `hlc.now()`. Inside one `transaction` it writes the
   `items` row (with folded `search_text`) and upserts `outbox(item_id, version)`. It
   returns the stored versions to the renderer, where `ItemStore` uses them to settle
   races with remote records.

### Launch and loading a day

1. `src/main/index.ts` `start()`: `openDatabase` (`db.ts`: `PRAGMAS`, `migrate`), then
   `new Repository(db)`. It builds `SyncService`, `LinkPreviews` and `UpdateService`,
   none of which touch the network yet. Then `registerIpc()`, `buildMenu(...)` and
   `createWindow()`.
2. `src/renderer/src/main.tsx` `boot()`: `controller.init()` reads settings
   (`settings:get`) and runs `itemStore.ensureLoaded` for the visible days and yesterday.
   `ensureLoaded` calls `backend.loadDates`, which goes `items:load` → `repo.loadDates`.
   `init` also wires the window listeners, `backend.onCommand` and
   `backend.onItemsChanged`. Then `boot` calls `initSync()` and `initUpdates()`, renders
   `<App />`, and calls `controller.focusDefault()` and `backend.markInteractive()`.
3. `app:interactive` in main starts `sync.start()`, `updates.start()` and, later, the
   Links list's background fill, so none of them compete with launch.
4. Moving to another day goes through `controller.navigate(view)`: `itemStore.ensureLoaded`
   for the new dates, `ui.set({ view })`, focus, then `prefetch` for the neighbouring
   days. `DaySection` renders the rows from `useOutline(date)` (`buildOutline` in
   `core/outline.ts`), with `LooseEnds` at the top of today.

### Sync, both ways

Off until someone signs in. The full protocol is in [SYNC.md](SYNC.md).

1. **Out.** `sync.localChange({ soon })` (`main/sync/service.ts`) forwards to
   `SyncEngine.localChange` (`core/sync/engine.ts`). That pushes at once for structural
   edits, or after the typing pause. `run()` → `pushAll()` reads
   `repo.pendingChanges(500)`, calls `transport.push` (`SupabaseSync.push` → the
   `sync_push` RPC in `supabase/migrations/`), then `repo.acknowledge(batch)` and moves the
   `sync_cursor` meta.
2. **Hint.** `sync_push` sends a `changed` broadcast with the new `seq` on the account's
   private channel `sync:<user id>`. Every other device hears it through
   `SupabaseSync.listen`, which `SyncService.begin` wired to `engine.remoteChange(seq)`.
3. **In.** `pullAll()` calls `transport.pull(cursor)` (the `sync_pull` RPC), then
   `repo.applyRemote(records)`, which keeps a record only if its version is newer.
   Applied records leave the outbox. The engine's `onRemoteChanges` hook reaches main's
   `broadcast('items:changed', items)`.
4. **Into the editor.** The preload's `onItemsChanged` calls
   `controller.applyExternal(items)` → `itemStore.applyExternal`. Items with an unsent
   local edit keep it, and the rows re-render. If the line under the caret was deleted
   or moved elsewhere, `focusLost` moves the caret and shows a toast.

`SyncService` loads `@shared/sync/supabase` on first use (`connect`), so a Mac without an
account never loads the client. Account changes reach the renderer as `sync:state`
(`store/sync.ts`).

### The iPhone app and the MCP endpoint

- **iPhone.** There's no IPC. `apps/mobile/src/core/app.ts` gives `ItemStore` a
  `StoreBackend` that calls `repo.saveItems` in process, then `sync.localChange({ soon })`.
  The editor (`src/editor/controller.ts`) uses the same `Tx`, `ops`, `revert` and
  `rollover`. `MobileSync` runs the same `SyncEngine` with its own timings. Its
  `onRemoteChanges` goes straight to `itemStore.applyExternal`.
- **MCP.** An assistant POSTs JSON-RPC to `/mcp`. The site proxies it to
  `supabase/functions/mcp/index.ts`, which checks the bearer token, builds
  `SupabaseNotes(API, KEY, token)` and calls `handleMessage` (`core/mcp/server.ts`). Reads
  go through PostgREST as the user, so row-level security applies. A write builds a `Tx`
  over the day's items and runs `insertLinesAfter` or `moveToDate`. The local `commit`
  stamps the changes with the function's own `HybridLogicalClock`, and
  `SupabaseNotes.push` sends them to `sync_push`. The realtime hint from step 2 above then
  brings them to every device. See [MCP.md](MCP.md).

## Where to make common changes

Changes to `core/` must follow [core/README.md](../core/README.md). Nothing in it imports
from either app. Platform differences arrive as arguments or interfaces (`SqlDatabase`,
`StoreBackend`, `SessionStore`). Any third-party import there must work in both apps and on
Deno. Its tests are the Mac's unit tests.

| To… | Change | Notes |
| --- | --- | --- |
| Add a command or shortcut | `core/commands.ts` (`COMMANDS`), then its `case` in `EditorController.execute` (`apps/desktop/src/renderer/src/editor/controller.ts`). Put it in a menu in `apps/desktop/src/main/menu.ts` (`buildMenu`). An icon goes in `ui/icons.tsx`. | The palette (`ui/Palette.tsx`), keymap (`editor/keys.ts`, `commandFor`) and ⌘/ sheet (`ShortcutsSheet` in `ui/Sheets.tsx`) read `COMMANDS` themselves. Only `Mod+` shortcuts become menu accelerators (`toAccelerator`). Check the "Keyboard and menus" rules below. |
| Change an editing operation | `core/editor/ops.ts`, and `core/editor/tx.ts` if a draft needs a new primitive. Wire keys in `onItemKeyDown` / `onBlockKeyDown` (Mac) and `apps/mobile/src/editor/controller.ts` (iPhone). | Both apps and the MCP tools run these. Test in `apps/desktop/tests/unit/ops.test.ts`, with undo in `undo.test.ts`. |
| Change undo | `core/editor/undo.ts` (`UndoManager`, `revert`, `GROUPS`) and `commit` / `replay` in each controller. | |
| Add an item field | `Item` in `core/types.ts`. In `core/repository.ts`: `validateItem`, `COLUMNS`, `ItemRow`, `toItem`, `write`, `sameContent` and `isTextOnlyChange`. Also `Tx.create` / `Tx.netChanges` (`core/editor/tx.ts`) and `GROUPS` in `undo.ts`. | Also needs a SQLite migration (next row) and a server migration. The server side is the `items` table, `sync_push` and `sync_pull` in a new `supabase/migrations/<timestamp>_*.sql`, plus the column lists in `SupabaseSync.pullDates` (`core/sync/supabase.ts`) and `COLUMNS` in `core/mcp/notes.ts`. Then `core/portability.ts` / `core/markdown.ts` if export should carry it. |
| Change the SQLite schema | Append a new entry to `MIGRATIONS` in `core/sqlite.ts`. Never edit an old one. | Both apps run `migrate` at open. A database newer than the app refuses to open. Tests: `repository.test.ts`. |
| Add a bridge (IPC) method | Its type in `CueBridge` (`core/types.ts`), the `ipcRenderer` call in `apps/desktop/src/preload/index.ts`, `ipcMain.handle(...)` in `registerIpc` (`apps/desktop/src/main/index.ts`), and the stand-in in `MemoryBackend` (`renderer/src/data/backend.ts`). | Keep it narrow and typed. Coerce arguments in main (`String(url)`). Main-to-renderer events use `broadcast(channel, …)` and a `subscribe` in the preload. |
| Change sync or merge behaviour | `core/sync/engine.ts` (when and what to push or pull), `core/repository.ts` (`applyRemote`, `pendingChanges`, `acknowledge`), `core/sync/supabase.ts` (transport, auth, realtime), and `supabase/migrations/` (server functions). Account lifecycle is in `apps/desktop/src/main/sync/service.ts` and `apps/mobile/src/core/sync.ts`. | Read [SYNC.md](SYNC.md) first. Tests: `sync.test.ts` (against `MemorySyncServer`), `syncService.test.ts`, `supabaseErrors.test.ts`, `supabaseFetch.test.ts`, and `tests/integration/supabase.test.ts` / `pnpm test:sync` against a local Supabase. |
| Add a setting | `Settings` and `DEFAULT_SETTINGS` in `core/types.ts`, and the per-field check in `Repository.getSettings`. The Mac control is in `SettingsSheet` (`ui/Sheets.tsx`, through `controller.updateSettings`), the iPhone one in `apps/mobile/src/app/settings/` (through `updateSettings` in `src/core/app.ts`). | Settings live in the `meta` table and aren't synced. |
| Change styling or colours | `apps/desktop/src/renderer/src/styles/app.css` (Mac) and `apps/mobile/src/ui/theme.ts` (iPhone). | Colours are copies of `brand/tokens/tokens.json`. Change the tokens first; `tests/unit/tokens.test.ts` fails if the copies drift. Recheck contrast in `brand/tokens/contrast.md`. |
| Change the MCP tools | `TOOLS` and `INSTRUCTIONS` in `core/mcp/server.ts`, and reads in `core/mcp/notes.ts`. If a new core module is imported, map it in `supabase/functions/mcp/deno.json`. | Writes must go through `ops` and `commit` so they land like a typed edit. Tests: `tests/unit/mcp.test.ts`, plus `tests/integration/mcp.test.ts` against a local Supabase. Update the tools table in [MCP.md](MCP.md). |
| Add a unit test | `apps/desktop/tests/unit/<area>.test.ts` (Vitest, plain Node; `helpers.ts` has fixtures). | These cover `core/` for both apps. Run with `pnpm test`. |
| Add an end-to-end test | `apps/desktop/tests/e2e/<area>.spec.ts`, using `launch()` from `tests/e2e/app.ts` (a throwaway data directory per run). iPhone flows go in `apps/mobile/e2e/*.yaml` (Maestro). | Run with `pnpm test:e2e` (builds `--mode test`, then Playwright), and `pnpm test:sync` for the sync spec. |
| Release or packaging | `apps/desktop/electron-builder.yml`, `apps/desktop/scripts/release.mjs` and `upload-release.mjs`, the version in `apps/desktop/package.json`, and `src/main/updates.ts` for self-update. The iPhone side is `apps/mobile/app.config.ts` and `scripts/testflight.mjs`. | Only `pnpm release` builds turn on updates (`CUE_UPDATES`, `__CUE_UPDATES__` in `electron.vite.config.mts`). The sync server is baked in from `.env.production.local`. |
| Change link previews or the Links list | `core/links.ts` (parsing, `fetchPage`), `core/linkList.ts`, `apps/desktop/src/main/links.ts` (cache, `links:preview`, `links:list`), `renderer/src/store/links.ts`, `ui/Links.tsx`, and `apps/mobile/src/core/links.ts`. | Previews are a local cache (`links.sqlite`), never synced. |

## Decisions

**Electron, not Tauri or native.** The editor matters most, and Chromium's
`contenteditable` is the most battle-tested text surface available. Electron also lets
the real app (SQLite, menus, restart) be driven end to end by Playwright, which is how
the acceptance criteria are verified. The costs, bundle size and memory, are
acceptable for a desktop productivity app. Startup is still about 240 ms to an
editable window with five years of data.

**`node:sqlite`, not better-sqlite3.** It's built into Electron 44's Node (SQLite
3.53, FTS5 available), so there are no native modules, no ABI rebuilds, and the same
engine runs in unit tests under plain Node.

**One plain-text editable per item.** Each line is its own
`contenteditable="plaintext-only"` element, and the *item store* is the source of
truth. This is how Notion, Workflowy and Logseq work, and it maps one-to-one onto the
sync-ready data model: there's no document to diff into records, stable ids are free,
and moving an item to another day is a record update. The trade-offs are handled
explicitly:

- Caret movement across lines (↑/↓ with a remembered column, ←/→ at edges) is
  computed geometrically (`editor/dom.ts`).
- Selecting across lines switches to *block selection* (Esc, ⇧↑/⇧↓ at an edge,
  drag across rows, ⌘A twice), which supports copy, cut, paste, delete, move,
  indent and completion as a group.
- Undo is application-level (below), not the browser's.

**Hanging markers.** Bullets and checkboxes sit in the left margin, so text edges
align down the page. Markdown shortcuts (`- `, `[] `, `[x] `) format as you type,
and ⌘Z right after reverts just the formatting.

## Data model

See `core/types.ts`. Items carry `id, date, parentId, position, type, text,
done, createdAt, updatedAt, deleted, version`. Order among siblings is a fractional
index (`position`) with the id as a tiebreaker, so inserting never rewrites
neighbors and concurrent inserts can't collide destructively. Siblings can end up with
the same key (two devices inserting at one spot offline). A new line (Return, paste)
placed among them goes after the tied run, so nothing another device is editing gets
rewritten. Moving a line into the tie (⌥↑, ⌥↓, drag) is an explicit reorder: the twins
after the slot get fresh keys, so the line lands exactly where asked, and the twins
before it keep theirs. Only those rewritten twins could lose an unsynced edit another
device makes to them at the same moment.

The outline for a day is derived, never stored (`core/outline.ts`). Derivation is
total: orphaned items render at the top level and parent cycles are broken.

## The storage boundary

The renderer can only call the methods in `CueBridge` (`core/types.ts`): the item reads and
writes (`loadDates`, `saveItems`, `saveItemsSync`, `search`, `datesWithItems`,
`datesWithOpenTodos`), settings, export and import, the clipboard, link previews and the
Links list, menu commands and outside changes (`onCommand`, `onItemsChanged`), and the
`sync` and `updates` sub-bridges. It never sees SQL, versions, or the outbox. `Repository` validates every record,
stamps versions, writes the outbox in the same transaction, and skips no-op writes.
Sync plugs into the repository (`pendingChanges`, `acknowledge`, `applyRemote`) from the
main process and never touches the editor. It's off by default and loads nothing until you
sign in. See [SYNC.md](SYNC.md).

## Saving and durability

- Edits apply to the in-memory store synchronously, so typing never waits.
- The write-behind queue coalesces per item and flushes within 40 ms
  (`core/itemStore.ts`). Failures retry with backoff and surface a quiet "Couldn't
  save" notice; nothing is dropped.
- When the window unloads (quit, close, reload), a synchronous IPC flushes whatever
  remains.
- SQLite runs in WAL mode with `synchronous=FULL`: committed writes survive app
  crashes and power loss. A test kills the app with SIGKILL mid-session and checks
  that nothing is lost.
- A consistent snapshot is taken once a day into
  `~/Library/Application Support/Cue/Backups`, and the last 14 are kept. SQLite's online
  backup copies the pages on a worker thread, a hundred at a time, so saves never wait
  behind it, and the copy only takes its real name once it's complete.
- If the renderer crashes, the main process reloads it. The database is unaffected.

## Undo

`core/editor/undo.ts`. Every action is one entry of before/after item copies plus the
selection on each side. Typing coalesces into runs (split by pauses, focus changes,
and structural actions). Undo and redo are *new writes* with new versions, which
keeps them correct under sync. Undoing a move to Friday brings the item back and puts
the caret where it was, navigating if needed.

Undo reverses only what the action changed, field group by field group (place, type,
text, completion, deletion), and only where the item still holds what the action left
(`revert`). A newer edit from another device stays, a line deleted elsewhere stays
deleted, and an undo with nothing left to do says "Already changed on another device".

## Keyboard and menus

`core/commands.ts` is the single source for command titles and shortcuts. The
native menu, the palette, the keymap and the ⌘/ reference are all generated from it.
Only ⌘-based shortcuts are registered as menu key equivalents, so Tab, ⌥↑ and
Escape stay with the editor. The page's key handler and a menu accelerator can both
see one press; the controller ignores the echo from the other source.

Shortcut deviations from the brief:

| Brief | Cue | Why |
| --- | --- | --- |
| ⌥↑ / ⌥↓ move item | kept | macOS binds these to "paragraph start/end". In Cue every line is its own paragraph, so ⌘← / ⌘→ already do that and nothing is lost. |
| (none) Go to date | ⌘J | ⌘G is Find Next on macOS. |
| (none) Previous / next day | ⌘[ / ⌘] | The standard back/forward pair. Tab handles indentation, so these are free. |
| (none) Delete item | ⇧⌘⌫ | ⌘⌫ is "delete to line start" in macOS text editing. |
| (none) New item | ⌘N | Standard. |

## Accessibility notes

- Body text, secondary text and the accent meet WCAG AA in both modes (`brand/tokens/contrast.md`).
  Metadata people read (dates, hints, group headers, the sync status) uses `--text-2`.
- Completed to-dos and placeholders use `--text-3` (3.26:1 light, 3.48–3.93:1 dark). That is
  deliberate, since completed items should recede, but it is a known AA exception. The strict
  alternative is to render done items in `--text-2`. Out-of-month calendar days, the year in
  "October 2026" and decorative glyphs use it too.
- Checkbox outlines (`--line-strong`, 24% / 26%) sit below the 3:1 non-text guideline, a
  judgment call for a calm page. A to-do's whole 24 × 30 marker cell is its click target.
- Keyboard focus on controls gets a 2 px outline. Segmented controls are radio groups: one Tab
  stop, arrow keys to choose.
- ⌘+ / ⌘− / ⌘0 zoom the window (View menu).
- The caret doesn't blink when macOS Reduce Motion is on, and every animation is disabled
  under `prefers-reduced-motion`.

## Performance

- Only visible days (plus neighbors) are loaded into the renderer.
- A keystroke re-renders exactly one row (per-item subscriptions).
- Search is a folded-text scan in SQLite (case- and accent-insensitive). It takes
  milliseconds over 36k items. FTS5 is available if this ever needs to scale further.
- `pnpm bench` measures the packaged app against budgets (startup, input latency,
  navigation, search, memory). The current results are in the README. With five years of
  seeded data, launch to ready-to-type is ~240 ms and a keystroke renders in ~1–4 ms.

## Testing

- `pnpm test`: Vitest, in `apps/desktop/tests/unit` (and `tests/integration`, skipped
  unless `CUE_SUPABASE_URL` and `CUE_SUPABASE_KEY` point at a sync server). Date parsing,
  outline derivation, Markdown, the repository (versions, outbox, tombstones, LWW,
  restart, backup round-trip, five-year performance), sync convergence between replicas,
  the sync service and transport errors, every structural editor operation and undo,
  loose ends, rollover, links and link previews, the MCP server, export and zip, updates,
  and the brand tokens' copies. These are the tests for `core/`, so they cover the iPhone
  app's data and editing too.
- `pnpm test:e2e`: Playwright driving the real Electron app with a throwaway data
  directory. Covers the north-star flow, persistence across restart and SIGKILL,
  undo/redo of each action type, keyboard reordering, block selection, paste, search,
  the palette, drag and drop, links, loose ends, the window chrome and the brand.
- `pnpm test:sync`: the integration tests and the sync end-to-end spec, against the local
  Supabase stack ([SYNC.md](SYNC.md)).
- iPhone: `pnpm typecheck` in `apps/mobile`, and the Maestro flows in `apps/mobile/e2e`
  ([apps/mobile/README.md](../apps/mobile/README.md#end-to-end-tests)).
- CI (`.github/workflows/ci.yml`) runs both apps' typecheck and `pnpm test`. The rest
  need a Mac or a server and run locally.
