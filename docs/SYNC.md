# Sync design

Cue's desktop MVP is local-only, but its storage was built for the mobile app and
cross-device sync that come next. This document records the strategy chosen, the
protocol, and why the current data model already supports it.

## Decision

**Supabase (managed Postgres + Auth) with a small push/pull protocol implemented as
two Postgres functions.** Item-level last-write-wins, ordered by hybrid logical clocks.

Why this over the alternatives:

| Option | Verdict |
| --- | --- |
| Supabase / Postgres | ✅ Chosen. Auth (Sign in with Apple, email links), TLS, row-level security, backups, and account deletion are provided. The sync logic is ~60 lines of SQL. Works the same for Electron and any mobile stack. |
| Small custom server | Viable fallback using the identical protocol (the reference server is `src/main/sync/memoryServer.ts`), but means running and securing a service. |
| CloudKit | Apple-only and awkward from Electron (CKSyncEngine is native-only). Reconsider only if Cue becomes a native Apple-only app. |
| Firebase | Document model and opaque conflict behavior; harder to reason about tombstones and ordering. |
| CRDT framework (Automerge, Yjs) | More machinery than plain text lines need. Revisit only if character-level merging of concurrent edits to the *same line* becomes important. |

## What the desktop already does

Everything below exists and is tested today (`tests/unit/sync.test.ts`,
`tests/unit/repository.test.ts`):

- **Stable identities.** Items have UUIDv7 ids minted on-device; pages are identified
  by their ISO date, so two devices "creating" the same day can never duplicate it.
- **Versions.** Every write is stamped by a hybrid logical clock
  (`src/main/hlc.ts`): `wallclock-counter-deviceId`, fixed width, compared as strings.
  Versions never go backwards on a device, always exceed anything the device has
  seen, and never tie across devices.
- **Tombstones.** Deleting sets `deleted = 1`; rows are never removed, so deletions
  replicate and cannot be resurrected by a stale copy.
- **Pending-change queue.** Each local write upserts `outbox(item_id, version)` in
  the same SQLite transaction as the item. Push sends the *current* row, so repeated
  edits coalesce naturally. Acknowledgement removes the outbox row only if the
  version still matches, so edits made during a push stay queued.
- **Deterministic merge.** `Repository.applyRemote` accepts a record only if its
  version is strictly newer than the stored one. Applying the same batch twice, or an
  old backup, is a no-op. JSON backup import uses this same path.
- **Sync engine.** `src/main/sync/engine.ts` implements push-all → pull-all with
  batching, a durable cursor (advanced only after a batch is merged), exponential
  backoff, and a status (`idle | syncing | offline | error`) for the UI.
- **Editor isolation.** The renderer never sees versions or the outbox. Remote changes
  arrive through `ItemStore.ingest` (the same path a backup import uses today), so
  adding sync requires no editor changes.

## Protocol

```
push(deviceId, records[])  → { accepted: [{ id, version }] }
pull(cursor, limit)        → { records[], cursor, hasMore }
```

A record is a full item row: `id, date, parentId, position, type, text, done,
createdAt, updatedAt, deleted, version`.

### Server schema (Postgres)

```sql
create table items (
  user_id    uuid not null references auth.users on delete cascade,
  id         text not null,
  date       date not null,
  parent_id  text,
  position   text not null,
  type       text not null check (type in ('text','bullet','todo')),
  text       text not null,
  done       boolean not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted    boolean not null,
  version    text not null,
  seq        bigint not null,
  primary key (user_id, id)
);
create index on items (user_id, seq);
alter table items enable row level security;
create policy own_rows on items using (user_id = auth.uid());
```

### push (Postgres function, `security definer`)

1. `pg_advisory_xact_lock(hashtext(auth.uid()::text))`. This serializes a user's
   writes so `seq` order equals commit order. Without it, a reader could see seq 11
   committed before seq 10 and skip 10 forever.
2. For each record:
   `insert … on conflict (user_id, id) do update set … , seq = next_seq where excluded.version > items.version`.
3. Return every pushed `{id, version}` as accepted. The server now holds that version
   or a newer one, and either way the client can drop it from the outbox.

### pull

`select … from items where user_id = auth.uid() and seq > $cursor order by seq limit $n`.
The cursor is the last `seq` returned. Clients apply rows with `applyRemote`, which
ignores anything not newer, including the device's own echoes.

### Scheduling

Sync runs on launch, after local writes (debounced ~2s), on regaining network or
focus, and every few minutes. Failures back off exponentially (capped at 60s) and
lose nothing, because the outbox and cursor are durable. Later, a realtime channel
(Supabase Realtime on `items`) can be used purely as a "pull now" hint.

## Conflicts

- **Different items:** always merge. Nothing is shared between rows.
- **Same item, both edited offline:** the higher version wins on every replica.
  Because the HLC tracks wall time, this is effectively "the most recent edit wins."
- **Delete vs. edit:** also LWW. A newer edit restores the item; a newer delete
  removes it. A stale replica can never resurrect a deletion.
- **Structure:** each item stores its own parent and position, so concurrent
  changes can produce odd shapes. The renderer's outline builder
  (`src/shared/outline.ts`) is total by design: orphans (parent missing, deleted, or
  on another day) render at the top level, parent cycles are broken, and duplicate
  positions are ordered by id and re-keyed on the next local insert. Nothing is ever
  hidden or silently deleted.

**Known limitation:** LWW is per *item*. If one device completes a to-do while
another edits its text, one change wins. The upgrade path is per-field versions
(`text_version`, `done_version`, `structure_version`) merged field by field. It's a
contained change in `applyRemote` and the push function, and the record format
stays compatible.

## Accounts, privacy, deletion

- Auth: Sign in with Apple plus email magic link (Supabase Auth). The local database
  gets a `user_id` in `meta` on first sign-in; existing local data is pushed as-is,
  and stable ids prevent duplicates if the same data reaches the server twice.
- Transport: HTTPS/TLS only. Server-side encryption at rest comes from the provider.
  End-to-end encryption of `text` is possible later without protocol changes
  (encrypt `text` client-side, keep structure fields plain).
- Deletion: "Delete account" calls a function that deletes `auth.users` rows, and
  rows cascade. The app then offers to keep or erase the local copy.
- Tombstone compaction: tombstones older than ~90 days whose deletion every
  registered device has pulled can have `text` cleared server-side.

## Sync status in the UI

A small dot beside the title bar's ⌘K hint: hidden when synced, a quiet spinner while
syncing, "Offline" when unreachable, and a clickable warning after repeated errors.
It is never a modal and never blocks typing.

## Mobile

The mobile app implements the same three pieces: an SQLite store with the same
columns and outbox, the HLC, and `applyRemote` semantics. The protocol is plain
JSON over HTTPS, so a native SwiftUI client (GRDB) and a React Native client are
equally viable. The release gate is a test suite that replays offline edit
scripts across ≥3 simulated devices and asserts convergence, no duplicates, and no
resurrection, extending `tests/unit/sync.test.ts`.
