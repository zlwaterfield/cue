const { chromium } = require('playwright')
const OUT = process.argv[2]
const log = []
const check = (name, ok, detail) => { log.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '') }
const OPEN = { width: 951, height: 700 }
const LEFT = { top: 0, bottom: 21, left: 84, right: 0 }
const RIGHT = { top: 0, bottom: 21, left: 0, right: 84 }
const PHONE = { width: 402, height: 874 }
const PHONE_IN = { top: 62, bottom: 34, left: 0, right: 0 }

async function open(b, port, vp, insets, opts = {}) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2, colorScheme: opts.dark ? 'dark' : 'light' })
  p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)))
  await p.addInitScript((i) => { window.__insets = i }, insets)
  await p.goto(`http://localhost:${port}/`)
  await p.waitForTimeout(3000)
  return p
}
// Marks what the test simulates: the strip the system keeps, and the middle of the window (the fold).
async function annotate(p, insets, fold) {
  await p.evaluate(({ insets, fold }) => {
    document.querySelectorAll('.__mark').forEach((e) => e.remove())
    const add = (css, text) => { const d = document.createElement('div'); d.className = '__mark'; d.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;' + css; d.textContent = text ?? ''; document.body.appendChild(d) }
    const strip = 'top:0;bottom:0;background:repeating-linear-gradient(45deg,rgba(255,59,48,.16) 0 8px,rgba(255,59,48,.07) 8px 16px);'
    if (insets.left) add(strip + `left:0;width:${insets.left}px;border-right:1px dashed rgba(255,59,48,.8)`)
    if (insets.right) add(strip + `right:0;width:${insets.right}px;border-left:1px dashed rgba(255,59,48,.8)`)
    if (insets.left || insets.right) add(`top:50%;${insets.left ? 'left:0' : 'right:0'};width:${insets.left || insets.right}px;text-align:center;font:600 10px system-ui;color:#c0261d;line-height:1.3`, 'system strip (simulated)')
    if (fold) { add('top:0;bottom:0;left:50%;border-left:1.5px dashed rgba(0,122,255,.75)'); add('bottom:4px;left:50%;transform:translateX(-50%);font:600 10px system-ui;color:#0a6cdc;background:rgba(255,255,255,.85);padding:1px 6px;border-radius:6px', 'fold = middle of window') }
  }, { insets, fold })
}
const shot = async (p, name) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${name}.png` }) }
const pages = (p) => p.evaluate(() => [...document.querySelectorAll('div[aria-label="New line"]')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width } }))
const titles = (p) => p.evaluate(() => [...document.querySelectorAll('textarea')].map((t) => t.value))
const extent = (p) => p.evaluate(() => { let l = 1e9, r = 0; for (const e of document.querySelectorAll('textarea,[role=tab],button')) { const b = e.getBoundingClientRect(); if (!b.width) continue; l = Math.min(l, b.x); r = Math.max(r, b.right) } return { l, r } })
const selected = (p) => p.evaluate(() => document.body.innerText.split('\n').filter((s) => /^(\w+day, )?November \d{1,2}$/.test(s)))
const setWindow = async (p, vp, insets) => { await p.evaluate((i) => { window.__insets = i }, insets); await p.setViewportSize(vp); await p.waitForTimeout(900) }

;(async () => {
  const b = await chromium.launch()
  let p

  // 1. Ordinary iPhone: unchanged, one day
  p = await open(b, 4173, PHONE, PHONE_IN)
  check('iPhone 402pt: one day', (await pages(p)).length === 1)
  await shot(p, '01-iphone-single'); await p.close()

  // 2. Before (main) vs after at the open size, strip on the left
  p = await open(b, 4174, OPEN, LEFT)
  let e = await extent(p)
  check('main @951 strip left: content runs under the strip (the bug)', e.l < 84, `leftmost content x=${e.l}`)
  await annotate(p, LEFT, true); await shot(p, '02-before-main-open'); await p.close()

  p = await open(b, 4173, OPEN, LEFT)
  let pg = await pages(p); e = await extent(p)
  check('PR @951 strip left: two days', pg.length === 2, JSON.stringify(pg))
  check('PR: nothing under the strip', e.l >= 84, `leftmost content x=${e.l}`)
  check('PR: days meet at the middle of the window (475.5)', Math.abs(pg[1].x - 475.5) <= 1.5, `second page starts x=${pg[1]?.x}`)
  check('PR: page widths 391.5 / 475.5', Math.abs(pg[0].w - 391.5) <= 1.5 && Math.abs(pg[1].w - 475.5) <= 1.5, `${pg[0].w} / ${pg[1].w}`)
  check('PR: shows today and tomorrow', (await selected(p)).length === 2, (await selected(p)).join(' | '))
  await annotate(p, LEFT, true); await shot(p, '03-after-open-strip-left')

  // 3. Write on the second day
  await p.mouse.click(700, 400)
  await p.waitForTimeout(400)
  await p.keyboard.type('Written on the second day', { delay: 15 })
  await p.waitForTimeout(500)
  let t = await titles(p)
  check('typing on the second day adds a line there', t.includes('Written on the second day'))
  // tick a to-do on the second day
  await p.keyboard.press('Escape')
  await p.mouse.click(506, 216); await p.waitForTimeout(500)
  const done = await p.evaluate(() => [...document.querySelectorAll('textarea')].find((t) => t.value === 'Dentist at 9:30')?.getAttribute('aria-label'))
  check('ticking a to-do on the second day', done === 'Completed to-do', done)
  await annotate(p, LEFT, true); await shot(p, '04-writing-on-second-day')

  // 4. Turn from the week strip
  await p.click('[aria-label^="Saturday, November 21"]'); await p.waitForTimeout(900)
  let s = await selected(p)
  check('picking Sat 21 opens Sat 21 + Sun 22', s.length === 2 && /21$/.test(s[0]) && /22$/.test(s[1]), s.join(' | '))
  await shot(p, '05-turned-to-saturday')
  await p.click('[aria-label^="Today, Thursday"]'); await p.waitForTimeout(900)

  // 5. Swipe the second page: both turn by one day
  await p.mouse.move(760, 600); await p.mouse.down()
  for (let x = 760; x >= 520; x -= 20) { await p.mouse.move(x, 600); await p.waitForTimeout(16) }
  await p.mouse.up(); await p.waitForTimeout(1200)
  await p.evaluate(() => document.activeElement?.blur?.()); await p.waitForTimeout(400)
  s = await selected(p)
  check('swiping the second page left turns both by one day (Fri 20 + Sat 21)', s.length === 2 && /20$/.test(s[0]) && /21$/.test(s[1]), s.join(' | '))
  await annotate(p, LEFT, true); await shot(p, '06-swiped-second-page')
  await p.click('[aria-label^="Today, Thursday"]'); await p.waitForTimeout(900)

  // 6. Close while editing, then open again
  await p.click('textarea:text-is("Renew passport")').catch(async () => { const box = await p.evaluate(() => { const t = [...document.querySelectorAll('textarea')].find((t) => t.value === 'Renew passport'); const r = t.getBoundingClientRect(); return { x: r.x + 60, y: r.y + 10 } }); await p.mouse.click(box.x, box.y) })
  await p.waitForTimeout(400); await p.keyboard.press('End'); await p.waitForTimeout(200); await p.keyboard.type(': before the trip', { delay: 25 })
  await annotate(p, {}, false)
  await setWindow(p, PHONE, PHONE_IN)
  pg = await pages(p); s = await selected(p)
  check('closed (402pt): back to one day, the first of the two', pg.length === 1 && s.length === 1 && /19$/.test(s[0]), s.join(' | '))
  let focus = await p.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { v: a.value, y: r.y, vh: innerHeight } })
  check('closed: the line being edited keeps focus and is on screen', focus.v === 'Renew passport: before the trip' && focus.y > 0 && focus.y < focus.vh, JSON.stringify(focus))
  await shot(p, '07-closed-mid-edit')
  await setWindow(p, OPEN, LEFT)
  pg = await pages(p); t = await titles(p)
  focus = await p.evaluate(() => document.activeElement.value)
  check('opened again: two days, edit kept, still focused', pg.length === 2 && focus === 'Renew passport: before the trip' && t.includes('Written on the second day'), focus)
  await annotate(p, LEFT, true); await shot(p, '08-reopened-mid-edit')
  await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement.blur())

  // 7. Notes: one capped column
  await annotate(p, {}, false)
  await p.click('[role=tab][aria-label="Notes"]'); await p.waitForTimeout(1200)
  pg = await pages(p)
  check('Notes tab: single column, no wider than 680', pg.length <= 1 && (pg[0]?.w ?? 0) <= 680, JSON.stringify(pg))
  await annotate(p, LEFT, true); await shot(p, '09-notes-single-column')
  await annotate(p, {}, false)
  await p.click('[role=tab][aria-label="Today"]'); await p.waitForTimeout(900)

  // 8. Screens over the day
  await p.click('[aria-label="Search"]'); await p.waitForTimeout(1200)
  await p.keyboard.type('release', { delay: 20 }); await p.waitForTimeout(800)
  e = await p.evaluate(() => { let l = 1e9; for (const el of document.querySelectorAll('input')) { const b = el.getBoundingClientRect(); if (b.width) l = Math.min(l, b.x) } return l })
  check('Search (full-width modal): field clear of the strip', e >= 84, `search field x=${e}`)
  await annotate(p, LEFT, false); await shot(p, '10-search-modal')
  await p.close()

  // 9. Strip on the right
  p = await open(b, 4173, OPEN, RIGHT)
  pg = await pages(p); e = await extent(p)
  check('strip right: two days, nothing under the strip', pg.length === 2 && e.r <= 951 - 84, `rightmost content x=${e.r}`)
  check('strip right: still meet at the middle; right page is the narrower', Math.abs(pg[1].x - 475.5) <= 1.5 && pg[1].w < pg[0].w, `${pg[0].w} / ${pg[1].w}`)
  await annotate(p, RIGHT, true); await shot(p, '11-open-strip-right'); await p.close()

  // 10. The 360pt threshold
  for (const [w, want] of [[887, 1], [889, 2]]) {
    p = await open(b, 4173, { width: w, height: 700 }, LEFT)
    pg = await pages(p)
    check(`threshold: ${w}pt wide, strip 84 → first page ${(w / 2 - 84).toFixed(1)}pt → ${want} day(s)`, pg.length === want, `${pg.length}`)
    if (want === 1) { e = await extent(p); check('  single day beside a strip keeps clear of it', e.l >= 84, `x=${e.l}`); await annotate(p, LEFT, true); await shot(p, '12-just-under-threshold') }
    await p.close()
  }

  // 11. iPad portrait, and dark
  p = await open(b, 4173, { width: 1024, height: 1366 }, { top: 24, bottom: 20, left: 0, right: 0 })
  pg = await pages(p)
  check('iPad 1024pt: two days, 512 / 512', pg.length === 2 && Math.abs(pg[0].w - 512) <= 1.5, JSON.stringify(pg))
  await shot(p, '13-ipad-portrait'); await p.close()
  p = await open(b, 4173, OPEN, LEFT, { dark: true })
  await annotate(p, LEFT, true); await shot(p, '14-open-dark'); await p.close()

  require('fs').writeFileSync(`${OUT}/results.json`, JSON.stringify(log, null, 2))
  await b.close()
})()
