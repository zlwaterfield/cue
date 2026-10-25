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

Once the site has a domain, make `og:image` in `index.html` an absolute URL so link previews
pick it up.

## Terms and Privacy

`terms/` and `privacy/` share `legal.css`. Every sign-in (the Mac, the iPhone, and
`oauth/consent`) says that continuing agrees to both, and records it in
`public.terms_acceptances`. When either page changes in substance, change its "Last updated"
date, `TERMS_VERSION` in `src/shared/terms.ts`, and the version in `oauth/consent/index.html`
to match; each account's next sign-in records the new version.
