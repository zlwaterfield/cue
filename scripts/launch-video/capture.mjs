/**
 * Records the real Mac app playing the storyboard.
 *
 * Launches the built app against a throwaway data folder, writes a few earlier
 * days so ⌘F has history, then runs every beat while the screen is recorded at
 * a steady 30 fps. Writes the frames and a timeline of when each beat, shown
 * keystroke and theme change happened, for `compose.mjs` to caption.
 *
 * Nothing here is faked: the typing is typed, and the shortcuts are pressed.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { beats, SEED, WINDOW } from './storyboard.mjs'

export const FPS = 30

/** navigator.platform is Linux there, and Cue reads ⌘ shortcuts as ⌃ unless it thinks it is on a Mac. */
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const GLYPHS = {
  Meta: '⌘', Shift: '⇧', Alt: '⌥', Control: '⌃',
  Enter: '↩', Tab: '⇥', Escape: 'esc', Backspace: '⌫',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→'
}

/** Same seed, same film: typing jitter is random but reproducible. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * ffmpeg grabbing the X display straight to a PNG sequence. x11grab is paced by
 * the wall clock, so the frames are evenly spaced; the two times it reports let
 * `compose.mjs` line them up with the beats.
 */
function recordScreen({ dir, size, ffmpeg, display }) {
  mkdirSync(dir, { recursive: true })
  const child = spawn(ffmpeg, [
    '-y', '-loglevel', 'warning',
    '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(FPS),
    '-video_size', `${size.width}x${size.height}`, '-i', `${display}+0,0`,
    '-compression_level', '1', join(dir, '%05d.png')
  ], { stdio: ['ignore', 'inherit', 'inherit'] })

  return {
    /** Resolves once frames are really arriving, with the time frame 2 landed. */
    async started() {
      for (let i = 0; i < 2000 && !existsSync(join(dir, '00002.png')); i++) await sleep(5)
      return Date.now() / 1000
    },
    async stop() {
      const at = Date.now() / 1000
      child.kill('SIGINT')
      await new Promise((resolve) => child.on('close', resolve))
      return { at, count: readdirSync(dir).filter((f) => f.endsWith('.png')).length }
    }
  }
}

export async function capture({ out, ffmpeg = 'ffmpeg', display = process.env.DISPLAY }) {
  const framesDir = join(out, 'frames')
  rmSync(framesDir, { recursive: true, force: true })
  mkdirSync(framesDir, { recursive: true })
  const userData = mkdtempSync(join(tmpdir(), 'cue-video-'))
  const size = { width: WINDOW.width * WINDOW.scale, height: WINDOW.height * WINDOW.scale }

  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--force-device-scale-factor=${WINDOW.scale}`],
    env: { ...process.env, CUE_USER_DATA: userData, CUE_E2E: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.day')

  if (process.platform !== 'darwin') {
    // Off a Mac, Linux draws the app menu inside the window and Cue reads ⌃ for ⌘.
    // Drop the menu and tell the renderer it is on a Mac: the window then looks,
    // and answers the keyboard, like the real thing.
    await app.evaluate(({ BrowserWindow, Menu }, ua) => {
      Menu.setApplicationMenu(null)
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.setUserAgent(ua)
      win.webContents.reload()
    }, MAC_UA)
    await page.waitForTimeout(900)
    await page.waitForSelector('.day')
  }
  await app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setPosition(0, 0)
    win.setContentSize(w.width, w.height)
  }, WINDOW)
  await page.waitForTimeout(500)

  const random = rng(20261025)
  const now = () => Date.now() / 1000
  const press = async (key, { after = 160 } = {}) => {
    await page.keyboard.press(key)
    await page.waitForTimeout(after)
  }

  // Earlier days, before the camera is on, so Today opens clean and ⌘F has history.
  for (const [first, second] of SEED) {
    await press('Meta+[', { after: 220 })
    await page.keyboard.type(first, { delay: 1 })
    await press('Enter', { after: 60 })
    await page.keyboard.type(second, { delay: 1 })
  }
  await press('Meta+3', { after: 500 })
  await page.locator('.day').first().click({ position: { x: 300, y: 56 } })
  await page.waitForTimeout(400)

  const keys = []
  const themes = []
  const ui = {
    page,
    pause: (ms) => page.waitForTimeout(ms),
    press,
    /** A keystroke worth showing: pressed, and remembered so keycaps can appear with it. */
    async key(combo, { after = 220 } = {}) {
      keys.push({ t: now(), glyphs: combo.split('+').map((k) => GLYPHS[k] ?? k.toUpperCase()) })
      await press(combo, { after })
    },
    /** Typing, at a human speed that lingers on punctuation. */
    async type(text, { cps = 22 } = {}) {
      const base = 1000 / cps
      for (const ch of text) {
        await page.keyboard.type(ch)
        let wait = base * (0.7 + random() * 0.7)
        if ('.?!'.includes(ch)) wait += base * 4
        else if (',:'.includes(ch)) wait += base * 2
        await page.waitForTimeout(wait)
      }
    },
    async theme(scheme) {
      themes.push({ t: now(), scheme })
      await page.emulateMedia({ colorScheme: scheme })
    }
  }

  const recorder = recordScreen({ dir: framesDir, size, ffmpeg, display })
  const secondFrameAt = await recorder.started()
  await page.waitForTimeout(400)

  const origin = now()
  const played = []
  for (const beat of beats) {
    const start = now()
    await beat.act(ui)
    const end = now()
    played.push({ name: beat.name, caption: beat.caption, sub: beat.sub, start: start - origin, end: end - origin })
    process.stdout.write(`  ${beat.name.padEnd(10)} ${(end - start).toFixed(1)}s\n`)
  }
  // Keep rolling past the last beat: the iPhone section plays over this tail, so
  // the Mac keeps its blinking caret instead of freezing into a still.
  await page.waitForTimeout(6000)
  const { at: stoppedAt, count } = await recorder.stop()
  await app.close()
  rmSync(userData, { recursive: true, force: true })

  // Frame 2 landed at secondFrameAt and frame `count` at stoppedAt; x11grab paces
  // itself off the wall clock, so everything between is evenly spaced.
  const step = count > 2 ? (stoppedAt - secondFrameAt) / (count - 2) : 1 / FPS
  const frames = Array.from({ length: count }, (_, i) => ({
    file: `${String(i + 1).padStart(5, '0')}.png`,
    t: secondFrameAt + (i - 1) * step - origin
  }))

  const timeline = {
    window: WINDOW,
    fps: FPS,
    size,
    duration: played.at(-1).end,
    frames,
    beats: played,
    keys: keys.map((k) => ({ ...k, t: k.t - origin })),
    themes: themes.map((t) => ({ ...t, t: t.t - origin }))
  }
  writeFileSync(join(out, 'timeline.json'), JSON.stringify(timeline, null, 2))
  return timeline
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const timeline = await capture({ out: process.argv[2] ?? '.video', ffmpeg: process.env.FFMPEG ?? 'ffmpeg' })
  console.log(`${timeline.frames.length} frames, ${timeline.duration.toFixed(1)}s`)
}
