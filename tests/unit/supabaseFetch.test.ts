import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineError } from '../../src/shared/sync/engine'
import { AUTH_TIMEOUT, REQUEST_TIMEOUT, SupabaseSync, withTimeout, type SessionStore } from '../../src/shared/sync/supabase'

/** A server that accepts the connection and never answers. */
const silent = (): Promise<Response> => new Promise(() => {})

function memoryStore(): SessionStore {
  const values = new Map<string, string>()
  return { get: (k) => values.get(k) ?? null, set: (k, v) => void values.set(k, v), remove: (k) => void values.delete(k) }
}

/** Resolves with the error's name, or "answered"; `settled` says whether it has yet. */
function watch(request: Promise<unknown>) {
  const state = { settled: false }
  const outcome = request.then(
    () => 'answered',
    (error: Error) => error.name
  )
  void outcome.finally(() => (state.settled = true))
  return { state, outcome }
}

describe('request timeouts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('gives up on a sync request after 20 s, and cancels it', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetch = withTimeout((_input, init) => {
      signal = init?.signal ?? undefined
      return silent()
    })
    const { state, outcome } = watch(fetch('http://sync.test/rest/v1/rpc/sync_push', { method: 'POST' }))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT - 1)
    expect(state.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toBe('AbortError')
    expect(signal?.aborted).toBe(true)
  })

  it('gives up on sign-in after 10 s', async () => {
    vi.useFakeTimers()
    const { state, outcome } = watch(withTimeout(silent)('http://sync.test/auth/v1/otp', { method: 'POST' }))
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT - 1)
    expect(state.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toBe('AbortError')
  })

  it('covers a response that stalls halfway through its body', async () => {
    vi.useFakeTimers()
    const stalled = async (): Promise<Response> =>
      new Response(new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode('{"rec')) }), { status: 200 })
    const { outcome } = watch(withTimeout(stalled)('http://sync.test/rest/v1/rpc/sync_pull'))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT)
    expect(await outcome).toBe('AbortError')
  })

  it('passes answers through unchanged', async () => {
    const fetch = withTimeout(async (input) =>
      String(input).endsWith('/empty')
        ? new Response(null, { status: 204 })
        : new Response('{"ok":true}', { status: 201, statusText: 'Created', headers: { 'Content-Range': '0-1/2' } })
    )
    const response = await fetch('http://sync.test/rest/v1/rpc/sync_push')
    expect([response.status, response.statusText, response.headers.get('content-range')]).toEqual([201, 'Created', '0-1/2'])
    expect(await response.json()).toEqual({ ok: true })
    expect((await fetch('http://sync.test/empty')).status).toBe(204)
  })

  it('follows the caller’s own signal too', async () => {
    const controller = new AbortController()
    const { outcome } = watch(withTimeout(silent)('http://sync.test/rest/v1/items', { signal: controller.signal }))
    controller.abort()
    expect(await outcome).toBe('AbortError')
  })

  it('reports a hung push as offline, and a hung sign-in as unreachable', async () => {
    vi.useFakeTimers()
    const client = new SupabaseSync({ url: 'http://sync.test', key: 'key', fetch: silent }, memoryStore())
    const push = client.push([]).catch((error: Error) => error)
    const send = client.sendCode('me@example.com').catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT)
    const [pushed, sent] = await Promise.all([push, send])
    expect(pushed).toBeInstanceOf(OfflineError)
    expect(sent).toBeInstanceOf(OfflineError)
    expect((sent as Error).message).toBe('Can’t reach the sync server. Check your connection.')
  })
})
