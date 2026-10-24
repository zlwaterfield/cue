# Desktop MVP acceptance criteria

Each criterion from the product brief, how Cue meets it, and the test that checks it.
E2E tests drive the real Electron app (`pnpm test:e2e`); unit tests run under Vitest
(`pnpm test`).

| # | Criterion | How | Verified by |
| - | --- | --- | --- |
| 1 | Open Cue and immediately type into today's page | The caret starts on today's blank line; typing creates the first item. | every e2e test (`launch()` asserts focus), *north star* |
| 2 | Create plain text, bullets, to-dos, and nested items | Typing, `- ` / `[] ` shortcuts, ⇧⌘↩, the palette's Convert commands, Tab | *north star*, *markdown shortcuts*, *Enter on an empty list item* |
| 3 | Reorder and indent using only the keyboard | ⌥↑/⌥↓, Tab/⇧Tab, block selection (Esc, ⇧↑/⇧↓) | *reorder and indent with only the keyboard*, `ops.test.ts` |
| 4 | Complete and reopen a task | ⌘↩, or click the checkbox | *north star*, *undo and redo…*, *shift-click…checkbox* |
| 5 | Move an item and its children to tomorrow with one command | ⌘D | *undo and redo…* (move step), `ops.test.ts` "moves the item and its children" |
| 6 | Move an item to an arbitrary date through ⌘K | ⌘K "move to fri", or ⇧⌘D with natural-language dates | *north star*, *search finds text…* (`in 10 days`), `dateParse.test.ts` |
| 7 | View and edit today, tomorrow, and the rest of the week | Week view (⌘3), every day directly editable; arrows move across days | *the week view shows…*, *arrow keys move…across days* |
| 8 | Navigate to any daily page | ⌘[ / ⌘], ⌘J (natural language + calendar), clicking a day title | *north star* (⌘J friday), *clicking a day title…* |
| 9 | Search all stored text and open a result | ⌘F: case- and accent-insensitive, newest first; Enter opens the day with the caret on the match | *search finds text on any day*, `repository.test.ts` search |
| 10 | Quit and reopen without losing content or structure | Write-behind within 40 ms, synchronous flush on unload, WAL with synchronous=FULL | *everything survives quitting and reopening*, *edits survive the app being killed outright*, `repository.test.ts` "persists across restarts" |
| 11 | Undo a completion, move, reorder, conversion, or deletion | Application-level undo/redo with selection restore | *undo and redo cover…*, *typing undoes in natural chunks* |
| 12 | Export all data in a human-readable format | File ▸ Export as Markdown (one file per day) or JSON backup; JSON import merges safely | `portability.test.ts`, `repository.test.ts` backup round-trip |
| 13 | Stable IDs, extensible with a remote sync adapter | UUIDv7 ids, HLC versions, tombstones, outbox, `applyRemote`, `SyncEngine` + reference server | `sync.test.ts` (offline replicas converge, no duplicates, no resurrection), [SYNC.md](SYNC.md) |

**North-star test**: open Cue, capture several thoughts, turn two into tasks, nest
one beneath another, complete one, and move another to Friday, all without the
mouse. This is the first test in `tests/e2e/editor.spec.ts`.
