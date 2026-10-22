# MCP

Cue's MCP server lets an assistant you already use, such as Claude or ChatGPT, read your
days and to-dos, add lines, check things off and move them to other days. It runs on the
sync server, so it works for accounts with sync on, and its edits reach your Mac and iPhone
the way another device's would, usually within a second.

```
 assistant ──POST JSON-RPC──▶ Edge Function `mcp` ──REST, as you──▶ items (RLS)
     │        Bearer token        src/shared/mcp           sync_push ──▶ Realtime ──▶ Mac, iPhone
     └──OAuth──▶ Supabase Auth ──▶ usecue.today/oauth/consent (sign in, Allow)
```

## Decision

**One Supabase Edge Function, acting as just another sync client, with Supabase Auth as the
OAuth server.** There's no new database schema, service key or server to run.

- **Reads** use your own access token against the `items` table, so row-level security
  decides what's visible, exactly as it does for the apps.
- **Writes** run the editor's own operations (`src/shared/editor/ops.ts`: `insertLinesAfter`,
  `moveToDate`) over the days involved, then upload the changes with `sync_push`. A line an
  assistant adds or moves lands exactly where it would if you typed it, and the push's
  realtime hint makes every signed-in device pull it.
- **Versions.** The function is its own "device", with its own hybrid logical clock. Before
  stamping an edit it observes the stored version, so its edit always counts as newer, even
  when some device's clock runs ahead (`sync_push` ignores anything that isn't newer).
- **Markdown** is the format, as for copy, paste and export (`src/shared/markdown.ts`),
  with each line's id after it: `- [ ] Call the dentist {#0199e3a4-…}`.
- **The protocol** is MCP's stateless, JSON-only subset: POST a JSON-RPC message, get a JSON
  answer. There are no sessions and no event stream, which a tool server doesn't need, so
  there's no SDK either. It's tested against the official TypeScript SDK client.

## Tools

| Tool | What it does |
| --- | --- |
| `get_day(date)` | One day's page, in order, nested, with ids |
| `find_todos(from, to?, include_done?)` | To-dos across up to a year of days, open ones unless asked |
| `search(query, limit?)` | Lines containing every word, newest days first |
| `add_lines(date, markdown, after_id?)` | Adds Markdown lines at the end of a day, or after a line |
| `update_lines(ids, done?, type?, text?, date?)` | Checks off or reopens, changes type, rewrites one line's text, or moves lines (with what's nested under them) to the end of another day |

Nothing deletes. Dates are the user's calendar dates. The server can't know the user's time
zone, so its instructions tell the assistant to work out "today" in the user's time zone.
Mistakes (a bad date, an unknown id) come back as the tool's result, so the assistant can
correct itself.

## Connecting

1. In the assistant, add a custom connector with the URL
   `https://<project>.supabase.co/functions/v1/mcp`. The connected-apps page shows it with
   a Copy button.
2. The assistant's first request gets a `401` whose `WWW-Authenticate` header points to
   this server's protected-resource metadata. That names Supabase Auth
   (`https://<project>.supabase.co/auth/v1`) as the authorization server.
3. The assistant registers itself (dynamic client registration) and opens Supabase's
   authorize URL. Supabase sends the browser to
   `usecue.today/oauth/consent?authorization_id=…` (`site/oauth/consent/`).
4. The page signs you in with an emailed six-digit code, as the apps do, and asks: "Connect
   Claude to Cue?" **Allow** sends you back to the assistant with a code. The assistant
   trades it for tokens and refreshes them as needed.

The same page, opened without a request (`usecue.today/oauth/consent`), lists the connected
assistants with **Disconnect**. Disconnecting ends the assistant's sessions and refresh
token. Its current access token keeps working until it expires, at most an hour
(`jwt_expiry`). Signing out on that page signs out only that browser.

**Tokens.** The function turns away a missing, expired or non-user token with a `401` before
doing anything. The token's signature is checked by the database on every read and write, so
a forged token never reads or writes anything (it also gets a `401`). An OAuth token is an
ordinary Supabase session token with a `client_id` claim, so row-level security applies to
it unchanged.

## Setting up a server

On a project already set up for sync ([SYNC.md](SYNC.md#setting-up-a-server)):

1. **Deploy the function:** `npx supabase functions deploy mcp --no-verify-jwt`. The function
   checks tokens itself, so it can send the `401` that starts sign-in. It imports
   `src/shared` directly; `supabase/functions/mcp/deno.json` maps the extensionless imports
   Deno needs spelled out. If a new shared import fails with "Module not found", add it
   there.
2. **Auth → OAuth Server:** turn it on, set the authorization path to `/oauth/consent`, and
   allow dynamic client registration.
3. **Auth → URL Configuration:** set the Site URL to `https://usecue.today`, where the
   consent page lives. Keep the redirect URLs the apps use in the allow list.
4. **Deploy the site** (`site/`) so that `/oauth/consent` serves `site/oauth/consent/index.html`.
   The page embeds the project URL and publishable key, which are public by design. When
   served from `localhost` or `127.0.0.1` it uses the local stack instead.

Sign-ins through the consent page count toward monthly active users, like any sign-in. The
OAuth server is in beta at Supabase.

## Development and testing

The local stack in [SYNC.md](SYNC.md#development-and-testing) serves the function and the
OAuth server (`supabase/config.toml`). To try the consent page, serve the site on the
port the local Site URL expects:

```sh
python3 -m http.server 4173 -d site
```

- **`tests/unit/mcp.test.ts`** covers the protocol and every tool over an in-memory server:
  the Markdown with ids, nesting, adding after a line, checking off, rewriting, moving with
  children, beating a device whose clock runs ahead, and sending nothing when nothing changes.
- **`tests/integration/mcp.test.ts`** runs the whole thing against the local stack: the `401`
  and the discovery documents, dynamic registration, consent, the token exchange with PKCE,
  then an added to-do reaching a signed-in Mac and being checked off. It also covers another
  account's line being invisible, forged and expired tokens, and disconnecting from the
  site. It runs with `pnpm test:sync`.

**Known limits**

- Locally, Kong doesn't route the RFC 8414 path
  `/.well-known/oauth-authorization-server/auth/v1`. Clients fall back to
  `/auth/v1/.well-known/openid-configuration`, which works. The hosted project serves both.
- Sync is per item, so if you're typing in a line on the Mac while an assistant checks it off,
  your edit wins and the check-off is lost. Per-field merging (SYNC.md) would fix this.
- The consent page signs in by email code only. An account made with Sign in with Apple
  that hides its email can still get the code through Apple's relay, if the relay accepts
  mail from the sending domain.
