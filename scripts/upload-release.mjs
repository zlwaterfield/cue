/**
 * `pnpm release:upload`: put the build from `pnpm release` on GitHub as release v<version>,
 * so people can download it from https://github.com/zlwaterfield/cue/releases/latest.
 *
 * It uploads the DMG people download, plus the zip, its blockmap and latest-mac.yml that
 * an auto-updater reads. The release is tagged at the current commit, which has to be
 * pushed first, and a version like 1.0.0-beta.1 is marked as a pre-release. It needs the
 * GitHub CLI signed in (`gh auth login`).
 *
 *   pnpm release:upload            publish the release
 *   pnpm release:upload --draft    upload it as a draft to look over on GitHub first
 *   pnpm release:upload --dry-run  check everything and say what it would do
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'release')
const draft = process.argv.includes('--draft')
const dryRun = process.argv.includes('--dry-run')

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
const capture = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' })
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' })
const succeeds = (command, args) => {
  try {
    capture(command, args)
    return true
  } catch {
    return false
  }
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = `v${version}`
const files = [
  `Cue-${version}-arm64.dmg`,
  `Cue-${version}-arm64-mac.zip`,
  `Cue-${version}-arm64-mac.zip.blockmap`,
  'latest-mac.yml'
]
const missing = files.filter((file) => !existsSync(join(out, file)))
if (missing.length) fail(`release/ is missing ${missing.join(', ')}. Build Cue ${version} with \`pnpm release\` first.`)
if (!readFileSync(join(out, 'latest-mac.yml'), 'utf8').includes(`version: ${version}\n`)) {
  fail(`release/latest-mac.yml is for another version. Build Cue ${version} again with \`pnpm release\`.`)
}

// Only a signed, notarized DMG goes up: `pnpm dist` makes one that Gatekeeper blocks.
const dmg = join(out, files[0])
if (
  !succeeds('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', dmg]) ||
  !succeeds('xcrun', ['stapler', 'validate', dmg])
) {
  fail(`${files[0]} isn't signed and notarized. Build it with \`pnpm release\`, not \`pnpm dist\`.`)
}

if (!succeeds('gh', ['auth', 'status'])) fail('Sign in to GitHub first with `gh auth login`.')
if (succeeds('gh', ['release', 'view', tag])) {
  fail(`GitHub already has a release ${tag}. Raise the version in package.json, or delete that release on GitHub.`)
}

const commit = capture('git', ['rev-parse', 'HEAD']).trim()
run('git', ['fetch', '--quiet', 'origin'])
if (!capture('git', ['branch', '--remotes', '--contains', commit]).trim()) {
  fail(`The current commit ${commit.slice(0, 7)} isn't on GitHub yet. Push it, then run this again.`)
}
if (capture('git', ['status', '--porcelain']).trim()) console.warn('\nNote: the working tree has uncommitted changes.')

const prerelease = version.includes('-')
const args = [
  'release', 'create', tag, ...files.map((file) => join(out, file)),
  '--target', commit, '--title', `Cue ${version}`, '--generate-notes',
  ...(prerelease ? ['--prerelease'] : []),
  ...(draft ? ['--draft'] : [])
]
const kind = [draft && 'draft', prerelease && 'pre-release'].filter(Boolean).join(' ') || 'release'
console.log(`\nCue ${version}: ${kind} ${tag} at ${commit.slice(0, 7)}, with ${files.join(', ')}\n`)
if (dryRun) {
  console.log(`Dry run, so nothing was uploaded. Without --dry-run it runs:\n\n  gh ${args.join(' ')}\n`)
  process.exit(0)
}
run('gh', args)
