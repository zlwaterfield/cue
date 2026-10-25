import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crc32, utf8, zip } from '../../src/shared/zip'
import { tempDir } from './helpers'

const WHEN = new Date(2026, 9, 25, 14, 30, 20)

const READER = `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, 'a CRC did not match'
print(json.dumps({n: z.read(n).decode('utf-8') for n in z.namelist()}))
`

/**
 * What the archive holds, read back by a decoder that is not ours. Python's `zipfile`
 * checks every CRC and every offset, which is the point: a reader written here could
 * share a mistake with the writer.
 */
function unzip(bytes: Uint8Array): Record<string, string> {
  const file = join(tempDir(), 'export.zip')
  writeFileSync(file, bytes)
  return JSON.parse(execFileSync('python3', ['-I', '-c', READER, file], { encoding: 'utf8' }))
}

describe('crc32', () => {
  // The format's published check values, so the table is not graded by itself.
  it('matches the known vectors', () => {
    expect(crc32(utf8(''))).toBe(0)
    expect(crc32(utf8('a'))).toBe(0xe8b7be43)
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
    expect(crc32(utf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('utf8', () => {
  it('encodes beyond the basic plane', () => {
    expect([...utf8('é')]).toEqual([0xc3, 0xa9])
    expect([...utf8('☑')]).toEqual([0xe2, 0x98, 0x91])
    // One emoji, written as a surrogate pair, is four bytes and not two characters.
    expect([...utf8('🌲')]).toEqual([0xf0, 0x9f, 0x8c, 0xb2])
  })

  // Half a pair, which a note can hold because JavaScript strings can. Encoding it as
  // itself would make bytes that a strict reader rejects, and the zip is read by those.
  it('replaces an unpaired surrogate, like TextEncoder', () => {
    const encoder = new TextEncoder()
    for (const text of ['\ud800', '\udc00', 'a\ud800b', 'ends with \ud83c', '\udfff starts']) {
      expect([...utf8(text)]).toEqual([...encoder.encode(text)])
    }
    expect([...utf8('\ud800')]).toEqual([0xef, 0xbf, 0xbd])
  })
})

describe('zip', () => {
  it('writes an archive other tools can open', () => {
    const bytes = zip(
      [
        { path: '2026/2026-10-17.md', text: '# Saturday, October 17, 2026\n\n- [x] Ship it\n' },
        { path: '2025/2025-01-02.md', text: 'Old thing — ☑ and 🌲\n' }
      ],
      WHEN
    )
    expect(unzip(bytes)).toEqual({
      '2026/2026-10-17.md': '# Saturday, October 17, 2026\n\n- [x] Ship it\n',
      '2025/2025-01-02.md': 'Old thing — ☑ and 🌲\n'
    })
  })

  it('survives a note with half a surrogate pair in it', () => {
    const bytes = zip([{ path: '2026/2026-10-17.md', text: 'broken \ud800 paste\n' }], WHEN)
    // Python decodes strictly: the archive would not read back at all without the swap.
    expect(unzip(bytes)).toEqual({ '2026/2026-10-17.md': 'broken \ufffd paste\n' })
  })

  it('writes an archive with nothing in it', () => {
    const bytes = zip([], WHEN)
    expect(bytes.length).toBe(22)
    expect(unzip(bytes)).toEqual({})
  })
})
