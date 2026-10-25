/**
 * Renders the social card animation to site/images/og.mp4, the og:video.
 *
 *   pnpm og-video
 *
 * Opens docs/brand/social/og-video.html in Chrome, steps window.cueFrame(t) one
 * frame at a time at 2x, and pipes the frames straight into ffmpeg. Needs ffmpeg
 * on PATH (`brew install ffmpeg`) and a Chrome to drive; Google Fonts is fetched
 * for Newsreader and Geist, so it needs the network too.
 *
 * Keep the result small — Messages downloads it before it will play.
 */
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

// Both belong to the repository, and the working directory is this app's folder.
const REPO = resolve(import.meta.dirname, '../../..')
const PAGE = resolve(REPO, 'docs/brand/social/og-video.html')
const OUT = resolve(REPO, 'site/images/og.mp4')
const FPS = 30
const SCALE = 2 // render at 2560x1280 and let ffmpeg resample down, for cleaner type

const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL ?? 'chrome',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text']
})
const page = await browser.newPage({
  viewport: { width: 1280, height: 640 },
  deviceScaleFactor: SCALE
})
await page.goto(pathToFileURL(PAGE).href)
await page.evaluate(() => window.cueReady)

// A missing web font silently falls back to Times, which would ship a wrong card.
const missing = await page.evaluate(() =>
  window.cueFonts.filter(([f, s]) => !document.fonts.check(f, s)).map(([f]) => f))
if (missing.length) throw new Error(`fonts did not load: ${missing.join(', ')}`)

const duration = await page.evaluate(() => window.cueDuration)
const frames = Math.round(duration * FPS)

const enc = spawn(ffmpeg, [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-vf', `scale=${1280}:${640}:flags=lanczos`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
  '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
  // Messages seeks before it plays, so the moov atom has to come first.
  '-movflags', '+faststart', '-an', OUT
], { stdio: ['pipe', 'inherit', 'inherit'] })
const done = new Promise((resolve, reject) => {
  enc.on('error', reject)
  enc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
})

// cueFrame is pure, but rendering in order keeps the encoder happy.
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.cueFrame(t), i / FPS)
  const png = await page.screenshot({ type: 'png' })
  if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r))
  if (i % 30 === 0) process.stdout.write(`\rframe ${i + 1}/${frames}`)
}
enc.stdin.end()
await browser.close()
await done

const kb = Math.round(statSync(OUT).size / 1024)
console.log(`\rwrote ${OUT} — ${frames} frames, ${duration}s, ${kb} KB`)
