import { getRandomValues } from 'expo-crypto'

// Item ids (UUIDv7) and the device id come from `crypto.getRandomValues`, which Hermes
// doesn't provide. This module is imported first, before anything mints an id.
const g = globalThis as { crypto?: Partial<Crypto> }
g.crypto ??= {}
if (!g.crypto.getRandomValues) g.crypto.getRandomValues = getRandomValues as Crypto['getRandomValues']
