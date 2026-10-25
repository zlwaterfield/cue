# Cue's core

The Mac app and the iPhone app are two shells around this folder: the data model, the SQLite
schema and migrations, the repository, the hybrid logical clock, the sync engine, the MCP
server, and every editing operation. One implementation, so a line indents the same way, a
day rolls over the same way and a conflict resolves the same way on both. `docs/ARCHITECTURE.md`
lists what's in each file.

Three things build against it, each reaching it differently:

| Consumer | How it imports |
| --- | --- |
| The Mac app, `apps/desktop/` | `@shared/*`, aliased in `tsconfig.json`, `electron.vite.config.mts` and `vitest.config.mts` |
| The iPhone app, `apps/mobile/` | `@shared/*`, resolved by its `metro.config.js` and `tsconfig.json` |
| The MCP endpoint, `supabase/functions/mcp/` | relative paths, with extensions mapped in its `deno.json` |

That's what the rules here are for:

- **Nothing points back out.** No file here imports from either app. What differs
  between a Mac and a phone arrives as an argument or an interface it implements
  (`SqlDatabase`, `StoreBackend`, `SessionStore`), never as a branch on the platform.
- **Third-party imports have to work in all three.** The two apps install separately and the
  endpoint runs on Deno, so anything imported here (today: `@supabase/supabase-js` and
  `fractional-indexing`) has to be a dependency of both apps, on the same major, and has to
  run on Deno.
- **No DOM, no React Native, no Node built-ins.** `node:sqlite` is the Mac app's; this folder
  takes a `SqlDatabase`.
- **The unit tests live with the Mac app** (`apps/desktop/tests/unit`), and they're the tests for this
  folder: both apps rely on them.
