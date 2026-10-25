/**
 * Builds the launch video (run `pnpm build` first).
 *
 *   pnpm video
 *
 * Films the real app playing `scripts/launch-video/storyboard.mjs`, then draws
 * the captions, the window and the cards around that footage a frame at a time
 * and encodes the result. Writes docs/brand/video/launch.mp4 and a poster.
 *
 * Needs ffmpeg on PATH, and an X display to film on — Linux and CI get one from
 * Xvfb automatically. The working frames land in .video/ and are not committed.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { capture } from './launch-video/capture.mjs'
import { compose } from './launch-video/compose.mjs'
import { OPENING, WINDOW } from './launch-video/storyboard.mjs'

const WORK = '.video'
// The film belongs to the brand kit, in the repository; the working frames stay here.
const OUT = resolve(import.meta.dirname, '../../..', 'docs/brand/video')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function need(command, hint) {
  const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8' })
  if (found.status !== 0) {
    console.error(`${command} is not on PATH. ${hint}`)
    process.exit(1)
  }
  return found.stdout.trim().split('\n')[0]
}

/** A private X display to film on, so the window is the only thing on screen. */
async function startXvfb(size) {
  let number = 90
  while (number < 120 && existsSync(`/tmp/.X11-unix/X${number}`)) number++
  const display = `:${number}`
  const child = spawn('Xvfb', [display, '-screen', '0', `${size.width}x${size.height}x24`, '-nolisten', 'tcp'], {
    stdio: 'ignore'
  })
  for (let i = 0; i < 400 && !existsSync(`/tmp/.X11-unix/X${number}`); i++) await sleep(25)
  if (!existsSync(`/tmp/.X11-unix/X${number}`)) throw new Error(`Xvfb did not come up on ${display}`)
  return { display, stop: () => child.kill() }
}

if (!existsSync('out/main/index.js')) {
  console.error('No build in out/. Run `pnpm build` first.')
  process.exit(1)
}
const ffmpeg = need('ffmpeg', 'Install it with `brew install ffmpeg`.')

const size = { width: WINDOW.width * WINDOW.scale, height: WINDOW.height * WINDOW.scale }
let screen = { display: process.env.DISPLAY, stop: () => {} }
if (!screen.display) {
  if (process.platform !== 'linux') {
    console.error('No DISPLAY to film on. On a Mac, run this where a display is available.')
    process.exit(1)
  }
  need('Xvfb', 'Install it with your package manager (xorg-x11-server-Xvfb).')
  screen = await startXvfb(size)
  process.env.DISPLAY = screen.display
}

rmSync(WORK, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
try {
  console.log(`Filming ${size.width}×${size.height} on ${screen.display}`)
  const timeline = await capture({ out: WORK, ffmpeg, display: screen.display })
  console.log(`  ${timeline.frames.length} frames over ${timeline.duration.toFixed(1)}s`)

  console.log('Composing')
  const poster = timeline.beats.find((b) => b.name === 'lists')
  const film = await compose({
    out: join(OUT, 'launch.mp4'),
    timeline,
    frames: join(WORK, 'frames'),
    ffmpeg,
    poster: { at: OPENING.seconds + poster.end - 0.4, file: join(WORK, 'poster.png') }
  })
  spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', join(WORK, 'poster.png'),
    '-vf', 'scale=1920:1080:flags=lanczos', join(OUT, 'launch-poster.png')])
  console.log(`\n${join(OUT, 'launch.mp4')} — ${film.seconds.toFixed(1)}s, ${film.frames} frames`)
} finally {
  screen.stop()
}
