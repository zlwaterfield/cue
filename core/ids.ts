/**
 * UUIDv7 identifiers: globally unique without coordination (safe to mint offline on
 * any device) and roughly time-ordered, which keeps database indexes compact.
 */

let lastMs = 0
let sequence = 0

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

export function uuidv7(now: number = Date.now()): string {
  // Monotonic within a millisecond so ids minted in a burst stay ordered.
  if (now <= lastMs) {
    sequence = (sequence + 1) & 0xfff
    if (sequence === 0) lastMs += 1
    now = lastMs
  } else {
    lastMs = now
    sequence = randomBytes(2)[0] & 0x7f
  }
  const bytes = randomBytes(16)
  const ms = BigInt(now)
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f)
  bytes[7] = sequence & 0xff
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
