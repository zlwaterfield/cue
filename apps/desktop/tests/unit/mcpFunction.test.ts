/**
 * The MCP edge function (supabase/functions/mcp) runs the shared core under Deno, which needs
 * the file extensions the core leaves out. supabase/functions/mcp/deno.json maps each
 * extensionless import to its file, and one missing from the map stops the function booting,
 * with "Module not found", on the local stack and on deploy. Only the sync tests
 * (`pnpm test:sync`) start the function, and CI doesn't run those, so the map is checked here.
 *
 * This walks the function's imports the way Deno resolves them, type-only ones included: the
 * edge runtime builds its module graph from those too, though plain `deno run` skips them.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { parseSync } from 'vite'
import { describe, expect, it } from 'vitest'

const FUNCTION = resolve(import.meta.dirname, '../../../../supabase/functions/mcp')
const CONFIG = 'supabase/functions/mcp/deno.json'
const imports: Record<string, string> = JSON.parse(readFileSync(resolve(FUNCTION, 'deno.json'), 'utf8')).imports

const isRelative = (specifier: string) => /^\.{0,2}\//.test(specifier)
/** A relative key or target in deno.json is relative to deno.json itself. */
const fromConfig = (specifier: string) => (isRelative(specifier) ? resolve(FUNCTION, specifier) : specifier)
const importMap = new Map(Object.entries(imports).map(([from, to]) => [fromConfig(from), fromConfig(to)]))
const isFile = (path: string) => existsSync(path) && statSync(path).isFile()
/** How deno.json spells a path, which is also how the messages below name it. */
const asConfigKey = (path: string) => relative(FUNCTION, path)

/** What a module imports or re-exports from, statically or with a literal `import()`. */
function specifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const { module, errors } = parseSync(file, source)
  if (errors.length) throw new Error(`${file} doesn't parse: ${errors[0].message}`)
  const dynamic = module.dynamicImports.map(({ moduleRequest }) => /^(['"`])(.*)\1$/.exec(source.slice(moduleRequest.start, moduleRequest.end))?.[2])
  return [
    ...module.staticImports.map((i) => i.moduleRequest.value),
    ...module.staticExports.flatMap((e) => e.entries.map((entry) => entry.moduleRequest?.value)),
    ...dynamic
  ].filter((s): s is string => s !== undefined)
}

/** Every module the function reaches from index.ts, and every way Deno would fail to find one. */
function walk() {
  const reached = new Set<string>()
  const usedKeys = new Set<string>()
  const problems: string[] = []
  const queue = [resolve(FUNCTION, 'index.ts')]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (reached.has(file)) continue
    reached.add(file)
    const from = relative(resolve(FUNCTION, '../../..'), file)
    for (const specifier of specifiers(file)) {
      // Deno resolves a relative import against the importing file, then looks the result up in
      // the map. It never tries extensions, so without an entry the path has to be the file.
      const key = isRelative(specifier) ? resolve(dirname(file), specifier) : specifier
      const mapped = importMap.get(key)
      if (mapped !== undefined) usedKeys.add(key)
      const target = mapped ?? key
      if (/^(npm|jsr|node|https?):/.test(target)) continue
      if (!isRelative(target)) {
        problems.push(`${from} imports the package '${specifier}', which ${CONFIG} doesn't map`)
      } else if (isFile(target)) {
        queue.push(target)
      } else if (mapped !== undefined) {
        problems.push(`${CONFIG} maps "${asConfigKey(key)}" to "${asConfigKey(mapped)}", which isn't a file`)
      } else if (isFile(`${key}.ts`)) {
        problems.push(`${from} imports '${specifier}': add "${asConfigKey(key)}": "${asConfigKey(key)}.ts" to ${CONFIG}`)
        queue.push(`${key}.ts`) // So one run lists the entries missing behind this one too.
      } else {
        problems.push(`${from} imports '${specifier}', which isn't a file`)
      }
    }
  }
  return { usedKeys, problems }
}

describe('the MCP edge function’s import map', () => {
  it('lets Deno find every module the function reaches', () => {
    expect(walk().problems).toEqual([])
  })

  // Which also shows the walk above reaches what the map was written for, type-only imports
  // included: core/linkList is reached only through `import type`.
  it('maps only modules the function reaches', () => {
    const { usedKeys } = walk()
    const unused = [...importMap.keys()].filter((key) => !usedKeys.has(key)).map((key) => (isRelative(key) ? asConfigKey(key) : key))
    expect(unused, `remove these from ${CONFIG}`).toEqual([])
  })
})
