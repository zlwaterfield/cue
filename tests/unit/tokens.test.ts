import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The brand tokens (docs/brand/tokens) are copied by hand into the Mac's app.css and
 * the iPhone's theme.ts. This keeps the copies honest.
 */

const read = (path: string): string => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

interface Color {
  r: number
  g: number
  b: number
  a: number
}

function parseColor(value: string): Color | null {
  const hex = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: hex[2] ? parseInt(hex[2], 16) / 255 : 1 }
  }
  const rgba = value.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/)
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] }
  return null
}

/** Every innermost `selector { … }` block, with its custom properties. */
function cssBlocks(css: string): Array<{ selector: string; vars: Map<string, string> }> {
  const blocks = []
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const vars = new Map<string, string>()
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(name, value.trim())
    blocks.push({ selector: selector.trim(), vars })
  }
  return blocks
}

/** The `const light = {…}` and `const dark … = {…}` palettes in theme.ts, keyed by token name. */
function themePalette(source: string, name: 'light' | 'dark'): Map<string, string> {
  const body = source.match(new RegExp(`const ${name}\\b[^=]*=\\s*\\{([^}]*)\\}`))?.[1]
  if (!body) throw new Error(`No ${name} palette in theme.ts`)
  const out = new Map<string, string>()
  for (const [, key, value] of body.matchAll(/(\w+):\s*'([^']+)'/g)) {
    // bgElevated → --bg-elevated, text2 → --text-2
    out.set(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/(\d)/g, '-$1')}`, value)
  }
  return out
}

const brandBlocks = cssBlocks(read('docs/brand/tokens/tokens.css'))
const brand = {
  light: brandBlocks.find((b) => b.selector.includes(':root[data-theme="light"]'))!.vars,
  dark: brandBlocks.find((b) => b.selector === ':root:not([data-theme="light"])')!.vars
}
const appRoots = cssBlocks(read('src/renderer/src/styles/app.css')).filter((b) => b.selector === ':root')
const app = { light: appRoots[0].vars, dark: appRoots[1].vars }
const themeSource = read('mobile/src/ui/theme.ts')
const theme = { light: themePalette(themeSource, 'light'), dark: themePalette(themeSource, 'dark') }

function expectSameColor(actual: string | undefined, expected: string, where: string): void {
  const a = actual === undefined ? null : parseColor(actual)
  const e = parseColor(expected)!
  expect(a, `${where} is ${actual ?? 'missing'}, the brand says ${expected}`).not.toBeNull()
  expect({ r: a!.r, g: a!.g, b: a!.b }, where).toEqual({ r: e.r, g: e.g, b: e.b })
  expect(Math.abs(a!.a - e.a), `${where} alpha`).toBeLessThanOrEqual(1 / 255)
}

describe('brand tokens', () => {
  it('has the same dark palette for the system setting and the explicit choice', () => {
    const explicit = brandBlocks.find((b) => b.selector === ':root[data-theme="dark"]')!.vars
    expect(Object.fromEntries(explicit)).toEqual(Object.fromEntries(brand.dark))
  })

  it('matches tokens.json', () => {
    const json = JSON.parse(read('docs/brand/tokens/tokens.json')) as Record<'light' | 'dark', Record<string, { hex8: string }>>
    for (const mode of ['light', 'dark'] as const) {
      const fromJson = Object.fromEntries(Object.entries(json[mode]).map(([name, token]) => [`--${name}`, token.hex8]))
      expect(fromJson).toEqual(Object.fromEntries(brand[mode]))
    }
  })

  for (const mode of ['light', 'dark'] as const) {
    it(`are all in the Mac's app.css (${mode})`, () => {
      for (const [name, value] of brand[mode]) expectSameColor(app[mode].get(name), value, `app.css ${mode} ${name}`)
    })

    it(`match wherever the iPhone's theme.ts uses them (${mode})`, () => {
      for (const [name, value] of theme[mode]) {
        expect(brand[mode].has(name), `theme.ts ${mode} ${name} is not a brand token`).toBe(true)
        expectSameColor(value, brand[mode].get(name)!, `theme.ts ${mode} ${name}`)
      }
    })
  }
})
