/**
 * `pnpm release`: build Cue for distribution — signed with your Developer ID, notarized by
 * Apple and stapled, so it opens on any Mac without a Gatekeeper warning.
 *
 * It needs, once per Mac:
 * - A "Developer ID Application" certificate in the keychain (Xcode → Settings → Accounts →
 *   Manage Certificates → + → Developer ID Application).
 * - Notarization credentials saved as a keychain profile, by default `cue-notary`
 *   (CUE_NOTARY_PROFILE picks another):
 *     xcrun notarytool store-credentials cue-notary --apple-id <Apple ID> --team-id <team ID>
 *   which asks for an app-specific password from account.apple.com.
 * - The hosted sync server in `.env.production.local` (docs/SYNC.md).
 *
 * electron-builder signs the app with the hardened runtime and notarizes it, then builds the
 * DMG and zip. This script signs, notarizes and staples the DMG too, and checks both with
 * Gatekeeper. The results are in release/.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadEnv } from 'electron-vite'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'release')
const profile = process.env.CUE_NOTARY_PROFILE || 'cue-notary'

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
const capture = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' })
const run = (command, args, env = process.env) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })

// The sync server, read the same way electron.vite.config.mts reads it for the build.
const env = { ...loadEnv('production', root, 'CUE_'), ...process.env }
if (!env.CUE_SUPABASE_URL?.startsWith('https://') || !env.CUE_SUPABASE_KEY) {
  fail('.env.production.local needs the hosted sync server: CUE_SUPABASE_URL (https://…) and CUE_SUPABASE_KEY.')
}

// The Developer ID certificate. electron-builder wants its name without the type prefix.
const identities = capture('security', ['find-identity', '-v', '-p', 'codesigning'])
  .split('\n')
  .map((line) => line.match(/"Developer ID Application: (.+)"/)?.[1])
  .filter(Boolean)
const team = process.env.CUE_APPLE_TEAM_ID
const identity = identities.find((name) => !team || name.endsWith(`(${team})`))
if (!identity) {
  fail(
    'No "Developer ID Application" certificate in the keychain. Create one in Xcode → Settings → Accounts → ' +
      'Manage Certificates → + → Developer ID Application.'
  )
}

try {
  capture('xcrun', ['notarytool', 'history', '--keychain-profile', profile])
} catch {
  fail(
    `No notarization credentials in the keychain profile "${profile}". Save them with:\n\n` +
      `  xcrun notarytool store-credentials ${profile} --apple-id <Apple ID> --team-id <team ID>\n\n` +
      'It asks for an app-specific password, which you make at account.apple.com → Sign-In and Security.'
  )
}

// Saved with the build, so `pnpm release:upload` tags the commit it was built from.
const commit = capture('git', ['rev-parse', 'HEAD']).trim()
const dirty = Boolean(capture('git', ['status', '--porcelain']).trim())
if (dirty) console.warn('\nNote: the working tree has uncommitted changes, so `pnpm release:upload` won’t publish this build.')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
console.log(`\nCue ${version}: signing as "${identity}", notarizing with "${profile}", sync ${new URL(env.CUE_SUPABASE_URL).host}\n`)

rmSync(out, { recursive: true, force: true })
run('npx', ['electron-vite', 'build'])
// With APPLE_KEYCHAIN_PROFILE set, electron-builder notarizes and staples the app before
// it packs the DMG and zip.
run(
  'npx',
  [
    'electron-builder', '--mac', '--publish', 'never',
    `-c.mac.identity=${identity}`, '-c.mac.hardenedRuntime=true', '-c.dmg.sign=true'
  ],
  { ...process.env, APPLE_KEYCHAIN_PROFILE: profile }
)

const files = readdirSync(out)
const dmg = files.find((file) => file.endsWith('.dmg'))
const zip = files.find((file) => file.endsWith('.zip'))
if (!dmg || !zip) fail(`Expected a .dmg and a .zip in release/, found: ${files.join(', ')}`)

// The DMG is what people download, so it's notarized and stapled as well.
console.log(`\nNotarizing ${dmg}…`)
const result = JSON.parse(
  capture('xcrun', ['notarytool', 'submit', join(out, dmg), '--keychain-profile', profile, '--wait', '--output-format', 'json'])
)
if (result.status !== 'Accepted') {
  run('xcrun', ['notarytool', 'log', result.id, '--keychain-profile', profile])
  fail(`Apple didn't accept ${dmg} (${result.status}). The log above says why.`)
}
run('xcrun', ['stapler', 'staple', join(out, dmg)])

console.log('\nChecking with Gatekeeper…')
run('spctl', ['--assess', '--type', 'execute', '--verbose=2', join(out, 'mac-arm64/Cue.app')])
run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', join(out, dmg)])
run('xcrun', ['stapler', 'validate', join(out, dmg)])

writeFileSync(join(out, 'build.json'), `${JSON.stringify({ version, commit, dirty }, null, 2)}\n`)

const sha256 = (file) => createHash('sha256').update(readFileSync(join(out, file))).digest('hex')
console.log(`\nCue ${version} is ready:\n`)
for (const file of [dmg, zip]) console.log(`  release/${file}\n    sha256 ${sha256(file)}`)
console.log('')
