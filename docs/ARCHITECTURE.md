# Architecture

```
┌──────────────────────── Electron main process ────────────────────────┐
│  index.ts      window, lifecycle, IPC, dialogs, context menu          │
│  guard.ts      first import: network errors never freeze the app      │
│  menu.ts       native menu generated from shared/commands.ts          │
│  db.ts         SQLite (node:sqlite), WAL, synchronous=FULL             │
│  sync/service  optional sync: account, lifecycle, Keychain session    │
│  portability.ts the filesystem around shared/portability, backups      │
└──────────────▲─────────────────────────────────────────────────────────┘
               │ narrow, typed IPC (preload/index.ts → window.cue)
┌──────────────┴──────────────── Renderer (React) ───────────────────────┐
│  editor/controller.ts  focus, keys, selection, undo, every command     │
│  editor/ItemRow, DaySection   rendering                                │
│  ui/              palette, sheets, header, toast                       │
└────────────────────────────────────────────────────────────────────────┘

 shared/ (also the iPhone app's core; see mobile/README.md)
   types, dates, date parsing, outline, markdown, commands
   sqlite.ts       schema + migrations, for node:sqlite and expo-sqlite alike
   repository.ts   the storage boundary (validation, versions, outbox)
   hlc.ts          hybrid logical clock
   sync/           engine, Supabase transport, in-memory reference server, status words
   itemStore.ts    in-memory items for loaded days + write-behind queue
   portability.ts  what export is: the Markdown tree, and the backup's JSON
   zip.ts          the Markdown tree as one file, for a phone with no folders
   editor/ops.ts   structural operations (pure functions over a draft)
   editor/tx.ts    draft transaction over the store
   editor/undo.ts  application-level undo
   editor/geometry.ts  drop placement for touch drag and drop
```

The Mac app and the iPhone app share everything about the data and how it changes: the
model, storage, merge rules, sync, and every editing operation. Each app adds only its
platform: Electron, IPC and contenteditable on the Mac; touch, the keyboard and the iOS
lifecycle on the phone ([mobile/README.md](../mobile/README.md)).

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

See `src/shared/types.ts`. Items carry `id, date, parentId, position, type, text,
done, createdAt, updatedAt, deleted, version`. Order among siblings is a fractional
index (`position`) with the id as a tiebreaker, so inserting never rewrites
neighbors and concurrent inserts can't collide destructively. Siblings can end up with
the same key (two devices inserting at one spot offline). A new line (Return, paste)
placed among them goes after the tied run, so nothing another device is editing gets
rewritten. Moving a line into the tie (⌥↑, ⌥↓, drag) is an explicit reorder: the twins
after the slot get fresh keys, so the line lands exactly where asked, and the twins
before it keep theirs. Only those rewritten twins could lose an unsynced edit another
device makes to them at the same moment.

The outline for a day is derived, never stored (`shared/outline.ts`). Derivation is
total: orphaned items render at the top level and parent cycles are broken.

## The storage boundary

The renderer can only call the methods in `CueBridge` (`shared/types.ts`):
`loadDates`, `saveItems`, `search`, `datesWithItems`, settings, export and import. It
never sees SQL, versions, or the outbox. `Repository` validates every record,
stamps versions, writes the outbox in the same transaction, and skips no-op writes.
Sync plugs into the repository (`pendingChanges`, `acknowledge`, `applyRemote`) from the
main process and never touches the editor. It's off by default and loads nothing until you
sign in. See [SYNC.md](SYNC.md).

## Saving and durability

- Edits apply to the in-memory store synchronously, so typing never waits.
- The write-behind queue coalesces per item and flushes within 40 ms
  (`shared/itemStore.ts`). Failures retry with backoff and surface a quiet "Couldn't
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

`shared/editor/undo.ts`. Every action is one entry of before/after item copies plus the
selection on each side. Typing coalesces into runs (split by pauses, focus changes,
and structural actions). Undo and redo are *new writes* with new versions, which
keeps them correct under sync. Undoing a move to Friday brings the item back and puts
the caret where it was, navigating if needed.

Undo reverses only what the action changed, field group by field group (place, type,
text, completion, deletion), and only where the item still holds what the action left
(`revert`). A newer edit from another device stays, a line deleted elsewhere stays
deleted, and an undo with nothing left to do says "Already changed on another device".

## Keyboard and menus

`shared/commands.ts` is the single source for command titles and shortcuts. The
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

- Body text, secondary text and the accent meet WCAG AA in both modes (`docs/brand/tokens/contrast.md`).
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

- `pnpm test`: Vitest. Date parsing, outline derivation, Markdown, the repository
  (versions, outbox, tombstones, LWW, restart, backup round-trip, five-year
  performance), sync convergence between replicas, and every structural editor
  operation.
- `pnpm test:e2e`: Playwright driving the real Electron app with a throwaway data
  directory. Covers the north-star flow, persistence across restart and SIGKILL,
  undo/redo of each action type, keyboard reordering, block selection, paste, search,
  the palette, and drag and drop.
