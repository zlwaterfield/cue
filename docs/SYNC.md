# Sync

Cue is local-first. Sync is **off by default**, and Cue on one Mac works exactly the same
with it off: no account, no network, and the sync code isn't even loaded. Turning it on in
Settings (email plus a six-digit code) keeps your notes on every device signed in to the same
account. Sync works entirely in the background and never makes typing wait.

## Decision

**Supabase (managed Postgres + Auth + Realtime) with a small push/pull protocol implemented as
two Postgres functions.** Item-level last-write-wins, ordered by hybrid logical clocks.

| Option | Verdict |
| --- | --- |
| Supabase / Postgres | ✅ Chosen. Auth, TLS, row-level security, backups, and account deletion are provided. The sync logic is ~100 lines of SQL. Works the same for Electron and any mobile stack. |
| Small custom server | Viable fallback using the identical protocol (the reference server is `src/shared/sync/memoryServer.ts`), but means running and securing a service. |
| CloudKit | Apple-only and awkward from Electron (CKSyncEngine is native-only). Reconsider only if Cue becomes a native Apple-only app. |
| Firebase | Document model and opaque conflict behavior; harder to reason about tombstones and ordering. |
| CRDT framework (Automerge, Yjs) | More machinery than plain text lines need. Revisit only if character-level merging of concurrent edits to the *same line* becomes important. |

## How it works

```
 renderer                        main process                              Supabase
┌──────────────┐ save ┌───────────────────────────────┐  sync_push(records)  ┌──────────────┐
│ item store   │─────▶│ repository: item + outbox row │─────────────────────▶│ items (RLS)  │
│ (typing      │      │ in one SQLite transaction     │  sync_pull(cursor)   │ seq feed     │
│  never waits)│◀─────│ sync engine ─ push, then pull │◀─────────────────────│              │
└──────────────┘ items│ service ─ account, lifecycle  │◀── "changed" hint ───│ Realtime     │
          :changed    └───────────────────────────────┘   (private channel)  └──────────────┘
```

- **Data model.** Items have UUIDv7 ids minted on-device; pages are identified by their ISO
  date, so two devices "creating" the same day never duplicate it. Every write is stamped with
  a hybrid-logical-clock version (`src/shared/hlc.ts`) that compares as a plain string, never
  goes backwards, and never ties across devices. Deletions are tombstones.
- **Outbox.** Each local write upserts `outbox(item_id, version)` in the same transaction as
  the item, whether sync is on or not. Push sends the *current* row, so repeated edits
  coalesce. Acknowledging removes the outbox row only if the version still matches, so edits
  made during a push stay queued.
- **Merge.** `Repository.applyRemote` accepts a record only if its version is strictly newer.
  Applying the same batch twice, or an old backup, is a no-op. Imported backups use the same
  path and are queued for upload.

### The engine (`src/shared/sync/engine.ts`)

- **Single flight.** One run at a time: push the outbox in batches of 500, then pull if needed.
  Triggers that arrive during a run share one follow-up run.
- **Local edits** are pushed 600 ms after typing pauses, or every 3 s during continuous
  typing. A burst of keystrokes is one request.
- **Remote edits** arrive as a realtime hint carrying the new feed position (`seq`). The engine
  pulls only if that's past its cursor, so its own pushes, which echo back, cost nothing. It
  also pulls on launch, when the channel reconnects, when the Mac wakes or Cue comes to the
  front after a minute away, and every 5 minutes as a safety net.
- **No echo downloads.** `sync_push` returns the account's highest `seq` before and after the
  write. If "before" equals the client's cursor, nothing else happened in between, so the client
  moves its cursor to "after" instead of downloading its own changes.
- **Failures** retry with exponential backoff (1 s doubling to 60 s, with jitter). While
  failing, typing doesn't add requests. Nothing is lost: the outbox and cursor live in SQLite,
  and the cursor advances only after a batch is stored.
- **Never in the way.** Network I/O is async. Each batch is merged in its own transaction and
  the engine yields between batches. With 5 years of notes (36,545 items), the longest stretch
  sync holds the main process is about 8 ms, during the very first full download. A normal edit
  costs 0.1 ms.
- **Quitting** right after typing waits up to 2 s for the last edits to upload. Anything
  still unsent goes on the next launch.
- **Server reset.** If the server reports less than the client has already seen (a restore,
  or a reset development database), the client re-queues everything and starts over.

### Sync and the editor

The editor doesn't know sync exists. Remote changes arrive through `ItemStore.applyExternal`,
the same path an import uses, with one rule: **an edit in progress always wins.**

- A line with an unsent edit ignores the remote copy. Its save gets a newer version and wins
  everywhere, so text never changes under your caret while you type.
- If a save of that line is already in flight, the version the database stored decides: the
  remote copy is shown only if it's newer than what was saved.
- When a line changes while it has focus but you're not typing, the caret stays where it was.

### The service (`src/main/sync/service.ts`)

- **Off by default.** Until someone signs in, it does nothing. `@supabase/supabase-js` is
  a separate chunk loaded only on sign-in, or at launch if this Mac was signed in. Startup is
  unaffected: sync starts after the first screen is ready.
- **Sign-in** is an emailed six-digit code typed into Settings (no browser redirect). The
  session is kept in SQLite, encrypted with the macOS Keychain (`safeStorage`), and
  refreshed automatically.
- **Turning sync on** for the first time uploads everything already on the Mac. Turning it off
  keeps every note locally. Turning it back on with the same account sends only what changed
  meanwhile. Switching to a different account uploads everything to it.
- **Network** goes through Electron's `net.fetch` (Chromium's stack), so sync follows the
  Mac's proxy and certificate settings.
- **Signed out by the server** (the account was deleted elsewhere, or the session was revoked):
  sync stops, notes stay, and Settings explains what happened.

### UI

- **Settings → Sync**: off, then your email, then the code, then on. When on, it shows "Synced
  just now", a pending-change count while offline, **Sync Now**, **Turn Off Sync** and
  **Delete Account…**. Builds without a sync server don't show it.
- **Title bar**: nothing while sync is healthy. A quiet "Offline" or "Sync paused" when it isn't,
  which opens Settings when clicked. A long sync, such as the first upload, fades in
  "Syncing…" after a second; quick ones never show.
- **Sync now** is a command (palette and File menu).

## Protocol

```
sync_push(records jsonb)             → { before, after }
sync_pull(since bigint, max_rows int) → { records, cursor, hasMore }
broadcast "changed" { seq } on private channel "sync:<user id>"
```

A record is the app's `Item` exactly (`id, date, parentId, position, type, text, done,
createdAt, updatedAt, deleted, version`), so the client does no mapping. The schema and
functions are in [`supabase/migrations`](../supabase/migrations).

- **`items`** has one row per user and item, `version` in the `C` collation (a locale
  collation could order versions differently from the clients), and a `seq` from a global
  sequence indexed per user. Row-level security lets a user read only their own rows. No one
  can write the table directly.
- **`sync_push`** takes a per-user advisory lock so that seq order is commit order. Without
  it, a reader could see seq 11 committed before seq 10 and skip 10 forever. It then does one
  set-based upsert that replaces a row only if the incoming version is newer. Malformed
  records are skipped instead of failing the batch, so one bad row can't block a queue. It
  sends one realtime hint per push, not one per row.
- **`sync_pull`** returns rows after a cursor, oldest first, in pages of up to 1,000.
- **`sync_delete_account`** deletes the user, and their rows cascade.

## Conflicts

- **Different items:** always merge. Nothing is shared between rows.
- **Same item, both edited offline:** the higher version wins on every replica. Because the
  HLC tracks wall time, this is effectively "the most recent edit wins."
- **Delete vs. edit:** also LWW. A newer edit restores the item; a newer delete removes it.
  A stale replica can never resurrect a deletion.
- **Structure:** each item stores its own parent and position, so concurrent changes can
  produce odd shapes. The outline builder (`src/shared/outline.ts`) is total by design:
  orphans render at the top level, parent cycles are broken, and nothing is ever hidden.

**Known limitations**

- LWW is per *item*. If one device completes a to-do while another edits its text, one change
  wins. The upgrade path is per-field versions merged field by field, a contained change in
  `applyRemote` and `sync_push` with the same record format.
- A device whose clock is far in the future wins every conflict until real time catches up.
  This is standard for HLCs. A server-side bound on accepted versions would close it.
- Tombstones are never compacted yet. Once every device has pulled a deletion, the server can
  clear its text.

## Setting up a server

1. Create a Supabase project and apply the migration: `npx supabase link`, then
   `npx supabase db push`. You can also paste
   `supabase/migrations/*_sync.sql` into the SQL editor.
2. **Auth → Providers → Email**: enable it, and allow new users to sign up.
3. **Auth → Email Templates**: edit "Magic Link" and "Confirm signup" so they show the
   code, for example `Your Cue code is {{ .Token }}`
   (see `supabase/templates/sign-in-code.html`). Set up custom SMTP so the emails come from your
   domain.
4. Build Cue with the project URL and publishable (or anon) key, from the environment or a
   `.env.local` file:

   ```sh
   CUE_SUPABASE_URL=https://<project>.supabase.co
   CUE_SUPABASE_KEY=sb_publishable_…
   ```

   The key is public by design; row-level security protects the data. A build without
   these doesn't offer sync.

## Development and testing

Run a local stack in Docker. Sign-in emails land in Mailpit at http://127.0.0.1:54324.

```sh
npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,postgres-meta,supavisor
npx supabase status    # API URL and publishable key
export CUE_SUPABASE_URL=http://127.0.0.1:54321 CUE_SUPABASE_KEY=<publishable key>
pnpm dev               # sync is now offered in Settings
pnpm test:sync         # integration + end-to-end sync tests against the local stack
npx supabase stop
```

- **`pnpm test`** covers the engine without a server: scheduling, echo suppression, backoff,
  server reset, the service lifecycle, the editor's in-progress rule, and a randomized
  three-device convergence test. That test replays 400 random offline edits, moves, deletes
  and reconnects, then checks that every replica ends with exactly the newest write of every
  item.
- **`tests/integration`** runs the real protocol against Supabase. It covers sign-in by
  emailed code, realtime delivery (about 30 ms after the typing pause, locally), no echo
  downloads, account isolation under RLS, LWW and skipping malformed records, a gap-free feed
  under concurrent pushes, 5,000 items (up ~0.2 s, down ~0.1 s locally), session restore and
  account deletion.
- **`tests/e2e/sync.spec.ts`** drives two real Cue apps. It checks that sync is off by
  default, that typing is undisturbed while the other Mac edits the same day, turning sync
  off, a quick quit still uploading, and catching up on launch.

## Mobile

The iPhone app ([mobile/](../mobile)) runs this exact code: the repository, outbox and HLC
(`src/shared/repository.ts`, `src/shared/hlc.ts`), the engine and the Supabase transport
(`src/shared/sync/`). Its database is expo-sqlite with the same schema and migrations
(`src/shared/sqlite.ts`). Only the lifecycle differs:

- **Sync is required.** There's no local-only mode. The phone signs in before showing
  anything, and its database is a local copy of the account. Signing out checks that
  nothing is left unsent, then removes the notes and outbox from the phone, but keeps the
  device id and clock (`Repository.clearNotes`). Signing in to a different account than
  the one the database holds starts from empty. If the server ends the session, the notes
  stay until someone signs in again, so unsent edits aren't lost.
- **Faster pushes.** 450 ms after typing pauses (2 s at most), as soon as focus leaves a
  line, and when the app leaves the screen. That last push runs inside a short iOS
  background task (`modules/cue-native`), so it finishes before the app is suspended.
- **Pull on return.** Realtime hints don't reach a suspended app, so coming back to the
  foreground pulls immediately, and the realtime channel reconnects on its own.
  The session refresh timer runs only in the foreground (`SupabaseSync.setForeground`).
- **The session lives in the Keychain**, readable only on this device, after first unlock.
  A fresh install clears any session a previous install left there.
- **The first download** of a large account runs in the background while today's page
  shows. Five years of notes (36,994 items) took about 4 s against the local server in a
  development build. The header says "Getting your notes…" until it's done.

The end-to-end flows in `mobile/e2e` test sync against the local stack. One has another
device sign in to the same account over HTTP and call `sync_push`, then checks that the
phone shows the line within 3 s without a refresh.
