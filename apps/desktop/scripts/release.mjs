/**
 * `pnpm release`: build Cue for distribution — signed with your Developer ID, notarized by
 * Apple and stapled, so it opens on any Mac without a Gatekeeper warning. The results are in
 * release/, and `pnpm release:upload` puts them on GitHub.
 *
 * It needs, once per Mac:
 * - A "Developer ID Application" certificate in the keychain (Xcode → Settings → Accounts →
 *   Manage Certificates → + → Developer ID Application). With more than one, CUE_APPLE_TEAM_ID
 *   picks which.
 * - Notarization credentials saved as a keychain profile, by default `cue-notary`
 *   (CUE_NOTARY_PROFILE picks another):
 *     xcrun notarytool store-credentials cue-notary --apple-id <Apple ID> --team-id <team ID>
 *   which asks for an app-specific password from account.apple.com.
 * - The hosted sync server in `.env.production.local` (docs/SYNC.md).
 *
 * It builds what's committed, so uncommitted changes stop it before any of that: `pnpm
 * release:upload` won't publish a build made from them. `pnpm release --dirty` builds one
 * anyway, to try out yourself.
 *
 * What it does, after checking all of the above:
 * 1. electron-vite builds the app, with updates turned on — this is the only kind of build
 *    that updates itself (src/main/updates.ts).
 * 2. electron-builder signs it with the hardened runtime, has Apple notarize it, staples the
 *    ticket, and packs the DMG, the zip the updater downloads and latest-mac.yml.
 * 3. The DMG is notarized and stapled as well, since it's what people download.
 * 4. Gatekeeper is asked about both, the way a Mac that has never seen them will be.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from 'electron-vite'
import { fixBins } from './bins.mjs'
import { app, bin, capture, dmg, fail, manifest, out, root, run, since, succeeds, uploads, version, zip } from './common.mjs'

const started = Date.now()
const profile = process.env.CUE_NOTARY_PROFILE || 'cue-notary'
const allowDirty = process.argv.includes('--dirty')
const notary = ['--keychain-profile', profile]

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
    team
      ? `No "Developer ID Application" certificate for team ${team} in the keychain.` +
          (identities.length ? ` There is one for: ${identities.join(', ')}.` : '')
      : 'No "Developer ID Application" certificate in the keychain. Create one in Xcode → Settings → Accounts → ' +
          'Manage Certificates → + → Developer ID Application.'
  )
}
if (identities.length > 1 && !team) {
  console.warn(`\nNote: ${identities.length} Developer ID certificates in the keychain; using the first. CUE_APPLE_TEAM_ID picks another.`)
}

if (!succeeds('xcrun', ['notarytool', 'history', ...notary])) {
  fail(
    `No notarization credentials in the keychain profile "${profile}". Save them with:\n\n` +
      `  xcrun notarytool store-credentials ${profile} --apple-id <Apple ID> --team-id <team ID>\n\n` +
      'It asks for an app-specific password, which you make at account.apple.com → Sign-In and Security.'
  )
}

// Saved with the build, so `pnpm release:upload` tags the commit it was built from.
const commit = capture('git', ['rev-parse', 'HEAD']).trim()
// `pnpm release:upload` refuses a build made from a dirty tree, since the release points at a
// commit that isn't what was built. Saying so now costs a second; saying it afterwards wastes
// the signing and notarizing in between. --dirty builds one anyway, to try out locally.
const dirty = Boolean(capture('git', ['status', '--porcelain']).trim())
if (dirty && !allowDirty) {
  fail(
    'The working tree has uncommitted changes, and `pnpm release:upload` won’t publish a build made ' +
      'from one. Commit them and run this again, or `pnpm release --dirty` for a build to try out yourself.'
  )
}
if (dirty) console.warn('\nNote: the working tree has uncommitted changes, so `pnpm release:upload` won’t publish this build.')

console.log(`\nCue ${version}: signing as "${identity}", notarizing with "${profile}", sync ${new URL(env.CUE_SUPABASE_URL).host}\n`)

rmSync(out, { recursive: true, force: true })

// Some commands come out of `pnpm install` without their executable bit, which stops the
// package.json scripts this one doesn't go through (bins.mjs).
fixBins()

// CUE_UPDATES=1 makes this build check GitHub for updates (src/main/updates.ts); builds from
// `pnpm dist` or `pnpm package` don't.
run(process.execPath, [bin('electron-vite'), 'build'], { ...process.env, CUE_UPDATES: '1' })

// With APPLE_KEYCHAIN_PROFILE set, electron-builder notarizes and staples the app itself,
// before it packs the DMG and zip. This is the slow part: Apple takes minutes.
console.log(`\nSigning and notarizing Cue.app, then packing ${dmg}. Apple takes a few minutes…\n`)
run(
  process.execPath,
  [
    bin('electron-builder'), '--mac', '--publish', 'never',
    `-c.mac.identity=${identity}`, '-c.mac.hardenedRuntime=true', '-c.dmg.sign=true'
  ],
  { ...process.env, APPLE_KEYCHAIN_PROFILE: profile }
)

// Everything `pnpm release:upload` publishes has to be here, under the names it looks for.
// latest-mac.yml is the updater's manifest, which electron-builder writes only when
// electron-builder.yml names the repository. Checking now, rather than at upload time, saves
// the minutes the DMG's notarization is about to take.
const missing = uploads.filter((file) => !existsSync(join(out, file)))
if (missing.length) {
  fail(
    `The build is missing ${missing.join(', ')}.` +
      (missing.includes(manifest) ? ` electron-builder writes ${manifest} from the \`publish\` block in electron-builder.yml.` : '')
  )
}

// The DMG is what people download, so it's notarized and stapled as well.
console.log(`\nNotarizing ${dmg}…`)
let result
try {
  result = JSON.parse(capture('xcrun', ['notarytool', 'submit', join(out, dmg), ...notary, '--wait', '--output-format', 'json']))
} catch (error) {
  fail(`Couldn’t notarize ${dmg}: ${(error.stderr || error.message).trim()}`)
}
if (result.status !== 'Accepted') {
  run('xcrun', ['notarytool', 'log', result.id, ...notary])
  fail(`Apple didn't accept ${dmg} (${result.status}). The log above says why.`)
}
run('xcrun', ['stapler', 'staple', join(out, dmg)])

// What a Mac seeing these for the first time will decide: the app runs, and the DMG opens on
// its own signature rather than on anything this Mac happens to know.
console.log('\nChecking with Gatekeeper…')
run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', join(out, dmg)])
run('xcrun', ['stapler', 'validate', join(out, dmg)])

// What `pnpm release:upload` tags and publishes, and refuses to if this build was dirty.
writeFileSync(join(out, 'build.json'), `${JSON.stringify({ version, commit, dirty }, null, 2)}\n`)

const sha256 = (file) => createHash('sha256').update(readFileSync(join(out, file))).digest('hex')
console.log(`\nCue ${version} is ready, in ${since(started)}:\n`)
for (const file of [dmg, zip]) console.log(`  release/${file}\n    sha256 ${sha256(file)}`)
console.log('\nTry it, then publish it with `pnpm release:upload`.\n')
