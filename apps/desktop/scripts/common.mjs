/**
 * What `pnpm release` and `pnpm release:upload` both need: where a build goes and what it's
 * called, running a command without burying its failure in a stack trace, and finding the
 * commands in node_modules without going through the shell.
 *
 * The two scripts agree on the file names here, so what `pnpm release` builds and checks is
 * exactly what `pnpm release:upload` publishes.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'

export const root = resolve(import.meta.dirname, '..')
export const out = join(root, 'release')
export const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// What electron-builder makes from electron-builder.yml: a DMG to download, a zip for the
// updater, the blockmap that lets it download only what changed, and latest-mac.yml, the
// manifest that tells it a new version exists. Apple Silicon only, as the `mac.target` says.
export const app = join(out, 'mac-arm64/Cue.app')
export const dmg = `Cue-${version}-arm64.dmg`
export const zip = `Cue-${version}-arm64-mac.zip`
export const blockmap = `${zip}.blockmap`
export const manifest = 'latest-mac.yml'
// In the order they go on the GitHub release, download first.
export const uploads = [dmg, zip, blockmap, manifest]

/** Stop with an explanation and nothing else — no stack trace, which never helps here. */
export function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

/** Run a command for its output. Throws, so callers can decide what a failure means. */
export const capture = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' })

/** Run a command for what it does, showing its output as it goes. A failure stops the script. */
export function run(command, args, env = process.env) {
  try {
    execFileSync(command, args, { cwd: root, env, stdio: 'inherit' })
  } catch (error) {
    // The command has just said on its own stderr what went wrong. Node would follow that with
    // a stack trace through child_process and a dump of every argument, burying it.
    fail(`\`${describe(command, args)}\` failed${error.status ? ` (exit ${error.status})` : ''}.`)
  }
}

/** What to call a command in a message: `node …/electron-vite.js build` is `electron-vite build`. */
function describe(command, args) {
  const name = names.get(args[0])
  return name ? `${name} ${args[1] ?? ''}`.trim() : `${basename(command)} ${args[0] ?? ''}`.trim()
}

/** Whether a command succeeds, for the checks where failing is one of the answers. */
export const succeeds = (command, args) => {
  try {
    capture(command, args)
    return true
  } catch {
    return false
  }
}

const require = createRequire(import.meta.url)
const names = new Map() // Each command's path back to the name you'd type, for messages.

/**
 * Where a dependency's command lives, so it can be run with this Node: `node <bin>` rather
 * than `npx <name>`, which searches PATH and offers to fetch the package from the registry if
 * it doesn't find it. It also sidesteps the executable bit pnpm's hoisted layout sometimes
 * leaves off (bins.mjs), which `npx` needs and `node` doesn't.
 */
export function bin(name) {
  const manifestPath = require.resolve(`${name}/package.json`)
  const { bin: entries } = require(manifestPath)
  const entry = typeof entries === 'string' ? entries : entries?.[name]
  if (!entry) fail(`${name} has no \`${name}\` command. Run \`pnpm install\`.`)
  const path = join(dirname(manifestPath), entry)
  names.set(path, name)
  return path
}

/** How long something took, for a script that spends minutes waiting on Apple. */
export const since = (start) => {
  const seconds = Math.round((Date.now() - start) / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
