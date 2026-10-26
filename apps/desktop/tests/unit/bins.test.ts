/**
 * scripts/bins.mjs sets the executable bit that pnpm's hoisted node_modules/.bin sometimes
 * leaves off. Nothing builds without it, and nothing notices when it quietly stops working,
 * so it's checked here.
 */
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A plain .mjs script, so it's imported by path rather than as a typed module.
const { fixBins } = (await import(new URL('../../scripts/bins.mjs', import.meta.url).href)) as {
  fixBins: (bin?: string) => string[]
}

/** A node_modules/.bin like pnpm's hoisted layout: symlinks into the packages beside it. */
function nodeModules(commands: { name: string; mode?: number; dangling?: boolean }[]): string {
  const modules = join(mkdtempSync(join(tmpdir(), 'cue-bins-')), 'node_modules')
  const bin = join(modules, '.bin')
  mkdirSync(bin, { recursive: true })
  for (const { name, mode = 0o644, dangling } of commands) {
    if (!dangling) {
      mkdirSync(join(modules, name), { recursive: true })
      writeFileSync(join(modules, name, 'cli.js'), '#!/usr/bin/env node\n', { mode })
      chmodSync(join(modules, name, 'cli.js'), mode) // writeFileSync's mode is masked by umask.
    }
    symlinkSync(join('..', name, 'cli.js'), join(bin, name))
  }
  return bin
}

const executable = (path: string) => Boolean(statSync(path).mode & 0o111)

describe('fixBins', () => {
  it('makes a command that was published without the bit executable', () => {
    const bin = nodeModules([{ name: 'electron-vite' }])
    expect(fixBins(bin)).toEqual(['electron-vite'])
    expect(executable(join(bin, 'electron-vite'))).toBe(true)
  })

  it('leaves the commands that already run alone', () => {
    const bin = nodeModules([{ name: 'vite', mode: 0o755 }])
    expect(fixBins(bin)).toEqual([])
    expect(statSync(join(bin, 'vite')).mode & 0o777).toBe(0o755)
  })

  it('has nothing left to do the second time', () => {
    const bin = nodeModules([{ name: 'electron-vite' }, { name: 'electron-builder' }])
    expect(fixBins(bin).sort()).toEqual(['electron-builder', 'electron-vite'])
    expect(fixBins(bin)).toEqual([])
  })

  it('steps over a link that points nowhere, and fixes the rest', () => {
    const bin = nodeModules([{ name: 'gone', dangling: true }, { name: 'electron-vite' }])
    expect(fixBins(bin)).toEqual(['electron-vite'])
  })

  it('says nothing when there is no node_modules yet', () => {
    expect(fixBins(join(mkdtempSync(join(tmpdir(), 'cue-bins-')), 'node_modules/.bin'))).toEqual([])
  })
})
