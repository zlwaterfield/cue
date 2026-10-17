// Bundle a TypeScript script with rolldown and run it with Node (no extra deps).
import { rolldown } from 'rolldown'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [entry, ...args] = process.argv.slice(2)
const bundle = await rolldown({ input: resolve(entry), platform: 'node', external: [/^node:/], logLevel: 'silent' })
const out = join(mkdtempSync(join(tmpdir(), 'cue-script-')), 'script.mjs')
await bundle.write({ file: out, format: 'esm' })
process.argv = [process.argv[0], out, ...args]
await import(pathToFileURL(out).href)
