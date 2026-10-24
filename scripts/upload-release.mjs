/**
 * `pnpm release:upload`: put the build from `pnpm release` on GitHub as release v<version>,
 * so people can download it from https://github.com/zlwaterfield/cue/releases/latest.
 *
 * It uploads the DMG people download, plus the zip, its blockmap and latest-mac.yml that
 * an auto-updater reads. The release is tagged at the commit the build was made from
 * (release/build.json), which has to be committed and pushed, and a version like
 * 1.0.0-beta.1 is marked as a pre-release. It needs the GitHub CLI signed in (`gh auth login`).
 *
 * The release notes are written by Claude from the pull requests merged since the last
 * release, and saved to release/notes-<version>.md. Edit that file before you confirm and
 * the release uses your edits; run again and it reuses the file (`--new-notes` rewrites it).
 * Claude needs ANTHROPIC_API_KEY; without it, GitHub lists the commits instead.
 *
 *   pnpm release:upload            write the notes, then publish once you confirm
 *   pnpm release:upload --draft    upload it as a draft to look over on GitHub first
 *   pnpm release:upload --dry-run  check everything and write the notes, upload nothing
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import Anthropic from '@anthropic-ai/sdk'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'release')
const draft = process.argv.includes('--draft')
const dryRun = process.argv.includes('--dry-run')
const newNotes = process.argv.includes('--new-notes')

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

// The release points at the source the build was made from, not at whatever is checked out
// now, so its code and notes match what people download.
const buildFile = join(out, 'build.json')
if (!existsSync(buildFile)) fail('release/ has no build.json, so the build’s commit is unknown. Build it again with `pnpm release`.')
const build = JSON.parse(readFileSync(buildFile, 'utf8'))
if (build.version !== version) fail(`release/ holds Cue ${build.version}, not ${version}. Build it again with \`pnpm release\`.`)
if (build.dirty) fail('This build was made with uncommitted changes. Commit them, then build again with `pnpm release`.')
const { commit } = build
if (commit !== capture('git', ['rev-parse', 'HEAD']).trim()) {
  console.warn(`\nNote: the build is from ${commit.slice(0, 7)}, not the checked-out commit. The release points at ${commit.slice(0, 7)}.`)
}
run('git', ['fetch', '--quiet', '--tags', 'origin'])
if (!capture('git', ['branch', '--remotes', '--contains', commit]).trim()) {
  fail(`The build's commit ${commit.slice(0, 7)} isn't on GitHub yet. Push it, then run this again.`)
}

// The notes: what changed since the last release tag, or since the start for the first one.
const notesFile = join(out, `notes-${version}.md`)
let previous = ''
try {
  previous = capture('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*', `${commit}^`]).trim()
} catch {}
if (newNotes || !existsSync(notesFile)) await writeNotes()
const hasNotes = existsSync(notesFile)
if (hasNotes) console.log(`\n${readFileSync(notesFile, 'utf8').trim()}\n\n(${relative(root, notesFile)})`)

async function writeNotes() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('\nNo ANTHROPIC_API_KEY, so the notes will be GitHub’s list of commits.')
    return
  }
  const range = previous ? `${previous}..${commit}` : commit
  const subjects = capture('git', ['log', '--format=%s', range]).trim().split('\n').filter(Boolean)
  // Each change is a squash-merged pull request; its description says what it does and why.
  const changes = subjects.map((subject) => {
    const number = subject.match(/\(#(\d+)\)$/)?.[1]
    if (!number) return `## ${subject}`
    const { title, body } = JSON.parse(capture('gh', ['pr', 'view', number, '--json', 'title,body']))
    return `## ${title} (#${number})\n\n${body}`
  })
  console.log(`\nWriting the notes from ${changes.length} changes since ${previous || 'the start'}…`)

  const client = new Anthropic()
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'You write release notes for Cue, a keyboard-first app for daily notes and to-dos. These notes go on a ' +
      'GitHub release whose download is the Mac app, and they are read by people deciding whether to ' +
      'download or update it. Write them in plain, direct English, the way a careful person would tell a ' +
      'friend what is new: what they can now do and why it matters to them, not how it was built. Lead with ' +
      'the changes people will notice most. Group them under a few short "###" headings only if there are ' +
      'enough to need it. Mention iPhone changes only where they affect someone using the Mac app (for ' +
      'example sync, or sharing between the two). Leave out changes with no effect on people using the app: ' +
      'build scripts, release tooling, the website, the README, refactors and tests. No marketing language, ' +
      'no exclamation marks, no emoji, no title (GitHub shows the release name above the notes), and no ' +
      'pull request numbers. Reply with only the notes, in Markdown.',
    messages: [
      {
        role: 'user',
        content:
          `Cue ${version}${previous ? `, the first release since ${previous}` : ', the first public release'}. ` +
          `The changes, oldest last:\n\n${changes.join('\n\n')}`
      }
    ]
  })
  if (response.stop_reason === 'refusal') fail(`Claude declined to write the notes. Write ${relative(root, notesFile)} yourself, then run again.`)
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) fail(`Claude returned no notes. Run again, or write ${relative(root, notesFile)} yourself.`)
  writeFileSync(notesFile, `${text}\n`)
}

const prerelease = version.includes('-')
const args = [
  'release', 'create', tag, ...files.map((file) => join(out, file)),
  '--target', commit, '--title', `Cue ${version}`,
  ...(hasNotes ? ['--notes-file', notesFile] : ['--generate-notes']),
  ...(prerelease ? ['--prerelease'] : []),
  ...(draft ? ['--draft'] : [])
]
const kind = [draft && 'draft', prerelease && 'pre-release'].filter(Boolean).join(' ') || 'release'
console.log(`\nCue ${version}: ${kind} ${tag} at ${commit.slice(0, 7)}, with ${files.join(', ')}\n`)
if (dryRun) {
  console.log(`Dry run, so nothing was uploaded. Without --dry-run it runs:\n\n  gh ${args.join(' ')}\n`)
  process.exit(0)
}
if (!draft) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question(
    `Publish ${tag}${hasNotes ? ' with these notes (edit the file first if you like)' : ''}? [y/N] `
  )
  prompt.close()
  if (answer.trim().toLowerCase() !== 'y') fail('Not published.')
}
run('gh', args)
