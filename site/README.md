# cue site

The website for Cue: the home page (`index.html`), the downloads page (`download/`), the
assistants page (`assistants/`), `terms/`, `privacy/`, the `404.html` you can type into, and
the OAuth consent page (`oauth/consent/`). It's plain static HTML with no build step: open
`index.html`, or serve this folder from any static host (for example, set Vercel's or
Netlify's root directory to `site/`, or publish it with GitHub Pages). Serve it from the root,
though, rather than opening the files: the shared pieces are linked absolutely.

## What the pages share

Three files, and no framework:

| File | What it's for |
| --- | --- |
| `cue.css` | The brand tokens (light, dark, and the `[data-theme]` override), the base layer, the nav and footer, and the ⌘K palette. Every page links it first and then adds only its own CSS |
| `cue.js` | The behaviour that's the same everywhere: the light/dark choice, a toast, and the palette. Loaded `defer` by every page except the consent page |
| `legal.css` | What Terms and Privacy add on top of `cue.css` |

The home page's own small things live in `home.js`, and the 404's in `404.js`; both load after
`cue.js` and use what it exposes (`cue.toast`, `cue.dates`, `cue.paletteOpen`, and the
`cue:palette-open` / `cue:palette-close` events).

**⌘K** is on every page. `cue.js` builds the dialog, adds the button in the nav (a keycap on a
desktop, the mark on a phone, where there's no ⌘ key), and fills it with the links, every `h2`
on the page, the appearance commands and `move to fri`. The current page is never offered as a
destination. A page adds its own commands with `cue.add({ label, hint, run })` — the home page
adds "Print today's page" that way.

**Light and dark** follow the system until someone chooses in the palette, and then the choice
is remembered in `localStorage` under `cue-theme` and read back by the one-line script in each
page's `<head>`, before the first paint, so there's no flash on the next page. "Match the
system appearance" appears in the palette once there's a choice to undo. Screenshots that come
in two versions, and the `theme-color` metas, follow the choice too.

> [!IMPORTANT]
> The assistants page is at `/assistants`, not `/mcp`, because `/mcp` is the MCP endpoint
> itself: `vercel.json` rewrites it to the Edge Function. Vercel checks the filesystem before
> it applies rewrites, so a page at `site/mcp/index.html` would shadow the endpoint and every
> connected assistant would start getting HTML.

Two links on the downloads page point outside the repo and need a hand now and then: the Mac
button goes to the current GitHub release (releases carry their version in the file name), and
the iPhone button goes to the TestFlight invitation.

Everything comes from the brand kit in [`docs/brand`](../docs/brand): the color tokens, the
outlined wordmark, the favicons and `site.webmanifest` (`docs/brand/web`), and the social image
(`docs/brand/social`). Newsreader, for headlines only, is served from `fonts/` (its Latin subset,
SIL OFL), so the site makes no requests to anyone else; body text uses the system font. The Mac
window on the home page is `docs/images/week-*.png` as WebP:

```sh
cwebp -q 86 docs/images/week-light.png -o site/images/week-light.webp
cwebp -q 86 docs/images/week-dark.png -o site/images/week-dark.webp
```

The iPhone in front of it is `images/phone-*.webp`, holding the same notes and to-dos as the
window behind it, in a frame the page draws in CSS. Both come from `python3 scripts/phone-shots.py`, which
takes the App Store screen [`docs/app-store/screens/08-mac.png`](../docs/app-store/screens/08-mac.png)
and, since that day was only ever captured in light, derives the dark one from it with the
app's own light-to-dark tone curve. That script's docstring has the details, and says what to
delete once there is a real dark screenshot of the day.

## Being found, by people and by assistants

Every page has a canonical URL, Open Graph tags with an absolute `og:image`, and JSON-LD in
its head: `SoftwareApplication` and `FAQPage` on the home page, `SoftwareApplication` and
`MobileApplication` on the downloads page, `WebPage` on Terms and Privacy. The home page's
`FAQPage` repeats the answers in its **Questions** section word for word, which is the rule
for that markup, so edit the two together.

Four files at the root are for crawlers and assistants:

| File | What it's for |
| --- | --- |
| `robots.txt` | Allows everything, grants all three [content signals](https://contentsignals.org) (`search`, `ai-input`, `ai-train`), and points at the sitemap. The consent page stays out of indexes with its own `noindex`, so there is nothing to disallow |
| `sitemap.xml` | The four public pages, with `lastmod` dates to keep current |
| `llms.txt` | Cue in one page, in the [llms.txt](https://llmstxt.org) format: what it is, what it deliberately isn't, and where the pages are |
| `llms-full.txt` | The site's own copy as plain text, plus the questions people ask. It summarises Terms and Privacy and links to them rather than repeating them, so the legal text has one home |

`llms.txt`, `llms-full.txt` and `sitemap.xml` are written by hand, like the rest of the site.
When page copy changes in substance, change them too, and move the sitemap's `lastmod`.

> [!NOTE]
> Cloudflare sits in front of Vercel and serves its own managed `robots.txt` when the origin
> has none, which is what `usecue.today/robots.txt` was until this file existed. With ours in
> place Cloudflare appends its content-signal preamble to it. If the deployed `robots.txt`
> ever disagrees with this file, that's where to look (Cloudflare dashboard → AI Crawl
> Control).

## Terms and Privacy

`terms/` and `privacy/` share `legal.css`, on top of `cue.css`. Every sign-in (the Mac, the iPhone, and
`oauth/consent`) says that continuing agrees to both, and records it in
`public.terms_acceptances`. When either page changes in substance, change its "Last updated"
date, `TERMS_VERSION` in `src/shared/terms.ts`, and the version in `oauth/consent/index.html`
to match; each account's next sign-in records the new version.
