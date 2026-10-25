/**
 * A ZIP file, written by hand.
 *
 * The Mac exports Markdown as a folder of files, one per day. An iPhone has no folder to
 * hand anyone, so it shares the same tree as a single `.zip`, and this writes it: entries
 * are stored, not deflated, because days are small and a dependency to save a few hundred
 * kilobytes isn't worth it.
 *
 * The format is PKWARE's APPNOTE, sections 4.3.6 to 4.3.16: each file is a local header
 * and its bytes, then a central directory repeating those headers, then the end record
 * that says where the directory starts. Sizes are known before anything is written, so
 * there are no data descriptors, and nothing here needs Zip64: five years of notes is
 * under a megabyte.
 */

/** UTF-8, without TextEncoder, which Hermes doesn't always have. */
export function utf8(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    // A surrogate pair is one character, and its two halves must be recombined first.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        i++
      }
    }
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return Uint8Array.from(out)
}

let table: Uint32Array | null = null

/** CRC-32, the checksum ZIP stores for every entry. */
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[i] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** The path inside the archive, with `/` between folders. */
  path: string
  text: string
}

/** MS-DOS packs a timestamp into two 16-bit words, to a two-second resolution. */
function dosTime(when: Date): { time: number; date: number } {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    // DOS counts years from 1980 and has nowhere to put anything earlier.
    date: (Math.max(when.getFullYear() - 1980, 0) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  }
}

export function zip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const { time, date } = dosTime(when)
  const files = entries.map((entry) => {
    const name = utf8(entry.path)
    const body = utf8(entry.text)
    return { name, body, crc: crc32(body) }
  })

  const LOCAL = 30
  const CENTRAL = 46
  const END = 22
  const bodies = files.reduce((n, f) => n + LOCAL + f.name.length + f.body.length, 0)
  const directory = files.reduce((n, f) => n + CENTRAL + f.name.length, 0)
  const out = new Uint8Array(bodies + directory + END)
  const view = new DataView(out.buffer)
  // Bit 11 says the names are UTF-8; version 2.0 is what storing without Zip64 needs.
  const FLAGS = 0x0800
  const VERSION = 20

  let at = 0
  const offsets: number[] = []
  for (const file of files) {
    offsets.push(at)
    view.setUint32(at, 0x04034b50, true)
    view.setUint16(at + 4, VERSION, true)
    view.setUint16(at + 6, FLAGS, true)
    view.setUint16(at + 8, 0, true) // stored
    view.setUint16(at + 10, time, true)
    view.setUint16(at + 12, date, true)
    view.setUint32(at + 14, file.crc, true)
    view.setUint32(at + 18, file.body.length, true)
    view.setUint32(at + 22, file.body.length, true)
    view.setUint16(at + 26, file.name.length, true)
    view.setUint16(at + 28, 0, true)
    out.set(file.name, at + LOCAL)
    out.set(file.body, at + LOCAL + file.name.length)
    at += LOCAL + file.name.length + file.body.length
  }

  const start = at
  for (const [i, file] of files.entries()) {
    view.setUint32(at, 0x02014b50, true)
    view.setUint16(at + 4, VERSION, true)
    view.setUint16(at + 6, VERSION, true)
    view.setUint16(at + 8, FLAGS, true)
    view.setUint16(at + 10, 0, true)
    view.setUint16(at + 12, time, true)
    view.setUint16(at + 14, date, true)
    view.setUint32(at + 16, file.crc, true)
    view.setUint32(at + 20, file.body.length, true)
    view.setUint32(at + 24, file.body.length, true)
    view.setUint16(at + 28, file.name.length, true)
    view.setUint16(at + 30, 0, true)
    view.setUint16(at + 32, 0, true)
    view.setUint16(at + 34, 0, true)
    view.setUint16(at + 36, 0, true)
    view.setUint32(at + 38, 0, true)
    view.setUint32(at + 42, offsets[i], true)
    out.set(file.name, at + CENTRAL)
    at += CENTRAL + file.name.length
  }

  view.setUint32(at, 0x06054b50, true)
  view.setUint16(at + 4, 0, true)
  view.setUint16(at + 6, 0, true)
  view.setUint16(at + 8, files.length, true)
  view.setUint16(at + 10, files.length, true)
  view.setUint32(at + 12, at - start, true)
  view.setUint32(at + 16, start, true)
  view.setUint16(at + 20, 0, true)
  return out
}
