import { describe, expect, it, vi } from 'vitest'
import { SessionError, SyncError, type SessionEnd } from '@shared/sync/engine'
import { MemorySyncServer } from '@shared/sync/memoryServer'
import { SyncService, type SyncClient } from '../../src/main/sync/service'
import type { Repository } from '@shared/repository'
import type { SyncState } from '@shared/types'
import { memoryRepo, newItem } from './helpers'

const config = { url: 'http://sync.test', key: 'key' }

function setup(repo: Repository = memoryRepo(), server = new MemorySyncServer(), browser = vi.fn(async (_url: string) => {})) {
  const states: SyncState[] = []
  let signedOut: ((reason: SessionEnd) => void) | null = null
  const client: SyncClient = {
    ...server.transport(),
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async (email: string) => ({ id: `user-${email}`, email })),
    // Apple's page "comes back" to wherever it was asked to.
    appleSignInUrl: vi.fn(async (redirectTo: string) => `https://appleid.test/auth?redirect=${encodeURIComponent(redirectTo)}`),
    exchangeCode: vi.fn(async (code: string) => ({ id: `apple-${code}`, email: 'me@privaterelay.appleid.com', method: 'apple' as const })),
    onSignedOut: (callback) => void (signedOut = callback),
    checkSession: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    listen: vi.fn(async () => {}),
    unlisten: vi.fn()
  }
  const connect = vi.fn(async () => client)
  const service = new SyncService(repo, { config, connect, openBrowser: browser, onState: (s) => states.push(s), onRemoteChanges: () => {} })
  return { repo, server, service, client, connect, states, browser, endSession: (reason: SessionEnd = 'expired') => signedOut?.(reason) }
}

describe('SyncService', () => {
  it('is off by default and never connects while signed out', async () => {
    const { repo, service, connect } = setup()
    await service.start()
    repo.saveItems([newItem()])
    service.localChange()
    service.resume()
    expect(connect).not.toHaveBeenCalled()
    expect(service.state()).toMatchObject({ available: true, email: null, status: 'off', pending: 0 })
    expect(service.hasUnsentChanges()).toBe(false)
  })

  it('is unavailable without a configured server', () => {
    const service = new SyncService(memoryRepo(), { config: null, onState: () => {}, onRemoteChanges: () => {} })
    expect(service.state().available).toBe(false)
  })

  it('uploads everything already on this Mac when sync is turned on', async () => {
    const { repo, server, service } = setup()
    repo.saveItems([newItem({ text: 'before sync' })])
    repo.acknowledge(repo.pendingChanges()) // as if nothing were queued
    expect(await service.sendCode('me@example.com')).toEqual({ ok: true })
    expect(await service.verifyCode('me@example.com', '123 456')).toEqual({ ok: true })
    await vi.waitFor(() => expect(server.snapshot().map((i) => i.text)).toEqual(['before sync']))
    expect(service.state()).toMatchObject({ email: 'me@example.com', status: 'idle', pending: 0 })
  })

  it('resumes after a restart, and picks up where it left off after signing back in', async () => {
    const { repo, server, service, client } = setup()
    await service.verifyCode('me@example.com', '1')
    await vi.waitFor(() => expect(service.state().status).toBe('idle'))

    // Restart: same database, a new service. No sign-in needed.
    const restarted = setup(repo, server)
    await restarted.service.start()
    expect(restarted.service.state().email).toBe('me@example.com')
    expect(restarted.client.listen).toHaveBeenCalled()

    // Turning sync off keeps the notes; turning it back on with the same account
    // sends only what changed meanwhile.
    await restarted.service.signOut()
    expect(restarted.service.state()).toMatchObject({ email: null, status: 'off' })
    repo.saveItems([newItem({ text: 'while off' })])
    const queueAll = vi.spyOn(repo, 'queueAll')
    await restarted.service.verifyCode('me@example.com', '1')
    expect(queueAll).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(server.snapshot().map((i) => i.text)).toContain('while off'))
    expect(client.signOut).not.toHaveBeenCalled()
  })

  it('explains when the server ends the session, and signing in again picks up where it left off', async () => {
    const { repo, server, service, endSession } = setup()
    await service.verifyCode('me@example.com', '1')
    await vi.waitFor(() => expect(service.state().status).toBe('idle'))
    endSession('expired')
    expect(service.state()).toMatchObject({
      email: null,
      status: 'off',
      needsSignIn: true,
      previousEmail: 'me@example.com',
      previousMethod: 'email',
      message: 'Your sync session ended. Sign in again to keep syncing.'
    })

    // Still true after a restart, until someone signs in again.
    const restarted = setup(repo, server)
    await restarted.service.start()
    expect(restarted.service.state()).toMatchObject({ email: null, needsSignIn: true, previousEmail: 'me@example.com' })
    repo.saveItems([newItem({ text: 'while signed out' })])
    const queueAll = vi.spyOn(repo, 'queueAll')
    expect(await restarted.service.verifyCode('me@example.com', '1')).toEqual({ ok: true })
    expect(queueAll).not.toHaveBeenCalled()
    expect(restarted.service.state()).toMatchObject({ email: 'me@example.com', needsSignIn: false, previousEmail: null, message: null })
    await vi.waitFor(() => expect(server.snapshot().map((i) => i.text)).toContain('while signed out'))
  })

  it('signs out cleanly when the account was deleted elsewhere, keeping every note', async () => {
    const { repo, server, service, client, endSession } = setup()
    repo.saveItems([newItem({ text: 'written here' })])
    await service.verifyCode('me@example.com', '1')
    await vi.waitFor(() => expect(service.state()).toMatchObject({ status: 'idle', pending: 0 }))

    // The account row is gone: the next push fails its foreign key, and the auth server confirms.
    client.push = async () => {
      throw new SessionError('deleted')
    }
    vi.mocked(client.checkSession).mockImplementation(async (reason) => endSession(reason === 'deleted' ? 'deleted' : 'expired'))
    repo.saveItems([newItem({ text: 'typed after it was deleted' })])
    service.localChange({ soon: true })
    await vi.waitFor(() => expect(service.state().needsSignIn).toBe(true))
    expect(client.checkSession).toHaveBeenCalledTimes(1)
    expect(client.checkSession).toHaveBeenCalledWith('deleted')
    // There's no signing back in to it: Settings offers to turn sync on afresh.
    expect(service.state()).toMatchObject({
      email: null,
      status: 'off',
      previousEmail: null,
      message: 'Your account was deleted on another device. Notes on this Mac stay here.'
    })
    expect(repo.allItems().map((i) => i.text).sort()).toEqual(['typed after it was deleted', 'written here'])
    expect(server.snapshot().map((i) => i.text)).toEqual(['written here'])

    // Turning sync off dismisses it.
    await service.signOut()
    expect(service.state()).toMatchObject({ needsSignIn: false, previousEmail: null, message: null })
    expect(setup(repo, server).service.state().needsSignIn).toBe(false)
  })

  it('asks whether the session still stands on launch and coming back, at most every 30 minutes', async () => {
    // Pulls succeed for a deleted account, so a Mac that only reads has to ask.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { repo, server, service, client } = setup()
      const away = (minutes: number): void => void vi.setSystemTime(Date.now() + minutes * 60_000)
      await service.verifyCode('me@example.com', '1')
      await vi.waitFor(() => expect(service.state().status).toBe('idle'))
      service.resume() // back within a minute: nothing to pull, nothing to ask
      expect(client.checkSession).not.toHaveBeenCalled()

      away(2)
      service.resume()
      await vi.waitFor(() => expect(client.checkSession).toHaveBeenCalledTimes(1))
      expect(client.checkSession).toHaveBeenCalledWith('expired')
      for (const minutes of [2, 10, 15]) {
        await vi.waitFor(() => expect(service.state().status).toBe('idle'))
        away(minutes)
        service.resume()
      }
      expect(client.checkSession).toHaveBeenCalledTimes(1)
      away(4) // 31 minutes since it last asked
      service.resume()
      await vi.waitFor(() => expect(client.checkSession).toHaveBeenCalledTimes(2))

      // A launch asks at once; signed out, nothing asks.
      const restarted = setup(repo, server)
      await restarted.service.start()
      await vi.waitFor(() => expect(restarted.client.checkSession).toHaveBeenCalledTimes(1))
      await restarted.service.signOut()
      away(60)
      restarted.service.resume()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(restarted.client.checkSession).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows Off at once when sync is turned off, even with a request hanging', async () => {
    const { repo, service, client, states } = setup()
    await service.verifyCode('me@example.com', '1')
    await vi.waitFor(() => expect(service.state().status).toBe('idle'))
    client.push = () => new Promise(() => {})
    repo.saveItems([newItem({ text: 'stuck' })])
    service.localChange({ soon: true })
    await vi.waitFor(() => expect(service.state().status).toBe('syncing'))

    let done = false
    const turningOff = service.signOut().then(() => (done = true))
    expect(states.at(-1)).toMatchObject({ email: null, status: 'off' })
    expect(done).toBe(false)
    await turningOff
    expect(client.signOut).toHaveBeenCalled()
    expect(repo.pendingCount()).toBe(1)
  })

  it('never shows raw server text', async () => {
    const { repo, server, service, client } = setup()
    await service.verifyCode('me@example.com', '1')
    await vi.waitFor(() => expect(service.state().status).toBe('idle'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    client.push = async () => {
      throw new TypeError('insert or update on table "items" violates foreign key constraint')
    }
    repo.saveItems([newItem({ text: 'not going anywhere' })])
    expect(await service.syncNow()).toEqual({ ok: false, error: 'Sync paused. Cue will keep trying.' })
    expect(service.state()).toMatchObject({ status: 'error', message: 'Sync paused. Cue will keep trying.' })
    warn.mockRestore()

    server.online = false
    client.push = (records) => server.transport().push(records)
    expect(await service.syncNow()).toEqual({ ok: false, error: 'Offline. Changes will sync when you’re back online.' })
    expect(service.state()).toMatchObject({ status: 'offline', message: null })
  })

  it('keeps the waiting count current while offline', async () => {
    const { repo, server, service, states } = setup()
    await service.verifyCode('me@example.com', '1')
    await vi.waitFor(() => expect(service.state().status).toBe('idle'))
    server.online = false
    expect((await service.syncNow()).ok).toBe(false)
    repo.saveItems([newItem({ text: 'offline one' })])
    service.localChange()
    expect(states.at(-1)).toMatchObject({ status: 'offline', pending: 1 })
    repo.saveItems([newItem({ text: 'offline two' })])
    service.localChange()
    expect(states.at(-1)).toMatchObject({ status: 'offline', pending: 2 })
  })

  it('deletes the account, then carries on locally', async () => {
    const { repo, service, client } = setup()
    repo.saveItems([newItem({ text: 'stays here' })])
    await service.verifyCode('me@example.com', '1')
    expect(await service.deleteAccount()).toEqual({ ok: true })
    expect(client.signOut).toHaveBeenCalled()
    expect(service.state()).toMatchObject({ email: null, status: 'off', message: null })
    expect(repo.getMeta('sync_user')).toBeNull()
    expect(repo.allItems().map((i) => i.text)).toEqual(['stays here'])
  })

  it('reports wrong codes without turning sync on', async () => {
    const { service, client } = setup()
    vi.mocked(client.verifyCode).mockRejectedValueOnce(new SyncError('That code is wrong or has expired.'))
    expect(await service.verifyCode('me@example.com', '000000')).toEqual({ ok: false, error: 'That code is wrong or has expired.' })
    expect(service.state().email).toBeNull()

    // Anything unexpected comes back as plain words, not as the error itself.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(client.sendCode).mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
    expect(await service.sendCode('me@example.com')).toEqual({ ok: false, error: 'Couldn’t sign in. Try again in a moment.' })
    warn.mockRestore()
  })

  it('signs in with Apple through the browser, which comes back to this Mac', async () => {
    // The "browser" follows Apple's page back to the loopback address with a code.
    const browser = vi.fn(async (url: string) => {
      const back = new URL(new URL(url).searchParams.get('redirect')!)
      expect(back.hostname).toBe('127.0.0.1')
      back.searchParams.set('code', 'abc')
      const page = await fetch(back)
      // The page leaves the verdict to Cue, which hasn't exchanged the code yet.
      expect(await page.text()).toContain('Cue is finishing signing you in.')
    })
    const { repo, server, service, client } = setup(memoryRepo(), new MemorySyncServer(), browser)
    repo.saveItems([newItem({ text: 'before Apple' })])
    expect(await service.signInWithApple()).toEqual({ ok: true })
    expect(client.exchangeCode).toHaveBeenCalledWith('abc')
    expect(service.state()).toMatchObject({ email: 'me@privaterelay.appleid.com', needsSignIn: false })
    await vi.waitFor(() => expect(server.snapshot().map((i) => i.text)).toEqual(['before Apple']))

    // Once the answer is in, nothing listens there any more.
    const back = new URL(new URL(browser.mock.calls[0][0]).searchParams.get('redirect')!)
    await expect(fetch(back)).rejects.toThrow()
  })

  it('stops waiting for Apple when cancelled, in the app or on Apple’s page', async () => {
    const { service, browser } = setup()
    const waiting = service.signInWithApple()
    await vi.waitFor(() => expect(browser).toHaveBeenCalled())
    service.cancelSignIn()
    expect(await waiting).toEqual({ ok: false, error: '' })
    expect(service.state().email).toBeNull()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    browser.mockImplementationOnce(async (url) => {
      const back = new URL(new URL(url).searchParams.get('redirect')!)
      back.searchParams.set('error', 'access_denied')
      expect(await (await fetch(back)).text()).toContain('Sign-in didn’t finish')
    })
    expect(await service.signInWithApple()).toEqual({ ok: false, error: '' })
    browser.mockImplementationOnce(async (url) => {
      const back = new URL(new URL(url).searchParams.get('redirect')!)
      back.searchParams.set('error', 'server_error')
      await fetch(back)
    })
    expect(await service.signInWithApple()).toEqual({ ok: false, error: 'Couldn’t sign in. Try again in a moment.' })
    warn.mockRestore()
  })

  it('stays off when cancelled while the server is still exchanging the code', async () => {
    const browser = vi.fn(async (url: string) => {
      const back = new URL(new URL(url).searchParams.get('redirect')!)
      back.searchParams.set('code', 'abc')
      await fetch(back)
    })
    const { repo, service, client } = setup(memoryRepo(), new MemorySyncServer(), browser)
    let answer: () => void = () => {}
    vi.mocked(client.exchangeCode).mockImplementationOnce(async (code) => {
      await new Promise<void>((resolve) => (answer = resolve))
      return { id: `apple-${code}`, email: 'me@privaterelay.appleid.com', method: 'apple' }
    })
    const queueAll = vi.spyOn(repo, 'queueAll')
    const waiting = service.signInWithApple()
    await vi.waitFor(() => expect(client.exchangeCode).toHaveBeenCalled())
    service.cancelSignIn()
    answer()
    expect(await waiting).toEqual({ ok: false, error: '' })
    // The session the server made is dropped, and nothing was queued for upload.
    expect(client.signOut).toHaveBeenCalled()
    expect(queueAll).not.toHaveBeenCalled()
    expect(service.state()).toMatchObject({ email: null, status: 'off' })
  })

  it('offers Sign in with Apple again when an Apple session ends', async () => {
    const browser = vi.fn(async (url: string) => {
      const back = new URL(new URL(url).searchParams.get('redirect')!)
      back.searchParams.set('code', 'abc')
      await fetch(back)
    })
    const { repo, server, service, endSession } = setup(memoryRepo(), new MemorySyncServer(), browser)
    await service.signInWithApple()
    endSession('expired')
    expect(service.state()).toMatchObject({ needsSignIn: true, previousEmail: 'me@privaterelay.appleid.com', previousMethod: 'apple' })
    // Still true after a restart.
    const restarted = setup(repo, server)
    await restarted.service.start()
    expect(restarted.service.state()).toMatchObject({ needsSignIn: true, previousMethod: 'apple' })
  })

  it('stores the session encrypted', async () => {
    const repo = memoryRepo()
    let store: { set(key: string, value: string): void; get(key: string): string | null } | undefined
    const service = new SyncService(repo, {
      config,
      cipher: { encrypt: (s) => `enc(${s})`, decrypt: (s) => s.slice(4, -1) },
      connect: async (_config, sessionStore) => {
        store = sessionStore
        return setup().client
      },
      onState: () => {},
      onRemoteChanges: () => {}
    })
    await service.sendCode('me@example.com')
    store!.set('session', '{"access_token":"secret"}')
    expect(repo.getMeta('sync_session:session')).toBe('enc({"access_token":"secret"})')
    expect(store!.get('session')).toBe('{"access_token":"secret"}')
  })
})
