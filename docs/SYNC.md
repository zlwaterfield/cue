# Sync

Cue is local-first. Sync is **off by default**, and Cue on one Mac works exactly the same
with it off: no account, no network, and the sync code isn't even loaded. Turning it on in
Settings (Sign in with Apple, or your email plus a six-digit code) keeps your notes on every
device signed in to the same account. Sync works entirely in the background and never makes typing wait.

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
- **Typing** is pushed 600 ms after it pauses, or every 3 s during continuous typing. A burst
  of keystrokes is one request. **Every other edit** (a new line, a move, an indent, a
  toggle, a delete, a paste) is pushed at once, so it reaches other devices in about 60 ms
  instead of after the pause. A save counts as typing when only the text changed
  (`isTextOnlyChange`). Undo and redo follow the same rule: undoing a structural edit is
  pushed at once, undoing typing waits for the pause.
- **Remote edits** arrive as a realtime hint carrying the new feed position (`seq`). The engine
  pulls only if that's past its cursor, so its own pushes, which echo back, cost nothing. It
  also pulls on launch, when the channel reconnects, when the Mac wakes or Cue comes to the
  front after a minute away, and every 5 minutes as a safety net. While the realtime channel
  is down (`setLive(false)`), it checks every 30 seconds instead.
- **Joining an account** (cursor 0) first fetches today ± 7 days straight from the table
  (`pullDates`), so the pages you're looking at fill in before the full download. The feed
  still runs from the start afterwards, and records already stored are skipped.
- **No echo downloads.** `sync_push` returns the account's highest `seq` before and after the
  write. If "before" equals the client's cursor, nothing else happened in between, so the client
  moves its cursor to "after" instead of downloading its own changes.
- **Failures** retry with exponential backoff (1 s doubling to 60 s, with jitter). While
  failing, edits don't add requests. Nothing is lost: the outbox and cursor live in SQLite,
  and the cursor advances only after a batch is stored.
- **No request waits forever.** Every request has a deadline that covers the whole response.
  Sign-in gets 10 s. A sync request gets 20 s plus the time to upload its body at 32 kbps,
  so a 500-row batch (about 150 KB) has about 58 s to get through a slow link, while a hung
  request still gives up after about 20 s. Once the answer starts, it gets 20 s plus the time
  its declared length takes at that rate. A timed-out request fails like a lost connection
  and is retried. Stopping sync waits at most a second for a run in progress; a request that
  answers later is dropped without touching the outbox or the cursor.
- **Errors in words.** The transport turns every failure into a sentence
  (`transportError`): no connection is Offline, a refused session is a `SessionError`, a
  server error is "The sync server isn’t responding", and anything else is "Sync paused".
  Raw server, SQL and network text goes to the console only, never to the UI.
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
- When the line you're on is deleted, or moved off screen, on another device, the Mac puts
  the caret at the end of the line above and the iPhone puts the keyboard away. A toast says
  "Deleted on another device" (with Undo, which brings the line back everywhere) or "Moved
  to … on another device".
- Undo reverses only what your action changed, so it never takes back another device's
  newer edit (see [ARCHITECTURE.md](ARCHITECTURE.md#undo)).

### The service (`src/main/sync/service.ts`)

- **Off by default.** Until someone signs in, it does nothing. `@supabase/supabase-js` is
  a separate chunk loaded only on sign-in, or at launch if this Mac was signed in. Startup is
  unaffected: sync starts after the first screen is ready.
- **Sign-in** is an emailed six-digit code typed into Settings, or Sign in with Apple. The
  session is kept in SQLite, encrypted with the macOS Keychain (`safeStorage`), and
  refreshed automatically.
- **Sign in with Apple** opens Apple's page in the browser. Apple returns to the sync
  server, which sends the browser on to a one-shot server on a loopback port
  (`src/main/sync/browserReturn.ts`) with a one-time code. The code is exchanged with a
  PKCE verifier that never leaves the Mac, so another app that sees it can't use it. The
  server answers one path, once, and closes when the code arrives, on Cancel, or after 10
  minutes. The browser tab then says Cue is finishing (only Cue says whether it worked),
  and Cue comes to the front. Cancel holds until sync is on: one that lands while the
  server is still exchanging the code drops the session it made. A
  loopback address works in development and needs nothing registered with macOS, unlike
  a `cue://` link, which a development build and an installed Cue would both claim.
- **One account, either way.** An Apple ID that shares its verified email with an
  account made from emailed codes signs in to that account. "Hide My Email" makes a new
  account with a private relay address.
- **Turning sync on** for the first time uploads everything already on the Mac. Turning it off
  keeps every note locally. Turning it back on with the same account sends only what changed
  meanwhile. Switching to a different account uploads everything to it.
- **Network.** Uploads, downloads and sign-in use Electron's `net.fetch`, so they follow the
  Mac's proxy and certificate settings. The realtime hint socket uses Node's WebSocket, which
  doesn't; when it can't connect, Cue checks for changes every 30 seconds. A connection the
  server resets can't freeze the app: `src/main/guard.ts`, imported first, keeps Node's
  network stack from throwing where nothing can catch it.
- **Signed out by the server.** A token outlives a deleted account, so the first sign is a
  refused push (the row's account no longer exists). On a `SessionError` the service asks the
  auth server, at most every 30 s, whether the session still stands (`checkSession`, which
  tries one token refresh first). Only a clear answer signs out; network trouble and server
  errors never do. Then sync stops, every note stays, and the state says so: `needsSignIn`,
  and "Your sync session ended. Sign in again to keep syncing." (with `previousEmail`, to
  sign in again) or "Your account was deleted on another device. Notes on this Mac stay
  here." That survives a restart until someone signs in again or turns sync off. Signing
  back in to the same account sends only what changed.
- **A Mac that only reads** never has a push refused, and pulls succeed for a deleted
  account (there's just nothing new). So on launch, and when the Mac wakes or Cue comes to
  the front after a minute away, the service also runs `checkSession`, at most every 30
  minutes. This names a deleted account only while the Mac's access token is still good
  (about an hour after it was last refreshed). After that, the refresh fails first and the
  Mac says the session ended.

### UI

The words are shared by the Mac and iPhone (`src/shared/sync/status.ts`): `indicator` for the
title bar or header, `statusLine` for Settings, `syncedAgo` for the time.

- **Settings → Sync** (a pane in the Mac's rail, a screen on the iPhone): off, then
  **Continue with Apple** or your email, then (for email) the code, then on. The email
  step checks the address before asking for a code
  (`isEmailAddress`, the iPhone's check and words) and has **Cancel**; the code step has
  **Send a New Code** and **Use a Different Email**. While Apple's page is open, it says
  "Finish signing in with Apple in your browser." with **Cancel**; cancelling there or on
  Apple's page goes back without an error. When on,
  it shows the account and the status line ("Synced just now", refreshed every 15 s; a
  pending-change count while offline or paused), **Sync Now**, **Turn Off Sync** and
  **Delete Account…**. If the server ended the session, it says why and offers **Sign In
  Again…**, which goes straight to the code for the same account (or to Apple's page, if
  it signed in with Apple), or **Not Now**, which
  dismisses it. A deleted account offers **Turn On Sync…** with any email instead. Builds
  without a sync server have no Sync category at all.
- **Title bar**: nothing while sync is healthy, or for anyone who never turned it on. A quiet
  "Offline", "Sync paused" or "Sign in to sync" when it needs a word, which opens
  Settings → Sync when clicked, where the reason and the way out are. A long sync, such as
  the first upload, fades in "Syncing…" after 1.2 s; quick ones never show.
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
2. **Auth → Providers → Email**: enable it, and allow new users to sign up. Set the email
   OTP length to 6 (the iPhone's code field takes six digits) and its expiry to 900 s.
3. **Auth → Email Templates**: paste `supabase/templates/sign-in-code.html` into both "Magic
   Link" and "Confirm signup", with the subject "Your Cue sign-in code". `supabase/config.toml`
   sets them only for the local stack, and `db push` doesn't send them, so paste the file
   again whenever it changes. Set up custom SMTP so the emails come from your domain.
4. **Sign in with Apple** (optional). In the Apple Developer portal:
   - The app's identifier (`app.cue`, or your `CUE_IOS_BUNDLE_ID`) needs the Sign in with
     Apple capability. That's all the iPhone needs: it signs in natively and the server
     checks Apple's identity token against the bundle ID.
   - For the Mac, create a **Services ID** (for example `app.cue.signin`), turn on Sign in
     with Apple for it with `app.cue` as the primary App ID, and add the domain
     `<project>.supabase.co` and the return URL `https://<project>.supabase.co/auth/v1/callback`.
   - Create a **Sign in with Apple key** and download its `.p8`. Turn it into a client
     secret with Supabase's generator (in the Apple provider docs). Apple caps the secret
     at six months, so set a reminder to make a new one; when it lapses, only the Mac's
     Apple sign-in stops working.

   Then in Supabase, **Auth → Providers → Apple**: enable it, set **Client IDs** to the
   Services ID first, then the bundle ID (`app.cue.signin,app.cue`), and paste the secret.
   Under **Auth → URL Configuration → Redirect URLs**, add
   `http://127.0.0.1:*/auth/callback`, where the Mac's browser comes back. If people may
   choose "Hide My Email", register your SMTP sending address under Sign in with Apple for
   Email Communication, or emailed codes to a relay address never arrive. Without the
   Apple provider, the iPhone and Mac say "This sync server doesn’t offer Sign in with
   Apple. Use your email instead."
5. Build Cue with the project URL and publishable (or anon) key. Put them in
   `.env.production.local`, at the repo root for the Mac and in `mobile/` for the iPhone:

   ```sh
   CUE_SUPABASE_URL=https://<project>.supabase.co
   CUE_SUPABASE_KEY=sb_publishable_…
   ```

   Production builds (`pnpm dist`, an Xcode Release build) read `.env.production.local`.
   Development (`pnpm dev`, `pnpm start` in `mobile/`, a Debug build) reads
   `.env.development.local`, so it uses the local stack below. Tests build with
   `--mode test` and read neither. Keep these variables out of a plain `.env.local`: every
   mode reads it, and Expo ranks it above `.env.production`. The variables can also come from
   the environment, which wins over any file.

   The key is public by design; row-level security protects the data. The files stay
   untracked (`.env*.local`) so a build from someone else's clone doesn't use your project.
   A build without these doesn't offer sync.

## Development and testing

Run a local stack in Docker. Sign-in emails land in Mailpit at http://127.0.0.1:54324.

```sh
npx supabase start -x studio,storage-api,imgproxy,logflare,vector,postgres-meta,supavisor
npx supabase status    # API URL and publishable key
printf 'CUE_SUPABASE_URL=http://127.0.0.1:54321\nCUE_SUPABASE_KEY=<publishable key>\n' > .env.development.local
pnpm dev               # sync is now offered in Settings
# The sync tests read the server from the environment, not from a file:
CUE_SUPABASE_URL=http://127.0.0.1:54321 CUE_SUPABASE_KEY=<publishable key> pnpm test:sync
npx supabase stop
```

- **`pnpm test`** covers the engine without a server: scheduling, echo suppression, backoff,
  server reset, stopping with a request hung, the first download's recent days, the service
  lifecycle, signing out when the server ends the session, request timeouts, the error
  wording, the editor's in-progress rule, and a randomized three-device convergence test.
  That test replays 400 random offline edits, moves, deletes and reconnects, then checks that
  every replica ends with exactly the newest write of every item.
- **`tests/integration`** runs the real protocol against Supabase. It covers sign-in by
  emailed code, starting Sign in with Apple with a PKCE challenge, refusing an Apple token
  it can't verify, realtime delivery (about 30 ms after the typing pause, locally), no echo
  downloads, account isolation under RLS, LWW and skipping malformed records, reading a
  range of days, a gap-free feed under concurrent pushes, 5,000 items (up ~0.2 s, down
  ~0.1 s locally), session restore, account deletion, and a device noticing its account was
  deleted on another.
- **`tests/e2e/sync.spec.ts`** drives two real Cue apps. It checks that sync is off by
  default, that typing is undisturbed while the other Mac edits the same day, turning sync
  off, a quick quit still uploading, catching up on launch, that a network resetting
  every connection leaves Cue responsive and Offline, the email check, Sign in with Apple
  waiting for the browser and cancelling there or in Cue, and signing in again (or not)
  after the server ends the session. The local stack can't finish a Mac Apple sign-in
  (Apple only returns to HTTPS), so a full one needs a hosted project.

## Mobile

The iPhone app ([mobile/](../mobile)) runs this exact code: the repository, outbox and HLC
(`src/shared/repository.ts`, `src/shared/hlc.ts`), the engine and the Supabase transport
(`src/shared/sync/`). Its database is expo-sqlite with the same schema and migrations
(`src/shared/sqlite.ts`). Only the lifecycle differs:

- **Sync is optional, as on the Mac.** It's off by default and the phone works on its own
  database; until someone turns sync on, the Supabase client isn't created
  (`MobileSync.connect`) and nothing touches the network. Turning it on with an account
  this database hasn't synced with queues every item for upload (`Repository.queueAll`),
  as on the Mac. Turn Off Sync stops the engine and forgets the account, and keeps every
  note and anything still unsent, which goes up the next time sync is on.
- **Sign in with Apple is native**: the system sheet, then `signInWithIdToken` with a
  nonce (Apple gets only its SHA-256, so a token can't be replayed). The local stack
  accepts tokens for `app.cue` (`supabase/config.toml`), so a simulator signed in to an
  Apple Account can test it end to end. A build with `CUE_APPLE_SIGN_IN=off` (for a free
  Personal Team, which can't have the capability) offers email codes only.
  If the server ends the session (confirmed the Mac's way, `checkSession`), sync stops at
  once and every note stays. The header says "Sign in to sync", and Settings shows "Your
  sync session ended. Sign in again to keep syncing." with Sign In Again… (or, for an
  account deleted on another device, "Notes on this iPhone stay here." with Turn On
  Sync…), and Not Now. That's kept in meta (`sync_ended`) across relaunches, as on the Mac.
  Like the Mac, the phone also runs `checkSession` on launch and on coming back to the
  foreground, at most every 30 minutes, so a phone that only reads finds out too. As on
  the Mac, it names a deleted account only while its access token is still good; after
  that it says the session ended.
- **Faster pushes.** 450 ms after typing pauses (2 s at most), at once for any other edit,
  as soon as focus leaves a line, and when the app leaves the screen. That last push runs
  inside a short iOS background task (`modules/cue-native`), so it finishes before the app
  is suspended.
- **Pull on return.** Realtime hints don't reach a suspended app, so coming back to the
  foreground pulls immediately, and the realtime channel reconnects on its own.
  The session refresh timer runs only in the foreground (`SupabaseSync.setForeground`).
- **The session lives in the Keychain**, readable only on this device, after first unlock.
  A launch with sync off clears any session left there, such as one from a previous install.
- **The first download** of a large account runs in the background while today's page
  shows. Today ± 7 days arrive first (`SyncStatus.recent`), then the rest. Five years of
  notes (36,994 items) took about 4 s against the local server in a development build.
  Until it's done (`SyncStatus.downloading`), an empty day whose notes haven't arrived says
  "Getting your notes…" and can't be written in, and the header shows a quiet dot that
  VoiceOver reads the same way. A download interrupted by closing the app picks up where it
  left off at the next launch (meta `sync_joining`).
- **The same words.** The header and Settings use `indicator` and `statusLine`, so the phone
  says what the Mac says, down to "Syncing…" fading in only after 1.2 s.

The end-to-end flows in `mobile/e2e` test sync against the local stack. One has another
device sign in to the same account over HTTP and call `sync_push`, then checks that the
phone shows the line within 3 s without a refresh. Another (`account-deleted`) has it
delete the account: the phone stops syncing with the reason at its next push and keeps
the unsent line, and, for a phone that only reads, notices on coming back to the
foreground.
