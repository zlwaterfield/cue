import { execFile } from 'node:child_process'
import { SAVE_TAB_SHORTCUT, shortcutKeys } from '@shared/commands'

/**
 * Saving the front browser tab (⌃⌥⌘L). `lsappinfo` says which app is in front without
 * asking for any permission; if it's a browser Cue knows, AppleScript asks it for the
 * address of the tab you're on. macOS asks once per browser whether Cue may do that
 * (NSAppleEventsUsageDescription in electron-builder.yml).
 */

/** The keys as people see them: ⌃⌥⌘L. */
export const SAVE_TAB_KEYS = shortcutKeys(SAVE_TAB_SHORTCUT).join('')

type Dictionary = 'safari' | 'chromium' | 'none'

interface Browser {
  name: string
  /** How the browser's AppleScript names the tab you're on; `none` can't be asked at all. */
  speaks: Dictionary
}

/** Browsers by bundle id. Each family words "the tab you're on" its own way. */
export const BROWSERS: Record<string, Browser> = {
  'com.apple.Safari': { name: 'Safari', speaks: 'safari' },
  'com.apple.SafariTechnologyPreview': { name: 'Safari Technology Preview', speaks: 'safari' },
  'com.google.Chrome': { name: 'Chrome', speaks: 'chromium' },
  'com.google.Chrome.beta': { name: 'Chrome Beta', speaks: 'chromium' },
  'com.google.Chrome.dev': { name: 'Chrome Dev', speaks: 'chromium' },
  'com.google.Chrome.canary': { name: 'Chrome Canary', speaks: 'chromium' },
  'org.chromium.Chromium': { name: 'Chromium', speaks: 'chromium' },
  'com.brave.Browser': { name: 'Brave', speaks: 'chromium' },
  'com.brave.Browser.beta': { name: 'Brave Beta', speaks: 'chromium' },
  'com.brave.Browser.nightly': { name: 'Brave Nightly', speaks: 'chromium' },
  'com.microsoft.edgemac': { name: 'Edge', speaks: 'chromium' },
  'com.microsoft.edgemac.Beta': { name: 'Edge Beta', speaks: 'chromium' },
  'com.microsoft.edgemac.Dev': { name: 'Edge Dev', speaks: 'chromium' },
  'com.microsoft.edgemac.Canary': { name: 'Edge Canary', speaks: 'chromium' },
  'company.thebrowser.Browser': { name: 'Arc', speaks: 'chromium' },
  'company.thebrowser.dia': { name: 'Dia', speaks: 'chromium' },
  'com.vivaldi.Vivaldi': { name: 'Vivaldi', speaks: 'chromium' },
  'com.operasoftware.Opera': { name: 'Opera', speaks: 'chromium' },
  'ai.perplexity.comet': { name: 'Comet', speaks: 'chromium' },
  // Firefox and the browsers built on it have no AppleScript for their tabs.
  'org.mozilla.firefox': { name: 'Firefox', speaks: 'none' },
  'org.mozilla.firefoxdeveloperedition': { name: 'Firefox Developer Edition', speaks: 'none' },
  'org.mozilla.nightly': { name: 'Firefox Nightly', speaks: 'none' },
  'app.zen-browser.zen': { name: 'Zen', speaks: 'none' }
}

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  /** Stopped because it ran past its time. */
  timedOut: boolean
}

/** Runs a program (no shell) and reports how it went. Tests pass a fake. */
export type Run = (file: string, args: string[], timeout: number) => Promise<RunResult>

export const run: Run = (file, args, timeout) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr, timedOut: !!error && error.killed === true })
    })
  })

export type Capture = { ok: true; url: string } | { ok: false; message: string }

const LSAPPINFO = '/usr/bin/lsappinfo'
const OSASCRIPT = '/usr/bin/osascript'
const LOOKUP_TIMEOUT = 2000
// Longer than a browser needs to answer: the first time, macOS holds the question until
// you've said whether Cue may ask, and the wait includes reading that.
const ASK_TIMEOUT = 10_000

/** The app in front's bundle id, from `lsappinfo info -only bundleid`'s output. */
export function parseBundleId(output: string): string | null {
  return output.match(/"(?:CFBundleIdentifier|bundleID)"\s*=\s*"([^"]+)"/i)?.[1] ?? null
}

export async function frontBundleId(exec: Run = run): Promise<string | null> {
  const front = await exec(LSAPPINFO, ['front'], LOOKUP_TIMEOUT)
  const asn = front.ok ? front.stdout.match(/ASN:[0-9a-fx-]+:?/i)?.[0] : undefined
  if (!asn) return null
  const info = await exec(LSAPPINFO, ['info', '-only', 'bundleid', asn], LOOKUP_TIMEOUT)
  return info.ok ? parseBundleId(info.stdout) : null
}

/**
 * The AppleScript that returns the address of the tab you're on, or "" without a window.
 * Addressed by bundle id, so it reaches the browser in front even if two share a name.
 */
export function tabScript(bundleId: string, speaks: Exclude<Dictionary, 'none'>): string[] {
  const tab = speaks === 'safari' ? 'current tab' : 'active tab'
  return [
    `tell application id "${bundleId}"`,
    'if (count of windows) is 0 then return ""',
    `set tabURL to URL of ${tab} of front window`,
    'end tell',
    'if tabURL is missing value then return ""',
    'return tabURL'
  ]
}

/** Save the tab of the browser in front, or say in a sentence why there's nothing to save. */
export async function captureFrontTab(exec: Run = run): Promise<Capture> {
  const bundleId = await frontBundleId(exec)
  const browser = bundleId ? BROWSERS[bundleId] : undefined
  if (!bundleId || !browser) return { ok: false, message: `Press ${SAVE_TAB_KEYS} with a browser in front to save the tab you’re on.` }
  const { name, speaks } = browser
  if (speaks === 'none') return { ok: false, message: `${name} doesn’t share its tabs with other apps, so Cue can’t save from it.` }

  const script = tabScript(bundleId, speaks).flatMap((line) => ['-e', line])
  const result = await exec(OSASCRIPT, script, ASK_TIMEOUT)
  if (result.ok) {
    const url = result.stdout.trim()
    // A new tab or a browser's own pages (chrome://, favorites://) aren't worth a line.
    if (/^(https?|file):/i.test(url)) return { ok: true, url }
    return { ok: false, message: `${name} has no page open.` }
  }
  if (result.timedOut) return { ok: false, message: `${name} didn’t answer. Try again in a moment.` }
  // AppleScript error numbers: -1743 not allowed, -1728 no such window or tab, -1708 and
  // -2741 the browser doesn't know the words.
  const code = result.stderr.match(/\((-?\d+)\)\s*$/m)?.[1]
  if (code === '-1743') {
    return { ok: false, message: `Cue isn’t allowed to read ${name}’s tabs. Turn it on in System Settings ▸ Privacy & Security ▸ Automation.` }
  }
  if (code === '-1728') return { ok: false, message: `${name} has no page open.` }
  if (code === '-1708' || code === '-2741' || code === '-2740') {
    return { ok: false, message: `${name} doesn’t share its tabs with other apps, so Cue can’t save from it.` }
  }
  return { ok: false, message: `Couldn’t read the tab from ${name}.` }
}
