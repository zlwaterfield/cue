# Cue for iPhone

The iPhone app: today's page in your pocket, kept in sync with Cue on the Mac.

It's built on the same core as the Mac app. The data model, the SQLite schema and
repository, the hybrid logical clock, the sync engine and Supabase transport, the outline,
dates, Markdown, and every editing operation (Return, Backspace, indent, move, drag and
drop, undo) are the files in [`../src/shared`](../src/shared). There's one implementation
of how a line behaves and how a change merges, and the Mac's unit tests cover it. This
folder holds what's specific to a phone: touch, the keyboard, and the app lifecycle.

> [!NOTE]
> Like the Mac app, this is early alpha.

## How it differs from the Mac

- **Sync is required.** The Mac works without an account; the phone signs in first, with
  the same email and six-digit code. The phone holds a local copy of the account in SQLite,
  so it opens instantly and works offline. Signing out removes that copy (after checking
  nothing is left unsent); the account keeps everything. Right after signing in, today
  and the week around it download first; an empty day whose notes haven't arrived yet says
  "Getting your notes…" and can't be written in until they do, and an empty today then
  gets the caret. If the app is closed mid-download, the next launch carries on and those
  days keep waiting.
- **Sync is quicker to send.** iOS suspends apps soon after they leave the screen, so the
  phone pushes 450 ms after typing pauses (2 s at most during continuous typing), the
  moment a line is finished (focus leaves it), and when the app goes to the background
  (holding a short background task until the upload finishes). It pulls the moment it
  comes back. A change from another device arrives as a realtime hint and is applied about
  15 ms after the other device's push lands (measured against the local server).
- **One day at a time**, with a week strip above it. Swipe the page (anywhere but on a
  line) for the next or previous day, tap a day to open it, swipe the strip for other weeks
  (opening on their first day, or on today in this week), or tap the month for a calendar
  that also understands "fri", "oct 31", "in 3 days".

## Touch

| | |
| --- | --- |
| Tap a line | Edit it, with the caret where your finger landed |
| Tap a link line | Open the page (in its app: a post in X, a video in YouTube). Tap the space beside it to edit the link |
| Tap a bullet | Make it a to-do |
| Tap a box | Complete or reopen (the whole marker column takes the tap, the margin beside it too) |
| Swipe right | Text or bullet → to-do → done (and back) |
| Swipe left | Move to tomorrow (Undo in the toast); keep going to delete |
| Swipe the page, off the lines | Left for the next day, right for the previous one |
| Long-press, then drag | Reorder, taking children along. Drag sideways to nest or un-nest, one level at a time, within what the outline allows. A finger already moving sideways is a swipe, not a lift |
| Toolbar floating above the keyboard | ☐ to-do and • bullet (tap the lit one for plain text), outdent, indent, undo, move to another day, hide the keyboard |
| Type `- ` / `[] ` / `[x] ` | Bullet, to-do, done to-do, as on the Mac |
| Return / Backspace | The Mac's rules: Return continues the list; on an empty item it steps out, then drops the marker. Backspace at the start drops the marker, then the indent, then joins the line above |

Every swipe and marker action is also in VoiceOver's actions rotor on each line, and
VoiceOver reads lines in the day's order.

## Links and the share sheet

- **A line that is only a link shows its page** while it isn't being edited: the site's
  icon, the page's title and where it's from, in the line's own type, never more than two
  lines. A post on X shows its text, its author's handle and their picture. The preview
  comes from the page's own header (Open Graph and `<title>`, fetched the way iMessage
  fetches previews), parsed by `../src/shared/links.ts`; no third-party service sees the
  link. Previews are cached on the phone (`links.sqlite`), never synced, and removed on
  sign-out. Until a page answers, or if it can't, the line shows the link's address.
- **Cue is in the share sheet.** Share a link (or text) from Safari, X, YouTube or any
  app, and it's added to the end of today as a new line. The extension
  (`plugins/share-extension`) only confirms: "Added to Today", then it's gone. It can't
  reach the notes or the sync server, so it leaves the share in the app group's inbox,
  and Cue adds it the next time it comes to the screen; the new line glows, and syncs
  like any other. A link shared while Cue is closed reaches the Mac once Cue is opened
  on the phone. Shared text keeps its lines and list markers, as a paste does.

## How the editor works

- **One `TextInput` per line**, like the Mac's one editable per line, with the shared item
  store as the source of truth. A keystroke re-renders one row.
- **Lines are absolutely positioned** by a small layout model (`src/editor/layout.ts`),
  and their views stay in the order they were created. Reordering a line, whether by drag,
  move, or another device, never removes a text view from the window. Removing one would
  end editing and drop the keyboard. Moves animate as a side effect.
- **Lines only do work when they move.** Each line watches the layout, the drag and the
  swipe on the UI thread and animates only when its own target changes, so a wrap, a
  Return or a drag frame touches the lines that actually move. A line new to the page
  (Return, a paste, another device) shows once it's placed there, in the same frame as the
  lines it pushes down, so it never covers the line below. Markers are plain views at rest;
  a change pops in once with a layout animation.
- **Heights come from the text views.** React Native measures a text input with the text
  it had before an edit that wasn't typed into it (Return mid-paragraph, Undo, an edit from
  another device), so after such an edit the input is laid out once more, in the same
  frame, and measures the new text.
- **Touches.** A line that isn't being edited takes touches as a whole
  (`pointerEvents="box-only"`), so long press and swipes are free. A tap is passed to a small
  native module (`modules/cue-native`) that focuses the line with the caret at the touched
  character. The line being edited takes its own touches, so the loupe and selection work
  as usual, and can still be lifted by its marker.
- **Drag runs on the UI thread** (Reanimated worklets; the geometry is in
  `../src/shared/editor/geometry.ts`). JavaScript is involved only when the line is dropped,
  and the drop is the Mac's `dropAt`.
- **The blank last line already has an id.** Typing into it turns it into that item, so the
  same view keeps the keyboard and nothing is lost to a focus change mid-word.

## Development

You'll need Xcode 26 with an iOS 26 simulator, Node 24 and pnpm. You'll also need a sync
server: the local Supabase stack from [docs/SYNC.md](../docs/SYNC.md) works.

```sh
cd mobile
pnpm install
npx supabase status    # from the repo root: API URL and publishable key
printf 'CUE_SUPABASE_URL=http://127.0.0.1:54321\nCUE_SUPABASE_KEY=<publishable key>\n' > .env.development.local
pnpm ios               # builds the development app and installs it on a simulator
pnpm start             # Metro, for later runs
```

Sign-in codes from the local stack land in Mailpit at http://127.0.0.1:54324.

### On your iPhone

A free Apple ID is enough to run Cue on your own phone. A paid Apple Developer account is
needed for TestFlight and the App Store, and it makes the install last a year instead of
7 days.

1. In Xcode, open Settings → Accounts and add your Apple ID. A free one appears as a
   "Personal Team".
2. On the iPhone, turn on Settings → Privacy & Security → Developer Mode, then connect it
   to the Mac.
3. Put your hosted Supabase project in `.env.production.local`. That's the project your
   Mac's production build uses too, so they share notes. Release builds read this file and
   Debug builds read `.env.development.local` (docs/SYNC.md). A Debug build on the phone
   can't reach `127.0.0.1`, so for the local stack use your Mac's network address
   (`http://192.168.x.x:54321`).
4. Add your team ID to `.env.local` as `CUE_APPLE_TEAM_ID=…`. Both kinds of build read it. You'll find it in Xcode under
   Signing & Capabilities, or under Membership on developer.apple.com. If Xcode says
   `app.cue` isn't available, also set `CUE_IOS_BUNDLE_ID=` to an identifier of your own.
   The share extension adds a second identifier (`<bundle ID>.share`) and the App Group
   `group.<bundle ID>`, which Xcode registers on the first build with
   `-allowProvisioningUpdates`. If your team's profile can't include App Groups, set
   `CUE_SHARE_EXTENSION=off` there too and regenerate the project
   (`npx expo prebuild --platform ios --clean`); Cue then builds without the share sheet.
5. Run `npx expo run:ios --device --configuration Release` and pick the phone. Release
   builds carry their own JavaScript, so the app works away from the Mac.

The first time, iOS asks you to trust the developer under Settings → General → VPN &
Device Management.

`app.config.ts` reads `CUE_SUPABASE_URL` and `CUE_SUPABASE_KEY` when Metro or a build
starts, from `.env.development.local` for Metro and Debug builds and from
`.env.production.local` for Release builds. Keep them out of `.env.local`, which Expo ranks
above `.env.production`. A build without them shows the sign-in screen with "This build of Cue has no sync
server."

Checks:

```sh
pnpm typecheck                  # this app (the shared code is type-checked from here too)
cd .. && pnpm test              # shared core, including the drag geometry
```

### End-to-end tests

[`e2e/`](e2e) holds [Maestro](https://maestro.mobile.dev) flows that drive the real app on a
simulator, against the local sync server:

- **writing**: the caret waiting in a new account's empty today, Return, Markdown
  shortcuts, toolbar types and indent, Backspace, undo
- **touch**: marker taps, swipes, the undo toast, drag to reorder and to nest, and
  swiping the page to the next and previous day
- **search**: the prompt before typing, results as you type, "No matches", and opening a
  result
- **sync**: a line from the phone reaches the account, and a line pushed by another device
  appears on the phone within 3 s with no refresh
- **account**: sign out removes the phone's copy; signing back in brings it back
- **account-switch**: after signing in to a different account, Undo can't bring back the
  first account's lines, on the phone or on the server
- **account-deleted**: the account is deleted on another device. A phone that writes signs
  out with the reason at its next push and warns before a sign-in that would remove an unsent
  line. A phone that only reads notices on coming back to the foreground.

Each flow starts from a clean install and a new account.

```sh
# Maestro needs Java 17+, e.g. brew install openjdk@21
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
maestro test -e METRO=http://127.0.0.1:8081 -e SUPABASE_KEY=<publishable key> e2e
```

Leave out `METRO` to test a release build, which runs its own bundle. After
`expo run:ios --configuration Release`, dismiss the "Open in Cue?" alert first. The CLI
opens a development-client link that a release build doesn't handle, and the alert sits
in front of the app.

## Layout

```
src/app/        screens (Expo Router): day, sign-in, settings, search, move, calendar
src/core/       database adapter (expo-sqlite), sync lifecycle, app state, link previews, share inbox
src/editor/     the day page: layout, rows, drag, swipe, toolbar, editing controller
src/ui/         header and week strip, calendar, toast, theme (brand tokens)
modules/        cue-native: caret-at-touch, background time, the share inbox (Swift)
plugins/        share-extension: Cue in the share sheet (config plugin and Swift)
e2e/            Maestro flows
```
