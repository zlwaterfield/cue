import { describe, expect, it } from 'vitest'
import { BROWSERS, captureFrontTab, parseBundleId, tabScript, type Run, type RunResult } from '../../src/main/capture'

const ok = (stdout: string): RunResult => ({ ok: true, stdout, stderr: '', timedOut: false })
const failed = (stderr: string, timedOut = false): RunResult => ({ ok: false, stdout: '', stderr, timedOut })

/** A Mac with `bundleId` in front, whose browser answers AppleScript with `answer`. */
function mac(bundleId: string | null, answer: RunResult = ok('')): { exec: Run; calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = []
  const exec: Run = async (file, args) => {
    calls.push([file, args])
    if (file.endsWith('lsappinfo') && args[0] === 'front') return ok('ASN:0x0-0x2bb2bb:\n')
    if (file.endsWith('lsappinfo')) return ok(bundleId ? `"CFBundleIdentifier"="${bundleId}"\n` : '[ NULL ]\n')
    return answer
  }
  return { exec, calls }
}

describe('saving the front browser tab', () => {
  it('reads the bundle id lsappinfo prints', () => {
    expect(parseBundleId('"CFBundleIdentifier"="com.apple.Safari"\n')).toBe('com.apple.Safari')
    expect(parseBundleId('"bundleID"="com.google.Chrome"')).toBe('com.google.Chrome')
    expect(parseBundleId('[ NULL ]')).toBeNull()
    expect(parseBundleId('')).toBeNull()
  })

  it('asks the app lsappinfo says is in front, with no shell', async () => {
    const { exec, calls } = mac('com.apple.Safari', ok('https://example.com/\n'))
    expect(await captureFrontTab(exec)).toEqual({ ok: true, url: 'https://example.com/' })
    expect(calls[0]).toEqual(['/usr/bin/lsappinfo', ['front']])
    expect(calls[1]).toEqual(['/usr/bin/lsappinfo', ['info', '-only', 'bundleid', 'ASN:0x0-0x2bb2bb:']])
    expect(calls[2][0]).toBe('/usr/bin/osascript')
    expect(calls[2][1].filter((_, i) => i % 2 === 0).every((flag) => flag === '-e')).toBe(true)
    expect(calls[2][1].join('\n')).toContain('tell application id "com.apple.Safari"')
  })

  it('words the question the way each browser family does', () => {
    expect(tabScript('com.apple.Safari', 'safari').join('\n')).toContain('URL of current tab of front window')
    expect(tabScript('com.google.Chrome', 'chromium').join('\n')).toContain('URL of active tab of front window')
    for (const [id, browser] of Object.entries(BROWSERS)) {
      if (id.startsWith('com.apple.')) expect(browser.speaks, id).toBe('safari')
      else if (id.startsWith('org.mozilla.') || id === 'app.zen-browser.zen') expect(browser.speaks, id).toBe('none')
      else expect(browser.speaks, id).toBe('chromium')
    }
  })

  it('saves from Chromium browsers by bundle id', async () => {
    for (const id of ['com.google.Chrome', 'com.brave.Browser', 'com.microsoft.edgemac', 'company.thebrowser.Browser', 'com.vivaldi.Vivaldi']) {
      const { exec, calls } = mac(id, ok('https://example.com/page\n'))
      expect(await captureFrontTab(exec), id).toEqual({ ok: true, url: 'https://example.com/page' })
      expect(calls[2][1].join('\n')).toContain(`tell application id "${id}"`)
    }
  })

  it('says why nothing was saved', async () => {
    const message = async (bundleId: string | null, answer?: RunResult) => {
      const result = await captureFrontTab(mac(bundleId, answer).exec)
      return result.ok ? null : result.message
    }
    expect(await message('com.apple.finder')).toBe('Press ⌃⌥⌘L with a browser in front to save the tab you’re on.')
    expect(await message(null)).toBe('Press ⌃⌥⌘L with a browser in front to save the tab you’re on.')
    expect(await message('org.mozilla.firefox')).toBe('Firefox doesn’t share its tabs with other apps, so Cue can’t save from it.')
    // No window, an empty tab, a browser's own page.
    expect(await message('com.apple.Safari', ok('\n'))).toBe('Safari has no page open.')
    expect(await message('com.google.Chrome', ok('chrome://newtab/\n'))).toBe('Chrome has no page open.')
    expect(await message('com.apple.Safari', failed('31:63: execution error: Safari got an error: Can’t get current tab of window 1. (-1728)\n'))).toBe(
      'Safari has no page open.'
    )
    expect(await message('com.google.Chrome', failed('execution error: Not authorized to send Apple events to Google Chrome. (-1743)\n'))).toBe(
      'Cue isn’t allowed to read Chrome’s tabs. Turn it on in System Settings ▸ Privacy & Security ▸ Automation.'
    )
    expect(await message('company.thebrowser.dia', failed('0:60: syntax error: Expected end of line but found identifier. (-2741)\n'))).toBe(
      'Dia doesn’t share its tabs with other apps, so Cue can’t save from it.'
    )
    expect(await message('com.apple.Safari', failed('', true))).toBe('Safari didn’t answer. Try again in a moment.')
    expect(await message('com.apple.Safari', failed('something else (-10000)'))).toBe('Couldn’t read the tab from Safari.')
  })

  it('never asks Firefox, which has nothing to answer with', async () => {
    const { exec, calls } = mac('org.mozilla.firefox')
    await captureFrontTab(exec)
    expect(calls.some(([file]) => file.endsWith('osascript'))).toBe(false)
  })
})
