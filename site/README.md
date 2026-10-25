# cue site

The website for Cue: the home page (`index.html`) and the downloads page (`download/`). It's
plain static HTML with no build step: open `index.html`, or serve this folder from any static
host (for example, set Vercel's or Netlify's root directory to `site/`, or publish it with
GitHub Pages).

Everything comes from the brand kit in [`docs/brand`](../docs/brand): the color tokens, the
outlined wordmark, the favicons and `site.webmanifest` (`docs/brand/web`), and the social image
(`docs/brand/social`). Newsreader, for headlines only, is served from `fonts/` (its Latin subset,
SIL OFL), so the site makes no requests to anyone else; body text uses the system font. The screenshots are `docs/images/week-*.png` as WebP:

```sh
cwebp -q 86 docs/images/week-light.png -o site/images/week-light.webp
cwebp -q 86 docs/images/week-dark.png -o site/images/week-dark.webp
```

## Being found, by people and by assistants

Every page has a canonical URL, Open Graph tags with an absolute `og:image`, and JSON-LD in
its head: `SoftwareApplication` and `FAQPage` on the home page, `SoftwareApplication` and
`MobileApplication` on the downloads page, `WebPage` on Terms and Privacy. The home page's
`FAQPage` repeats the answers in its **Questions** section word for word, which is the rule
for that markup, so edit the two together.

Four files at the root are for crawlers and assistants:

| File | What it's for |
| --- | --- |
| `robots.txt` | Allows everything, grants all three [content signals](https://contentsignals.org) (`search`, `ai-input`, `ai-train`), keeps `/oauth/` out of indexes, and points at the sitemap |
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

`terms/` and `privacy/` share `legal.css`. Every sign-in (the Mac, the iPhone, and
`oauth/consent`) says that continuing agrees to both, and records it in
`public.terms_acceptances`. When either page changes in substance, change its "Last updated"
date, `TERMS_VERSION` in `src/shared/terms.ts`, and the version in `oauth/consent/index.html`
to match; each account's next sign-in records the new version.
