import { describe, expect, it, vi } from 'vitest'
import { SessionError, SyncError, type SessionEnd } from '../../src/shared/sync/engine'
import { MemorySyncServer } from '../../src/shared/sync/memoryServer'
import { SyncService, type SyncClient } from '../../src/main/sync/service'
import type { Repository } from '../../src/shared/repository'
import type { SyncState } from '../../src/shared/types'
import { memoryRepo, newItem } from './helpers'

const config = { url: 'http://sync.test', key: 'key' }

function setup(repo: Repository = memoryRepo(), server = new MemorySyncServer()) {
  const states: SyncState[] = []
  let signedOut: ((reason: SessionEnd) => void) | null = null
  const client: SyncClient = {
    ...server.transport(),
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async (email: string) => ({ id: `user-${email}`, email })),
    onSignedOut: (callback) => void (signedOut = callback),
    checkSession: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    listen: vi.fn(async () => {}),
    unlisten: vi.fn()
  }
  const connect = vi.fn(async () => client)
  const service = new SyncService(repo, { config, connect, onState: (s) => states.push(s), onRemoteChanges: () => {} })
  return { repo, server, service, client, connect, states, endSession: (reason: SessionEnd = 'expired') => signedOut?.(reason) }
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
    expect(service.state()).toMatchObject({
      email: null,
      status: 'off',
      previousEmail: 'me@example.com',
      message: 'Your sync account was deleted. Notes on this Mac stay here.'
    })
    expect(repo.allItems().map((i) => i.text).sort()).toEqual(['typed after it was deleted', 'written here'])
    expect(server.snapshot().map((i) => i.text)).toEqual(['written here'])

    // Turning sync off dismisses it.
    await service.signOut()
    expect(service.state()).toMatchObject({ needsSignIn: false, previousEmail: null, message: null })
    expect(setup(repo, server).service.state().needsSignIn).toBe(false)
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
