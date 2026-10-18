import { describe, expect, it } from 'vitest'
import { isEmailAddress } from '../../src/shared/text'

describe('isEmailAddress', () => {
  it('accepts anything that could be an address', () => {
    for (const text of ['me@example.com', ' me@example.com ', 'first.last+cue@mail.example.co.uk']) expect(isEmailAddress(text)).toBe(true)
  })

  it('catches what can’t be, without asking the server', () => {
    const invalid = ['', 'me', 'not-an-email', 'me@example', 'a@b', '@example.com', 'me@.com', 'me@example.', 'me @example.com', 'me@exa mple.com', 'me@@example.com']
    for (const text of invalid) expect(isEmailAddress(text)).toBe(false)
  })
})
