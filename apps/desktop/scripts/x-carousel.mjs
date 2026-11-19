/**
 * Renders the images for a post on X: the 1.0 post's into brand/social/x-carousel/, and
 * the design polish post's into brand/social/x-polish/.
 *
 *   pnpm x-carousel            both sets
 *   pnpm x-carousel polish     one set, or one image: any part of "<set>/<file name>"
 *
 * X shows a post's images as a carousel, and crops any image outside its shapes:
 * about 3:4 to 4:3 on the web and 3:4 to 20:17 in the iPhone app. App Store
 * screenshots (about 9:19.5) come out cut off at the top and bottom, so these are
 * 4:5, which sits inside both. A post takes at most four images, so there are four.
 *
 * Lays each image out in HTML from the Mac screenshots in docs/images and the
 * iPhone screens in brand/app-store/screens, at 720 × 900 CSS pixels, and takes
 * it at 2x: 1440 × 1800. Needs a Chrome to drive (CHROME_CHANNEL picks another).
 *
 * The polish set's iPhones are not App Store screens: they are the screens
 * scripts/phone-shots.py draws in the app's current layout, kept beside the images
 * (`python3 scripts/phone-shots.py --screens ../../brand/social/x-polish/screens`).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

// Both belong to the repository, and the working directory is this app's folder.
const REPO = resolve(import.meta.dirname, '../../..')
const OUT = (set) => resolve(REPO, 'brand/social', set)
const W = 720
const H = 900
const SCALE = 2

const file = (path) => pathToFileURL(resolve(REPO, path)).href
const MAC = (name) => file(`docs/images/${name}`)
// An App Store screen by its file name, or any other screen by its path from the repository's root.
const POLISH = (name) => `brand/social/x-polish/screens/${name}`
const PHONE = (name) => file(name.includes('/') ? name : `brand/app-store/screens/${name}`)

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

function page({ theme, copy, art }) {
  const t = theme
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Newsreader"; font-weight: 400; font-style: normal;
  src: url("${file('site/fonts/newsreader-latin.woff2')}") format("woff2"); }
* { box-sizing: border-box; }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
body { position: relative; background: linear-gradient(180deg, ${t.top}, ${t.bottom});
  -webkit-font-smoothing: antialiased; }
.copy { position: absolute; left: 0; right: 0; top: ${copy.top}px; text-align: center; }
.lockup { display: block; height: 34px; width: auto; margin: 0 auto 26px; color: ${t.ink}; }
.eyebrow { margin: 0 0 14px; color: ${t.text2};
  font: 500 19px/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; }
h1 { margin: 0; color: ${t.ink}; font: 400 ${copy.size ?? 60}px/1.04 "Newsreader", Georgia, serif;
  font-variation-settings: "opsz" 72; letter-spacing: -0.02em; }
.sub { margin: 20px 0 0; color: ${t.text2};
  font: 19px/1.42 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; letter-spacing: -0.01em; }
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
<div class="copy">${copy.lockup ? lockup(t) : ''}${copy.eyebrow ? `<p class="eyebrow">${copy.eyebrow}</p>` : ''}<h1>${copy.headline}</h1>${copy.sub ? `<p class="sub">${copy.sub}</p>` : ''}</div>
${art.join('\n')}
</body></html>`
}

// The Mac's day sits in the left half of its window, with nothing on the right,
// so the iPhone goes there, in front, where it covers none of it.
const SLIDES = [
  {
    set: 'x-carousel',
    name: '01-out-of-beta.png',
    theme: LIGHT,
    copy: {
      top: 62, lockup: true, size: 64,
      headline: 'Out of beta.<br>On the App Store.',
      sub: 'Cue 1.0 is stable, and free.<br>Daily notes and to-dos for your iPhone and Mac.'
    },
    art: [mac('week-light.png', { left: 52, top: 430, s: 0.72 }),
      phone('01-today.png', { left: 446, top: 492, width: 222, lifted: true })]
  },
  {
    set: 'x-carousel',
    name: '02-mac-move.png',
    theme: LIGHT,
    copy: { top: 64, eyebrow: 'On the Mac', headline: 'Move anything<br>to any day.' },
    art: [mac('move-to-date.png', { left: 34, top: 320, s: 0.84 })]
  },
  {
    set: 'x-carousel',
    name: '03-iphone-swipe.png',
    theme: LIGHT,
    copy: { top: 64, eyebrow: 'On the iPhone', headline: 'Not today? Swipe it<br>to tomorrow.' },
    art: [phone('02-swipe.png', { left: 170, top: 262, width: 380 })]
  },
  {
    set: 'x-carousel',
    name: '04-dark.png',
    theme: DARK,
    copy: { top: 64, eyebrow: 'On the iPhone and Mac', headline: 'Just as calm<br>after dark.' },
    art: [mac('week-dark.png', { left: 40, top: 300, s: 0.76 }),
      phone('07-dark.png', { left: 446, top: 372, width: 222, lifted: true })]
  },
  // The design polish: a roomier calendar and tabbed notes on the Mac, tabs at the bottom
  // of the iPhone.
  {
    set: 'x-polish',
    name: '01-polish.png',
    theme: LIGHT,
    copy: {
      top: 62, lockup: true, size: 64,
      headline: 'A little polish.',
      sub: 'A roomier calendar and tidier notes on the Mac.<br>Today and Notes at your thumb on the iPhone.'
    },
    art: [mac('week-light.png', { left: 52, top: 380, s: 0.72 }),
      phone(POLISH('today.png'), { left: 446, top: 404, width: 222, lifted: true })]
  },
  {
    set: 'x-polish',
    name: '02-mac-calendar.png',
    theme: LIGHT,
    copy: { top: 64, eyebrow: 'On the Mac', headline: 'A calendar with<br>room to breathe.' },
    // Narrower than the 1.0 set's: Move to is wider now, and its calendar has to fit.
    art: [mac('move-to-date.png', { left: 30, top: 330, s: 0.78 })]
  },
  {
    set: 'x-polish',
    name: '03-iphone-tabs.png',
    theme: LIGHT,
    copy: { top: 64, eyebrow: 'On the iPhone', headline: 'Today and Notes,<br>a thumb away.' },
    art: [phone(POLISH('today.png'), { left: 80, top: 300, width: 250 }),
      phone(POLISH('notes.png'), { left: 377, top: 300, width: 250 })]
  },
  {
    set: 'x-polish',
    name: '04-mac-notes.png',
    theme: LIGHT,
    copy: { top: 64, eyebrow: 'On the Mac', headline: 'Every note<br>gets a tab.' },
    // The whole window, so the tabs on the left and Copy and Delete on the right both show.
    art: [mac('notes.png', { left: 20, top: 340, s: 0.68 })]
  }
]

const only = process.argv.slice(2)
const scratch = mkdtempSync(join(tmpdir(), 'cue-x-'))
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL ?? 'chrome',
  args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text']
})
try {
  for (const slide of SLIDES) {
    if (only.length && !only.some((o) => `${slide.set}/${slide.name}`.includes(o))) continue
    mkdirSync(OUT(slide.set), { recursive: true })
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
    await pg.screenshot({ path: join(OUT(slide.set), slide.name) })
    await pg.close()
    console.log(`${slide.set}/${slide.name}  ${W * SCALE} × ${H * SCALE}`)
  }
} finally {
  await browser.close()
  rmSync(scratch, { recursive: true, force: true })
}
