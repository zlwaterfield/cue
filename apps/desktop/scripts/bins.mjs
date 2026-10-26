/**
 * `postinstall`: make sure every command in node_modules/.bin can actually run.
 *
 * With `nodeLinker: hoisted` (pnpm-workspace.yaml), node_modules/.bin holds symlinks straight
 * into each package rather than the shell shims pnpm writes for its own layout. A few packages
 * — electron-vite among them — publish their bin file without the executable bit, so the
 * symlink points at a file the shell refuses to run:
 *
 *   sh: node_modules/.bin/electron-vite: Permission denied
 *
 * pnpm sets the bit when it first links a package, and not again: once a node_modules has one
 * of these, `pnpm install` answers "Already up to date" and leaves it broken, and so does
 * `--force`, which leaves deleting node_modules as the only other cure. Setting the bit after
 * every install keeps that from happening, and `pnpm dev` and `pnpm release` call it as well,
 * to mend a node_modules that already has.
 */
import { chmodSync, lstatSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Sets the executable bit on the commands that are missing it, and says which those were. */
export function fixBins(bin = resolve(import.meta.dirname, '../node_modules/.bin')) {
  const fixed = []
  let entries
  try {
    entries = readdirSync(bin)
  } catch {
    return fixed // No node_modules yet; `pnpm install` is about to make one.
  }
  for (const entry of entries) {
    const link = join(bin, entry)
    try {
      // Only the symlinks: pnpm's own shims are executable already.
      if (!lstatSync(link).isSymbolicLink()) continue
      const target = resolve(dirname(link), readlinkSync(link))
      const { mode } = statSync(target) // Follows the link, and throws if it dangles.
      if (mode & 0o111) continue
      chmodSync(target, mode | 0o755)
      fixed.push(entry)
    } catch {
      // A dangling link is pnpm's business, not this script's.
    }
  }
  return fixed
}

if (process.argv[1] === import.meta.filename) {
  const fixed = fixBins()
  if (fixed.length) console.log(`Made executable: ${fixed.join(', ')}`)
}
