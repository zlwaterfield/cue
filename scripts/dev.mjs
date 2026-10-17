/**
 * `pnpm dev`: run electron-vite against a branded copy of Electron.app on macOS.
 *
 * In development Cue runs inside Electron's own bundle, and macOS takes the Dock,
 * ⌘Tab and menu-bar name from that bundle's Info.plist, so it would say "Electron"
 * with Electron's icon. This copies the bundle once per Electron version to
 * node_modules/.cache/cue-dev/, renames it "Cue Dev", gives it Cue's icon, re-signs
 * it ad hoc (the Info.plist is covered by the signature), and points electron-vite
 * at it. Packaged builds are unaffected.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const NAME = 'Cue Dev'
const BUNDLE_ID = 'com.zlwaterfield.cue.dev'

function brandedElectron() {
  const require = createRequire(import.meta.url)
  const electronBinary = require('electron') // …/Electron.app/Contents/MacOS/Electron
  const source = resolve(dirname(electronBinary), '../..')
  const version = require('electron/package.json').version
  const cache = resolve('node_modules/.cache/cue-dev')
  const app = join(cache, `${NAME}.app`)
  const stamp = join(cache, 'stamp.json')
  const icon = resolve('build/icon.icns')
  const wanted = JSON.stringify({ version, icon: readFileSync(icon).length })

  if (!existsSync(app) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== wanted) {
    rmSync(cache, { recursive: true, force: true })
    mkdirSync(cache, { recursive: true })
    execFileSync('ditto', [source, app])
    const plist = join(app, 'Contents/Info.plist')
    for (const [key, value] of [
      ['CFBundleName', NAME],
      ['CFBundleDisplayName', NAME],
      ['CFBundleIdentifier', BUNDLE_ID]
    ]) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
    }
    copyFileSync(icon, join(app, 'Contents/Resources/electron.icns'))
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
    writeFileSync(stamp, wanted)
  }
  return join(app, 'Contents/MacOS/Electron')
}

const env = { ...process.env }
if (process.platform === 'darwin') {
  try {
    env.ELECTRON_EXEC_PATH = brandedElectron()
  } catch (error) {
    console.warn(`Couldn't brand the dev app (${error.message}); running plain Electron.`)
  }
}

const child = spawn('electron-vite', ['dev', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
