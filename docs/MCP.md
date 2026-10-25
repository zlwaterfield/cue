# MCP

Cue's MCP server lets an assistant you already use, such as Claude or ChatGPT, read your
days and to-dos, add lines, check things off and move them to other days. It runs on the
sync server, so it works for accounts with sync on, and its edits reach your Mac and iPhone
the way another device's would, usually within a second.

```
 assistant ──POST JSON-RPC──▶ www.usecue.today/mcp ──proxy──▶ Edge Function `mcp` ──REST, as you──▶ items (RLS)
     │        Bearer token                                    core/mcp           sync_push ──▶ Realtime ──▶ Mac, iPhone
     └──OAuth──▶ Supabase Auth ──▶ www.usecue.today/oauth/consent (sign in, Allow)
```

## Decision

**One Supabase Edge Function, acting as just another sync client, with Supabase Auth as the
OAuth server.** There's no new table, service key or server to run.

- **Reads** use your own access token against the `items` table, so row-level security
  decides what's visible, exactly as it does for the apps. A day is read in full, page by
  page, because edits place lines among all of its lines.
- **Writes** run the editor's own operations (`core/editor/ops.ts`: `insertLinesAfter`,
  `moveToDate`) over the days involved, then upload the changes with `sync_push`. A line an
  assistant adds or moves lands exactly where it would if you typed it, and the push's
  realtime hint makes every signed-in device pull it.
- **Versions.** The function is its own "device", with its own hybrid logical clock. Before
  stamping an edit it observes the stored version, so its edit always counts as newer, even
  when some device's clock runs ahead (`sync_push` ignores anything that isn't newer).
- **Markdown** is the format, as for copy, paste and export (`core/markdown.ts`),
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

1. In the assistant, add a custom connector with the URL `https://www.usecue.today/mcp`.
   The connected-apps page shows it with a Copy button, and so does **Settings → Assistants**
   on the Mac and the iPhone (`core/assistants.ts`), which until sync is on says to turn it on
   first. A build on another sync server (the local stack, a project of your own) shows that
   server's function URL instead, and no link to the consent page. The site proxies it to the function
   (`site/vercel.json`), so the assistant only ever sees Cue's domain for the server itself.
   Use `www`: the bare domain redirects there, and not every client follows a redirect on a
   POST.
2. The assistant's first request gets a `401` whose `WWW-Authenticate` header points to
   this server's protected-resource metadata. That names Supabase Auth
   (`https://<project>.supabase.co/auth/v1`) as the authorization server.
3. The assistant registers itself (dynamic client registration) and opens Supabase's
   authorize URL. Supabase sends the browser to
   `www.usecue.today/oauth/consent?authorization_id=…` (`site/oauth/consent/`).
4. The page signs you in with an emailed six-digit code, as the apps do, and asks: "Connect
   Claude to Cue?" **Allow** sends you back to the assistant with a code. The assistant
   trades it for tokens and refreshes them as needed.

The same page, opened without a request (`www.usecue.today/oauth/consent`), lists the connected
assistants with **Disconnect**. Disconnecting ends the assistant's sessions and refresh
token. Its current access token keeps working until it expires, at most an hour
(`jwt_expiry`). Signing out on that page signs out only that browser.

**Tokens.** The function turns away a missing, expired or non-user token with a `401` before
doing anything. The token's signature is checked by the database on every read and write, so
a forged token never reads or writes anything (it also gets a `401`). An OAuth token is an
ordinary Supabase session token with a `client_id` claim, so row-level security applies to
it unchanged.

**Nothing deletes, at the database too.** An assistant holds its token and could call the
database or Supabase Auth without this server, so the consent page's "It can't delete
anything" is enforced there (`supabase/migrations/20261021000000_assistant_limits.sql`):

- A token with a `client_id` (kept when it's refreshed) can't run `sync_delete_account`, and
  `sync_push` refuses its records if any is deleted, reading `deleted` the way the upsert
  does (`"t"` and `"yes"` count too).
- No account can be given a password. Cue signs in only with emailed codes and Apple, and
  a password set through Supabase Auth would sign in without the assistant's claim.
- Changing the email address needs confirming from the current address too (Supabase's
  secure email change, on by default; keep it on).

The apps' own sessions have no `client_id` and are unaffected. An assistant can still sign
every device out (`/auth/v1/logout?scope=global`); the apps keep every note when that
happens, and signing in again picks up where they left off.

## Setting up a server

On a project already set up for sync ([SYNC.md](SYNC.md#setting-up-a-server)):

1. **Apply the migrations** (`npx supabase db push`), which add the limits above. Check that
   **Auth → Providers → Email → Secure email change** is on.
2. **Deploy the function:** set the URL assistants connect to, then deploy:

   ```sh
   npx supabase secrets set CUE_MCP_URL=https://www.usecue.today/mcp
   npx supabase functions deploy mcp --no-verify-jwt
   ```

   The function names `CUE_MCP_URL` as the resource in its discovery document, and clients
   check that it matches the URL they connected to. Without it, the function names its own
   Supabase URL, which is what the local stack uses. The function
   checks tokens itself, so it can send the `401` that starts sign-in. It imports
   `core` directly; `supabase/functions/mcp/deno.json` maps the extensionless imports
   Deno needs spelled out. If a new shared import fails with "Module not found", add it
   there.
3. **Auth → OAuth Server:** turn it on, set the authorization path to `/oauth/consent`, and
   allow dynamic client registration.
4. **Auth → URL Configuration:** set the Site URL to `https://www.usecue.today`, where the
   consent page lives. It must be the `www` host the page is served from: with the bare
   domain, Supabase refuses the page's calls and it says the link has expired. Keep the redirect URLs the apps use in the allow list.
5. **Deploy the site** (`site/`) so that `/oauth/consent` serves `site/oauth/consent/index.html`
   and `/mcp` proxies to the function. `site/vercel.json` holds the proxy, with the project
   URL written into it; on another host, rewrite `/mcp` and `/mcp/*` to
   `https://<project>.supabase.co/functions/v1/mcp` the same way.
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

- **`apps/desktop/tests/unit/mcp.test.ts`** covers the protocol and every tool over an in-memory server:
  the Markdown with ids, nesting, adding after a line, checking off, rewriting, moving with
  children, beating a device whose clock runs ahead, sending nothing when nothing changes, and
  reading a day longer than one page.
- **`apps/desktop/tests/integration/mcp.test.ts`** runs the whole thing against the local stack: the `401`
  and the discovery documents, dynamic registration, consent, the token exchange with PKCE,
  then an added to-do reaching a signed-in Mac and being checked off. It also covers the
  assistant's token failing to delete the account or a line when calling the database
  directly, to set a password or change the email, keeping its claim when refreshed,
  another account's line being invisible, forged and expired tokens, and disconnecting
  from the site. It runs with `pnpm test:sync`.

**Known limits**

- Locally, Kong doesn't route the RFC 8414 path
  `/.well-known/oauth-authorization-server/auth/v1`. Clients fall back to
  `/auth/v1/.well-known/openid-configuration`, which works. The hosted project serves both.
- Sync is per item, so if you're typing in a line on the Mac while an assistant checks it off,
  your edit wins and the check-off is lost. Per-field merging (SYNC.md) would fix this.
- The consent page signs in by email code only. An account made with Sign in with Apple
  that hides its email can still get the code through Apple's relay, if the relay accepts
  mail from the sending domain.
