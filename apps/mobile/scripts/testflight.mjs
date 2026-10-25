/**
 * `pnpm testflight`: archive a Release build of Cue and upload it to App Store Connect,
 * where it appears in TestFlight once Apple has processed it (usually 5–15 minutes).
 *
 * It reads the same files a Release build does: `.env.production.local` for the sync
 * server and `.env.local` for signing (CUE_APPLE_TEAM_ID, and CUE_IOS_BUNDLE_ID if set).
 * The native project is regenerated from app.config.ts, so the build always matches it,
 * and each build gets a new build number from the time (CUE_IOS_BUILD_NUMBER overrides).
 * Signing is automatic: Xcode creates the certificate, identifiers and profiles it needs,
 * and uploads with the Apple ID signed in under Xcode → Settings → Accounts.
 *
 *   pnpm testflight              archive and upload
 *   pnpm testflight --no-upload  archive and export the .ipa only (ios/build/testflight)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upload = !process.argv.includes('--no-upload')

// Expo's order for a production build: the first file to set a variable wins.
for (const file of ['.env.production.local', '.env.local', '.env.production', '.env']) {
  if (existsSync(join(root, file))) process.loadEnvFile(join(root, file))
}

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

const team = process.env.CUE_APPLE_TEAM_ID
if (!team) fail('Set CUE_APPLE_TEAM_ID in mobile/.env.local to your paid team’s ID (developer.apple.com → Membership).')
const url = process.env.CUE_SUPABASE_URL ?? ''
if (!url.startsWith('https://') || !process.env.CUE_SUPABASE_KEY) {
  fail('mobile/.env.production.local needs the hosted sync server: CUE_SUPABASE_URL (https://…) and CUE_SUPABASE_KEY.')
}

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const build =
  process.env.CUE_IOS_BUILD_NUMBER ||
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}.${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`

const env = { ...process.env, NODE_ENV: 'production', CUE_IOS_BUILD_NUMBER: build }
const run = (command, args) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })

const out = join(root, 'ios/build/testflight')
const archive = join(out, `Cue-${build}.xcarchive`)
const options = join(out, 'ExportOptions.plist')

console.log(`\nCue ${build}: team ${team}, sync ${new URL(url).host}, share sheet ${process.env.CUE_SHARE_EXTENSION === 'off' ? 'off' : 'on'}\n`)

run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean', '--no-install'])
run('pod', ['install', '--project-directory=ios'])

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
run('xcodebuild', [
  'archive',
  '-workspace', 'ios/Cue.xcworkspace',
  '-scheme', 'Cue',
  '-configuration', 'Release',
  '-destination', 'generic/platform=iOS',
  '-archivePath', archive,
  '-allowProvisioningUpdates'
])

writeFileSync(
  options,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${upload ? 'upload' : 'export'}</string>
  <key>teamID</key><string>${team}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
`
)
run('xcodebuild', [
  '-exportArchive',
  '-archivePath', archive,
  '-exportOptionsPlist', options,
  '-exportPath', out,
  '-allowProvisioningUpdates'
])

console.log(
  upload
    ? `\nUploaded Cue ${build}. It shows in App Store Connect → TestFlight once Apple has processed it.\n`
    : `\nExported ${join(out, 'Cue.ipa')}.\n`
)
