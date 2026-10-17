/**
 * Cue performance benchmark. Prints a Markdown report.
 *
 *   pnpm bench                 # uses release/mac-arm64/Cue.app if built, else out/
 *   pnpm bench --runs 9        # startup samples per dataset (default 7)
 *   pnpm bench --years 5       # size of the large dataset (default 5)
 *   pnpm bench --check         # exit non-zero if any result misses its budget
 *
 * What it measures, on the real app:
 *  - startup: process spawn → first screen ready for typing (median of N cold launches)
 *  - input latency: keydown → next painted frame, and keydown → handlers finished,
 *    for typing, Enter, Tab, ⌘↩ and ⌥↑ (p50 / p95)
 *  - day navigation: ⌘[ → the previous day painted, reading from the large database
 *  - storage round trips from the renderer: search and loading a week
 *  - memory (resident, all Electron processes, idle after launch) and on-disk sizes
 *
 * Keys are sent at a fast human cadence (one every 30 ms, ~400 wpm) rather than in a
 * synthetic burst, so latencies reflect what a person would see.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { _electron as electron } from '@playwright/test'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const RUNS = Number(option('runs', 7))
const CHECK = args.includes('--check')
const YEARS = Number(option('years', 5))
const packaged = 'release/mac-arm64/Cue.app/Contents/MacOS/Cue'
const appPath = option('app', existsSync(packaged) ? packaged : null)
const electronPath = createRequire(import.meta.url)('electron')
const target = appPath ? { exe: appPath, args: [] } : { exe: electronPath, args: ['.'] }

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
const ms = (x) => (x < 10 ? `${x.toFixed(1)} ms` : `${Math.round(x)} ms`)
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

function seed(years) {
  const dir = mkdtempSync(join(tmpdir(), 'cue-bench-'))
  const out = execFileSync('node', ['scripts/run-ts.mjs', 'scripts/seed.ts', dir, String(years)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  return { dir, items: Number(/Seeded (\d+)/.exec(out)?.[1] ?? 0) }
}

const env = (dir) => ({ ...process.env, CUE_USER_DATA: dir, CUE_E2E: '1', CUE_BENCH: '1' })

async function startOnce(dir, { memory = false } = {}) {
  const t0 = Date.now()
  const child = spawn(target.exe, target.args, { env: env(dir), stdio: ['ignore', 'pipe', 'ignore'] })
  const result = await new Promise((resolve, reject) => {
    let buffer = ''
    let elapsed = null
    const timer = setTimeout(() => reject(new Error('startup timed out')), 30_000)
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const ready = /CUE_INTERACTIVE (\d+)/.exec(buffer)
      if (ready && elapsed === null) elapsed = Number(ready[1]) - t0
      const mem = /CUE_MEMORY (\d+)/.exec(buffer)
      if (elapsed !== null && (!memory || mem)) {
        clearTimeout(timer)
        resolve({ elapsed, memory: mem ? Number(mem[1]) : null })
      }
    })
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await exited
  return result
}

async function startup(dir) {
  await startOnce(dir) // warm-up: first launch of a new binary pays one-time OS checks
  const samples = []
  for (let i = 0; i < RUNS; i++) samples.push((await startOnce(dir)).elapsed)
  const { memory } = await startOnce(dir, { memory: true })
  return { samples, memory }
}

const HARNESS = () => {
  const bench = (window.__bench = { samples: [], current: null })
  const finish = (sample) => {
    requestAnimationFrame(() =>
      setTimeout(() => {
        sample.frame = performance.now() - sample.t0
        bench.samples.push(sample)
      })
    )
  }
  window.addEventListener(
    'keydown',
    (e) => {
      const sample = { t0: performance.now(), label: bench.label, work: 0 }
      bench.current = sample
      if (bench.label === 'navigate') {
        const from = document.querySelector('.day')?.dataset.day
        const poll = () => {
          if (document.querySelector('.day')?.dataset.day !== from) {
            sample.work = performance.now() - sample.t0
            finish(sample)
          } else requestAnimationFrame(poll)
        }
        requestAnimationFrame(poll)
      } else finish(sample)
      void e
    },
    true
  )
  const done = () => {
    const s = bench.current
    if (s && s.label !== 'navigate') s.work = Math.max(s.work, performance.now() - s.t0)
  }
  window.addEventListener('keydown', done)
  window.addEventListener('input', done)
}

async function interactions(dir) {
  const app = await electron.launch({ executablePath: target.exe, args: target.args, env: env(dir) })
  const page = await app.firstWindow()
  await page.waitForFunction(() => performance.getEntriesByName('cue:interactive').length > 0)
  await page.evaluate(HARNESS)
  const label = (l) => page.evaluate((l) => (window.__bench.label = l), l)
  const CADENCE = 30
  const k = async (key) => {
    await page.keyboard.press(key)
    await page.waitForTimeout(CADENCE)
  }

  await label('type')
  await page.keyboard.type('The quick brown fox jumps over the lazy dog. '.repeat(4), { delay: CADENCE })
  await label('enter')
  for (let i = 0; i < 40; i++) {
    await k('Enter')
    await page.keyboard.type('x', { delay: CADENCE })
  }
  await label('tab')
  for (let i = 0; i < 20; i++) {
    await k('Tab')
    await k('Shift+Tab')
  }
  await label('complete')
  for (let i = 0; i < 40; i++) await k('Meta+Enter')
  await label('reorder')
  for (let i = 0; i < 20; i++) {
    await k('Alt+ArrowUp')
    await k('Alt+ArrowDown')
  }
  await k('Meta+1')
  await page.waitForTimeout(100)
  await label('navigate')
  for (let i = 0; i < 40; i++) await k('Meta+[')
  await page.waitForTimeout(200)
  const samples = await page.evaluate(() => window.__bench.samples)

  const storage = await page.evaluate(async () => {
    const queries = ['budget', 'launch review', 'dentist', 'flight hotel', 'roadmap retro', 'groceries', 'qzxv nothing']
    const search = []
    let matches = 0
    for (let round = 0; round < 6; round++) {
      for (const q of queries) {
        const t = performance.now()
        const r = await window.cue.search(q, 60)
        search.push(performance.now() - t)
        matches = Math.max(matches, r.length)
      }
    }
    const week = []
    const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86_400_000).toISOString().slice(0, 10)
    for (let i = 0; i < 40; i++) {
      const dates = Array.from({ length: 7 }, (_, j) => day(i * 9 + j))
      const t = performance.now()
      await window.cue.loadDates(dates)
      week.push(performance.now() - t)
    }
    return { search, week }
  })

  await app.close()
  return { samples, storage }
}

const machine = `${cpus()[0].model}, ${Math.round(totalmem() / 1024 ** 3)} GB RAM, macOS ${execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()}`
console.error(`Benchmarking ${appPath ? 'packaged app' : 'unpackaged build (out/)'} on ${machine}…`)

const empty = mkdtempSync(join(tmpdir(), 'cue-bench-empty-'))
const large = seed(YEARS)
console.error(`Seeded ${large.items.toLocaleString()} items across ${YEARS} years`)

const startEmpty = await startup(empty)
const startLarge = await startup(large.dir)
const { samples, storage } = await interactions(large.dir)

// Budgets are the targets changes are held to. Latency budgets apply to p95.
const rows = []
const missed = []
const row = (what, value, note = '', budget = null, actual = null) => {
  let cell = ''
  if (budget !== null) {
    const ok = actual <= budget
    if (!ok) missed.push(`${what}: ${ms(actual)} > ${ms(budget)}`)
    cell = `${ok ? '✓' : '✗'} ≤ ${ms(budget)}`
  }
  rows.push(`| ${what} | ${value} | ${cell} | ${note} |`)
}
const latency = (xs) => `${ms(pct(xs, 50))} · p95 ${ms(pct(xs, 95))}`
row('Launch → ready to type, empty', ms(median(startEmpty.samples)), `median of ${RUNS} cold launches`, 400, median(startEmpty.samples))
row(`Launch → ready to type, ${YEARS} years of notes`, ms(median(startLarge.samples)), `${large.items.toLocaleString()} items`, 400, median(startLarge.samples))
const byLabel = (l) => samples.filter((s) => s.label === l)
for (const [l, name, budget] of [
  ['type', 'Keystroke → frame rendered', 8],
  ['enter', 'Enter → new line rendered', 16],
  ['tab', 'Tab / ⇧Tab → re-indented', 16],
  ['complete', '⌘↩ → to-do toggled', 16],
  ['reorder', '⌥↑ / ⌥↓ → item moved', 16]
]) {
  const s = byLabel(l)
  if (!s.length) continue
  const frames = s.map((x) => x.frame)
  row(name, latency(frames), `handlers finish in ${ms(pct(s.map((x) => x.work), 50))}`, budget, pct(frames, 95))
}
const nav = byLabel('navigate').map((x) => x.frame)
if (nav.length) row('⌘[ → previous day rendered', latency(nav), 'read from SQLite every time', 50, pct(nav, 95))
row(`Search ${large.items.toLocaleString()} items`, latency(storage.search), 'p95 is a full scan with no matches', 50, pct(storage.search, 95))
row('Load a week of notes', latency(storage.week), 'renderer → SQLite → renderer', 10, pct(storage.week, 95))
row('Memory, idle after launch', mb(startLarge.memory), 'resident, all Electron processes combined')

const js = readdirSync('out/renderer/assets').filter((f) => f.endsWith('.js'))
const jsBytes = js.reduce((n, f) => n + statSync(join('out/renderer/assets', f)).size, 0)
const jsGzip = js.reduce((n, f) => n + gzipSync(readFileSync(join('out/renderer/assets', f))).length, 0)
row('UI code', `${Math.round(jsBytes / 1024)} KB`, `${Math.round(jsGzip / 1024)} KB gzipped, React included`)
row(`Database, ${YEARS} years`, mb(statSync(join(large.dir, 'cue.sqlite')).size), 'SQLite, one file')
const dmg = existsSync('release') ? readdirSync('release').find((f) => f.endsWith('.dmg')) : null
if (dmg) row('Download (.dmg)', mb(statSync(join('release', dmg)).size), 'Electron runtime included')
if (existsSync('release/mac-arm64/Cue.app')) {
  const kb = Number(execFileSync('du', ['-sk', 'release/mac-arm64/Cue.app'], { encoding: 'utf8' }).split(/\s/)[0])
  row('Installed app', mb(kb * 1024), '')
}

console.log(`Measured on ${machine}.\n`)
console.log('| | Result | Budget | Notes |')
console.log('| --- | --- | --- | --- |')
console.log(rows.join('\n'))
if (missed.length) {
  console.error(`\nOver budget:\n  ${missed.join('\n  ')}`)
  if (CHECK) process.exit(1)
}
