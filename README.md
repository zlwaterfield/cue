<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/readme/readme-header-dark.svg">
  <img alt="cue — Every day is a page. Start typing." src="docs/brand/readme/readme-header-light.svg" width="100%">
</picture>

<p align="center">
  A fast, quiet, keyboard-first daily notes and to-do app for macOS.
</p>

> [!WARNING]
> **Cue is in early alpha and is not ready for real use.** It's under active development, the
> storage format may change without a migration, and **your notes could be lost at any time.**
> Don't keep anything in Cue that you can't afford to lose. If you try it, export often
> (File ▸ Export as Markdown).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/week-dark.png">
  <img src="docs/images/week-light.png" alt="Cue's week view: today's notes, to-dos and nested bullets, with tomorrow below">
</picture>

Every day in Cue is a lightweight page of text, bullets and to-dos. You open the app and start
typing into today. Tab nests a line, ⌘↩ completes it, ⌘D pushes it to tomorrow, and ⌘K sends
anything anywhere. There are no projects, tags, priorities or dashboards: only days, and the
things you wrote on them.

Cue is built around three ideas:

- **The day is the organizing unit.** Things belong to dates, not to folders.
- **Keyboard first, mouse friendly.** Every action has a shortcut and appears in ⌘K.
- **Fast and safe, or it isn't done.** Nothing waits on a save, and every change is on disk
  within a few dozen milliseconds. Speed is measured, budgeted and tested (see
  [Performance](#performance)).

## What it does today

Cue 0.1 is a working macOS app (Apple silicon). Here is everything it does right now.

**Writing**

- Plain text, bullets and to-dos, nested as deep as you like.
- Enter continues the current type; Enter on an empty bullet exits the list; Backspace at the
  start of a line removes formatting, then indentation, then joins it to the line above.
- Markdown shortcuts as you type: `- ` makes a bullet, `[] ` a to-do, `[x] ` a done to-do. ⌘Z
  straight afterwards undoes just the formatting.
- Pasting multi-line text (including Markdown lists from other apps) creates real, nested items.
- Links are highlighted, and ⌘-click opens them.

**Organizing**

- **Week view**: today, tomorrow and the rest of the week, all directly editable. Today is the
  largest; the days after it are slightly more compact.
- **Day view** for any date, with ⌘[ / ⌘] to step through days.
- Complete or reopen with ⌘↩ or a click. Completed to-dos stay where they are.
- Reorder with ⌥↑/⌥↓ or drag and drop, including onto another day. Children always move with
  their parent.
- Move to tomorrow (⌘D), the next weekday, next week, or any date (⇧⌘D). A small toast confirms
  the move and offers Undo.
- Select several lines with Esc then ⇧↑/⇧↓, by dragging across them, or with ⌘A twice. Then
  indent, move, complete, convert, copy, cut or delete them together.

**Finding**

- **⌘K command palette**: fuzzy search over every action, with shortcuts shown. It also
  understands dates: type "move to fri" or "go to oct 31".
- **Natural-language dates** anywhere a date is asked for: "tomorrow", "fri", "next mon",
  "oct 31", "in 3 days", "+2w", "2026-10-31", with a calendar alongside.
- **⌘F search** across every day you've ever written. It ignores case and accents and shows each
  result's date and type; Enter opens the day with the caret on the match.

**Reliability**

- Saves automatically in the background. A save never makes you wait, and there's no Save button.
- **Undo and redo for everything**: typing, completion, conversion, reordering, moving between
  days and deletion. Undo also puts the caret back where it was.
- Local SQLite storage in WAL mode with full-sync commits, so edits survive a crash. The test
  suite kills the app with `kill -9` mid-session and checks that nothing was lost.
- A consistent snapshot of your data every day, with the last 14 kept.
- Export everything as Markdown (one file per day) or as a full JSON backup. Importing a JSON
  backup merges safely: it never duplicates items or brings deleted ones back.

**Feel**

- A single calm column, hanging bullets and checkboxes, and system typography, in monochrome
  graphite with no hue.
- The caret is the brand: a 2 px graphite bar with a calm, hard blink. It holds still while
  you type and doesn't blink at all with Reduce Motion on.
- Light and dark appearance that follows macOS, or can be set by hand.
- A native macOS menu bar, a native context menu with spelling suggestions, and window size
  and position remembered between launches.

## Performance

Speed is a feature here, so it's measured rather than assumed. Each number below comes from
`pnpm bench`, which drives the real packaged app, and each has a budget it must stay under.

| | Result | Budget | Notes |
| --- | --- | --- | --- |
| Launch → ready to type, empty | 259 ms | ≤ 400 ms | median of 7 cold launches |
| Launch → ready to type, 5 years of notes | 258 ms | ≤ 400 ms | 36,509 items |
| Keystroke → frame rendered | 2.6 ms · p95 3.7 ms | ≤ 8 ms | handlers finish in 1.2 ms |
| Enter → new line rendered | 1.6 ms · p95 8.3 ms | ≤ 16 ms | |
| Tab / ⇧Tab → re-indented | 3.5 ms · p95 7.8 ms | ≤ 16 ms | |
| ⌘↩ → to-do toggled | 6.4 ms · p95 12 ms | ≤ 16 ms | |
| ⌥↑ / ⌥↓ → item moved | 6.9 ms · p95 12 ms | ≤ 16 ms | |
| ⌘[ → previous day rendered | 14 ms · p95 17 ms | ≤ 50 ms | read from SQLite every time |
| Search 36,509 items | 0.5 ms · p95 6.6 ms | ≤ 50 ms | p95 is a full scan with no matches |
| Load a week of notes | 0.5 ms · p95 0.6 ms | ≤ 10 ms | renderer → SQLite → renderer |
| Memory, idle after launch | 391 MB | | resident, all processes combined |
| UI code | 309 KB | | 95 KB gzipped, React included |
| Database, 5 years of notes | 15 MB | | one SQLite file |
| Download (.dmg) | 122 MB | | Electron runtime included |

<sub>Measured on an Apple M4 Pro with 48 GB of RAM, macOS 26.6, using the packaged arm64 build.
Results vary by a few milliseconds from run to run. Latency budgets apply to the p95.</sub>

**How it's measured**

- **Launch** is the time from spawning the process to the moment the first screen accepts
  typing, signaled by the app itself. The first launch of a new build is discarded, because
  macOS checks a new binary once.
- **Input latency** is the time from the keydown event to the next frame the renderer produces.
  Keys are sent every 30 ms, a fast human pace, rather than in a synthetic burst. It doesn't
  include the display's own refresh delay.
- **Storage** round trips go renderer → main process → SQLite → back, against five years of
  generated notes (`pnpm seed`).
- **Memory** is resident memory summed over all of Cue's processes. That over-counts pages
  shared with the OS.

**Why it's fast**

- **Typing touches one line.** Each item has its own subscription, so a keystroke re-renders
  exactly one row, and the edit is applied in memory before anything is written.
- **Writes happen behind you.** Changes are coalesced and written within 40 ms; the window never
  waits on the database.
- **Only what's on screen is loaded.** Years of notes cost nothing until you navigate to them.
- **No native modules or runtime dependencies.** Storage uses SQLite through Node's built-in
  `node:sqlite`, and the UI is a single 95 KB (gzipped) bundle.

**The trade-off**

Cue runs on Electron because Chromium's text editing is the most reliable surface available for
an editor like this, and because it lets the real app be tested end to end. The cost is a
larger download and higher baseline memory than a native app would have. That is a known,
deliberate trade, and the budgets above are how the rest stays honest.

To reproduce the numbers, build the app first:

```sh
pnpm package
pnpm bench            # prints the table above
pnpm bench --check    # exits non-zero if anything misses its budget
```

## Getting started

There are no signed downloads yet. To try Cue, build it from source on macOS (Apple silicon),
with Node 24+ and pnpm installed. Local builds are ad-hoc signed, so they run on your Mac
without an Apple Developer account:

```sh
git clone https://github.com/zlwaterfield/cue.git
cd cue
pnpm install
pnpm dev                     # run with hot reload
pnpm package                 # or build release/mac-arm64/Cue.app
```

Development builds run as "Cue Dev" (a branded copy of Electron's bundle is created the
first time you run `pnpm dev`). They keep their data separate from the packaged app, in
`~/Library/Application Support/Cue Dev`, so working on Cue can't touch your notes.

## Keyboard

| | |
| --- | --- |
| Command palette | ⌘K |
| Search | ⌘F |
| Today · Tomorrow · This week | ⌘1 · ⌘2 · ⌘3 |
| Previous / next day | ⌘[ · ⌘] |
| Go to date | ⌘J |
| New item | ⌘N, or just start typing |
| Complete / reopen | ⌘↩ |
| Toggle bullet ↔ to-do | ⇧⌘T |
| Indent / outdent | Tab · ⇧Tab |
| Move up / down | ⌥↑ · ⌥↓ |
| Move to tomorrow | ⌘D |
| Move to date | ⇧⌘D |
| Delete item | ⇧⌘⌫ |
| Select lines | Esc, then ⇧↑ / ⇧↓ (⌘A twice selects the whole day) |
| Undo / redo | ⌘Z · ⇧⌘Z |
| Every shortcut | ⌘/ |

## Your data

- Everything stays on your Mac, in a single SQLite file at
  `~/Library/Application Support/Cue/cue.sqlite`. Daily snapshots are kept in `Backups/` beside
  it.
- Cue has no accounts and no telemetry, and it doesn't talk to any server.
- You can always get your notes out: File ▸ Export as Markdown writes one readable file per
  day, and Export JSON Backup writes everything.
- Set `CUE_USER_DATA=/some/folder` to run Cue against a different data folder.

## How it's built

- **App:** Electron 44, React 19 and TypeScript, built with electron-vite.
- **Editor:** each line is its own plain-text editable. An in-memory item store is the source
  of truth, and undo and redo are handled by the app rather than the browser.
- **Storage:** the main process owns SQLite behind a narrow, typed interface. The window never
  sees SQL.
- **Sync-ready data model:** every item has a stable UUIDv7 id, a hybrid-logical-clock version
  and a tombstone flag for deletions. Local changes queue in an outbox written in the same
  transaction, so sync can be added without touching the editor.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SYNC.md](docs/SYNC.md) and
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). The brand (logo, app icon, color tokens, usage guide,
and README, social and DMG artwork) lives in [docs/brand](docs/brand).

## Roadmap

Cue is being built in the open, in this order. Nothing below is promised to a date.

**Done: 0.1 alpha, desktop core**
Everything in [What it does today](#what-it-does-today), plus unit and end-to-end tests,
performance budgets, and the brand ([docs/brand](docs/brand)).

**Next: beta, safe for daily use**
- A stable storage format with tested migrations, and a way to restore from any daily snapshot
  inside the app.
- Signed, notarized builds with automatic updates, and a Liquid Glass app icon built in
  Icon Composer from the brand's layers ([docs/brand/app-icon](docs/brand/app-icon/ICON-COMPOSER.md)).
- Performance budgets enforced in CI on every pull request.
- Polish from real-world use: collapsing nested items, an optional `/` menu for line types, and
  Intel and universal builds.

**Then: sync and accounts**
- Sync across Macs, designed in [docs/SYNC.md](docs/SYNC.md): Supabase (Postgres plus auth),
  a small push/pull protocol, and newest-edit-wins per item. The client half (versions,
  tombstones, outbox and merge) is already built and tested against a reference server.
- Sign in with Apple and email, a quiet sync-status indicator, and a clear way to delete your
  account and data.
- Per-field merging, so that completing a to-do on one device and editing its text on another
  both survive.

**After that: mobile**
- An iPhone app on the same data model and sync protocol. It ships only once sync has proven
  reliable across devices, offline edits and conflicts.

**Exploring**
End-to-end encryption of note text, customizable shortcuts, and Windows and Linux builds
(Electron makes these possible; they're not a focus yet).

**Not planned**
Cue stays small on purpose. Projects, tags, priorities, due times, reminders, recurring tasks,
attachments, collaboration, AI features, dashboards and gamification are out of scope.

## Contributing

Issues and pull requests are welcome. Cue is early, so for anything bigger than a fix, open an
issue first.

```sh
pnpm test         # unit tests: dates, outline, storage, sync, every editor operation
pnpm test:e2e     # end-to-end tests that drive the real app
pnpm typecheck
pnpm bench        # performance against the budgets
```

A few rules keep Cue the way it is:

- **Every action is a command.** Add it to `src/shared/commands.ts` so it gets a shortcut, a
  palette entry and a menu item together.
- **Performance is a requirement, not a nicety.** If a change touches typing, navigation, search
  or startup, run `pnpm bench` and keep it under budget.
- **Data safety comes first.** All reads and writes go through the repository, migrations only
  ever append, and anything that could lose data needs a test.
- **Less, but better.** New features should make the daily page better without adding fields,
  panels or settings to the main screen.

## License

The code is [MIT](LICENSE) © 2026 Zach Waterfield.

The Cue name, logo and app icon (the artwork in [docs/brand](docs/brand)) are not covered
by the MIT license. You're welcome to use them to refer to Cue, for example in an article or
a link. Please don't use them for your own app or service, or in a way that suggests it's
made or endorsed by Cue. If you distribute a modified version, give it a different name and
icon.
