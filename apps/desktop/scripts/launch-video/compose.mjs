/**
 * Turns the captured footage into the film.
 *
 * Opens `stage.html` in a browser, asks it for one frame at a time and pipes
 * each screenshot straight into ffmpeg. Rendering frame by frame rather than
 * recording a page means a slow frame costs time, never a dropped frame, so the
 * fades land on the same millisecond every run.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { beats, CLOSING, DEVICES, OPENING } from './storyboard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// The repository root: the screenshots and the logo this draws are kept there.
const REPO = resolve(HERE, '../../../..')
const FPS = 30
/** The stage is laid out at 1920 × 1080 and drawn at twice that, then scaled back down. */
const CANVAS = { width: 1920, height: 1080, scale: 2 }
/** How the window sits on the page: 900 × 630 of app, this much bigger. */
const MAC_SCALE = 1.22

/** Lays the beats, cards and keystrokes out on one clock. */
export function plan(timeline, framesDir = '.video/frames') {
  const appAt = OPENING.seconds
  const demoEnd = appAt + timeline.beats.at(-1).end
  const devicesAt = demoEnd + 0.15
  // The devices are off screen before the closing card starts: cards and footage
  // never share the frame, the way one caption never sits on the next.
  const closingAt = devicesAt + DEVICES.seconds

  // Captions come from the storyboard as it reads now, not from the recording,
  // so the words can be rewritten without filming the app again.
  const written = new Map(beats.map((b) => [b.name, b]))
  const cues = timeline.beats.map((beat) => {
    const now = written.get(beat.name) ?? beat
    return { at: appAt + beat.start, caption: now.caption, sub: now.sub }
  })
  cues.push({ at: devicesAt + 0.3, caption: DEVICES.caption, sub: DEVICES.sub })
  for (const [i, cue] of cues.entries()) cue.until = cues[i + 1]?.at ?? closingAt - 0.5

  return {
    duration: closingAt + CLOSING.seconds,
    appAt,
    darkAt: appAt + (timeline.themes[0]?.t ?? timeline.duration),
    mac: { scale: MAC_SCALE, width: timeline.window.width, height: timeline.window.height },
    opening: { ...OPENING, out: appAt - 0.9 },
    devices: {
      at: devicesAt,
      seconds: DEVICES.seconds,
      macScale: 0.7,
      macShift: -202,
      phoneShift: 420,
      screen: pathToFileURL(join(REPO, DEVICES.screen)).href
    },
    closing: { ...CLOSING, at: closingAt },
    cues,
    keys: timeline.keys.map((k) => ({ at: appAt + k.t, glyphs: k.glyphs })),
    footage: timeline.frames.map((f) => ({ t: f.t, src: pathToFileURL(resolve(framesDir, f.file)).href }))
  }
}

async function launchBrowser() {
  const args = ['--no-sandbox', '--disable-lcd-text', '--force-color-profile=srgb', '--font-render-hinting=none']
  try {
    return await chromium.launch({ args })
  } catch {
    // No Playwright browsers downloaded; the system Chrome renders this the same.
    return await chromium.launch({ args, channel: 'chrome' })
  }
}

export async function compose({ out, timeline, frames = '.video/frames', ffmpeg = 'ffmpeg', poster }) {
  const data = plan(timeline, frames)
  const total = Math.round(data.duration * FPS)
  mkdirSync(dirname(out), { recursive: true })

  const lockup = readFileSync(join(REPO, 'docs/brand/logo/cue-lockup-ink.svg'), 'utf8')
    .replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="currentColor"')
    .replace(/width="[\d.]+" height="[\d.]+"/, 'height="100%" width="auto"')

  const browser = await launchBrowser()
  const page = await browser.newPage({
    viewport: { width: CANVAS.width, height: CANVAS.height },
    deviceScaleFactor: CANVAS.scale
  })
  await page.goto(pathToFileURL(join(HERE, 'stage.html')).href)
  await page.evaluate((payload) => window.CUE.init(payload), { ...data, lockup })
  await page.waitForFunction(() => document.fonts.status === 'loaded')

  const encoder = spawn(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    '-vf', `scale=${CANVAS.width}:${CANVAS.height}:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level', '4.1',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS),
    out
  ], { stdio: ['pipe', 'inherit', 'inherit'] })

  const write = (buffer) =>
    new Promise((ok, fail) => {
      encoder.stdin.write(buffer, (err) => (err ? fail(err) : ok()))
    })

  const posterFrame = poster ? Math.round(poster.at * FPS) : -1
  const started = Date.now()
  for (let frame = 0; frame < total; frame++) {
    await page.evaluate((t) => window.CUE.seek(t), frame / FPS)
    const shot = await page.screenshot({ type: 'png' })
    await write(shot)
    if (frame === posterFrame) writeFileSync(poster.file, shot)
    if (frame % 60 === 0 || frame === total - 1) {
      const done = (frame + 1) / total
      const left = ((Date.now() - started) / done) * (1 - done)
      process.stdout.write(`\r  frame ${frame + 1}/${total} (${Math.round(done * 100)}%, ~${Math.round(left / 1000)}s left)  `)
    }
  }
  process.stdout.write('\n')
  encoder.stdin.end()
  await new Promise((done, fail) =>
    encoder.on('close', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))))
  )
  await browser.close()
  return { seconds: data.duration, frames: total }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? '.video'
  const timeline = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'))
  const result = await compose({
    out: process.argv[3] ?? join(dir, 'launch.mp4'),
    timeline,
    frames: join(dir, 'frames'),
    ffmpeg: process.env.FFMPEG ?? 'ffmpeg'
  })
  console.log(`${result.frames} frames, ${result.seconds.toFixed(1)}s`)
}
