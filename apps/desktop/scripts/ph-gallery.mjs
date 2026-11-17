/**
 * Renders the gallery for the Product Hunt launch into brand/product-hunt/.
 *
 *   pnpm ph-gallery
 *
 * Product Hunt shows gallery images in a landscape frame and recommends 1270 × 760,
 * so these are laid out at that size in CSS pixels and taken at 2x: 2540 × 1520.
 * Every image is the same shape, so none is cropped or letterboxed differently from
 * the next. Like the App Store and X images, each one has a short headline in
 * Newsreader on the brand's graphite palette, with the real app beside it: the Mac
 * screenshots in docs/images and the iPhone screens in brand/app-store/screens.
 *
 * Needs a Chrome to drive (CHROME_CHANNEL picks another). Pass part of a file name
 * to render only that image, such as `pnpm ph-gallery 03`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

// Both belong to the repository, and the working directory is this app's folder.
const REPO = resolve(import.meta.dirname, '../../..')
const OUT = resolve(REPO, 'brand/product-hunt')
const W = 1270
const H = 760
const SCALE = 2

const file = (path) => pathToFileURL(resolve(REPO, path)).href
const MAC = (name) => file(`docs/images/${name}`)
const PHONE = (name) => file(`brand/app-store/screens/${name}`)

// Brand palette, from brand/README.md and brand/tokens.
const LIGHT = { ink: '#1C1C1E', text2: '#6C6C72', top: '#EFEFF1', bottom: '#EAEAEC', bezel: '#1C1C1E' }
const DARK = { ink: '#ECECEF', text2: '#9D9DA4', top: '#232327', bottom: '#141416', bezel: '#2C2C31' }

const lockup = (theme) =>
  readFileSync(resolve(REPO, `brand/logo/cue-lockup-on-${theme === DARK ? 'dark' : 'light'}.svg`), 'utf8')
    .replace('<svg ', '<svg class="lockup" ', 1)

/**
 * A Mac window from docs/images. Those are 1000 × 700 pt windows at 2x, framed
 * by scripts/frame.swift with 48 pt of shadow on each side, so `left` and `top`
 * place the window itself and `s` is CSS pixels per point.
 */
function mac(name, { left, top, s }) {
  return `<img class="mac" src="${MAC(name)}" alt="" style="left:${left - 48 * s}px;top:${top - 48 * s}px;width:${1096 * s}px">`
}

/**
 * An iPhone 17 Pro Max around one of the App Store screens (1320 × 2868, 440 pt
 * wide), drawn as brand/app-store/creative/make.py draws it: a 2.5% bezel, a
 * 62 pt display corner and a 125 × 36 pt Dynamic Island. `width` is the screen's.
 */
function phone(name, { left, top, width, lifted = false }) {
  return `<div class="phone${lifted ? ' lifted' : ''}" style="--sw:${width}px;left:${left}px;top:${top}px">` +
    `<div class="screen"><img src="${PHONE(name)}" alt=""><div class="island"></div></div></div>`
}

function page({ theme, copy, art = [] }) {
  const t = theme
  const centered = copy.align === 'center'
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Newsreader"; font-weight: 400; font-style: normal;
  src: url("${file('site/fonts/newsreader-latin.woff2')}") format("woff2"); }
* { box-sizing: border-box; }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
body { position: relative; background: linear-gradient(180deg, ${t.top}, ${t.bottom});
  -webkit-font-smoothing: antialiased; }
.copy { position: absolute; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center;
  ${centered ? 'left: 0; right: 0; align-items: center; text-align: center;' : `left: 88px; width: ${copy.width ?? 400}px;`} }
.lockup { display: block; height: 40px; width: auto; margin: 0 0 30px; color: ${t.ink};
  align-self: ${centered ? 'center' : 'flex-start'}; }
.eyebrow { margin: 0 0 16px; color: ${t.text2};
  font: 500 20px/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; }
h1 { margin: 0; color: ${t.ink}; font: 400 ${copy.size ?? 60}px/1.04 "Newsreader", Georgia, serif;
  font-variation-settings: "opsz" 72; letter-spacing: -0.02em; }
.sub { margin: 22px 0 0; color: ${t.text2};
  font: 21px/1.45 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; letter-spacing: -0.01em; }
.foot { position: absolute; left: 0; right: 0; bottom: 56px; text-align: center; color: ${t.text2};
  font: 500 19px/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; letter-spacing: -0.005em; }
.mac { position: absolute; display: block; }
.phone { position: absolute; --bz: calc(var(--sw) * 0.025); background: ${t.bezel};
  padding: var(--bz); width: calc(var(--sw) + 2 * var(--bz));
  border-radius: calc(var(--sw) * ${62 / 440 + 0.025}); }
.phone.lifted { box-shadow: 0 24px 60px rgba(0, 0, 0, ${t === DARK ? 0.5 : 0.2}), 0 4px 14px rgba(0, 0, 0, ${t === DARK ? 0.3 : 0.08}); }
${t === DARK ? '.phone { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); }' : ''}
.screen { position: relative; width: var(--sw); height: calc(var(--sw) * ${2868 / 1320});
  border-radius: calc(var(--sw) * ${62 / 440}); overflow: hidden; background: #fff; }
.screen img { display: block; width: 100%; }
.island { position: absolute; left: 50%; transform: translateX(-50%);
  top: calc(var(--sw) * ${12 / 440}); width: calc(var(--sw) * ${125 / 440});
  height: calc(var(--sw) * ${36 / 440}); border-radius: 999px; background: #000; }
</style></head><body>
${art.join('\n')}
<div class="copy">${copy.lockup ? lockup(t) : ''}${copy.eyebrow ? `<p class="eyebrow">${copy.eyebrow}</p>` : ''}<h1>${copy.headline}</h1>${copy.sub ? `<p class="sub">${copy.sub}</p>` : ''}</div>
${copy.foot ? `<p class="foot">${copy.foot}</p>` : ''}
</body></html>`
}

// The headline sits on the left and the app on the right. The Mac's day fills the
// left half of its window with nothing on the right, so an iPhone goes there, in
// front, where it covers none of it. The first image is the one Product Hunt shows
// largest, so it carries the brand line; the last one ends on Night, like the video.
const SLIDES = [
  {
    name: '01-every-day.png',
    theme: LIGHT,
    copy: { lockup: true, headline: 'Every day<br>is a page.', sub: 'Daily notes and to-dos<br>for Mac and iPhone.' },
    art: [mac('week-light.png', { left: 514, top: 150, s: 0.68 }),
      phone('01-today.png', { left: 990, top: 262, width: 200, lifted: true })]
  },
  {
    name: '02-mac-move.png',
    theme: LIGHT,
    copy: { eyebrow: 'On the Mac', headline: 'Move anything<br>to any day.', sub: '⌘D sends it to tomorrow.<br>⇧⌘M reads “fri” as Friday.' },
    art: [mac('move-to-date.png', { left: 520, top: 145, s: 0.67 })]
  },
  {
    name: '03-iphone-swipe.png',
    theme: LIGHT,
    copy: { eyebrow: 'On the iPhone', headline: 'Not today?<br>Swipe it<br>to tomorrow.', sub: 'Tap a bullet to make it a to-do.<br>Long-press to drag.' },
    art: [phone('02-swipe.png', { left: 690, top: 96, width: 340 })]
  },
  {
    name: '04-search.png',
    theme: LIGHT,
    copy: { eyebrow: 'On the Mac', headline: 'Find anything<br>you’ve written.', sub: '⌘F searches every day,<br>ignoring case and accents.' },
    art: [mac('search.png', { left: 520, top: 145, s: 0.67 })]
  },
  {
    name: '05-dark.png',
    theme: DARK,
    copy: { eyebrow: 'On the iPhone and Mac', headline: 'Just as calm<br>after dark.', sub: 'Sync is optional, and free.' },
    art: [mac('week-dark.png', { left: 514, top: 150, s: 0.68 }),
      phone('07-dark.png', { left: 990, top: 262, width: 200, lifted: true })]
  },
  {
    name: '06-free.png',
    theme: DARK,
    copy: {
      align: 'center', lockup: true, size: 66,
      headline: 'Free. Open source.<br>No account needed.',
      sub: 'No tracking, no paid plan, and it works offline.<br>Your assistant can use it too, over MCP.',
      foot: 'usecue.today'
    }
  }
]

const only = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'cue-ph-'))
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL ?? 'chrome',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text']
})
try {
  for (const slide of SLIDES) {
    if (only.length && !only.some((o) => slide.name.includes(o))) continue
    const html = join(scratch, slide.name.replace('.png', '.html'))
    writeFileSync(html, page(slide))
    const pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE })
    await pg.goto(pathToFileURL(html).href)
    await pg.evaluate(() => document.fonts.ready)
    await pg.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
    // A missing web font silently falls back to Georgia, which would ship a wrong image.
    if (!(await pg.evaluate(() => document.fonts.check('60px Newsreader')))) {
      throw new Error('Newsreader did not load')
    }
    await pg.screenshot({ path: join(OUT, slide.name) })
    await pg.close()
    console.log(`${slide.name}  ${W * SCALE} × ${H * SCALE}`)
  }
} finally {
  await browser.close()
  rmSync(scratch, { recursive: true, force: true })
}
