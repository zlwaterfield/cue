import { describe, expect, it, vi } from 'vitest'
import { MemorySyncServer } from '../../src/main/sync/memoryServer'
import { SyncService, type SyncClient } from '../../src/main/sync/service'
import type { Repository } from '../../src/main/repository'
import type { SyncState } from '../../src/shared/types'
import { memoryRepo, newItem } from './helpers'

const config = { url: 'http://sync.test', key: 'key' }

function setup(repo: Repository = memoryRepo(), server = new MemorySyncServer()) {
  const states: SyncState[] = []
  let signedOut: (() => void) | null = null
  const client: SyncClient = {
    ...server.transport(),
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async (email: string) => ({ id: `user-${email}`, email })),
    onSignedOut: (callback) => void (signedOut = callback),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    listen: vi.fn(async () => {}),
    unlisten: vi.fn()
  }
  const connect = vi.fn(async () => client)
  const service = new SyncService(repo, { config, connect, onState: (s) => states.push(s), onRemoteChanges: () => {} })
  return { repo, server, service, client, connect, states, endSession: () => signedOut?.() }
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

  it('explains when the server ends the session', async () => {
    const { service, endSession } = setup()
    await service.verifyCode('me@example.com', '1')
    endSession()
    await vi.waitFor(() => expect(service.state()).toMatchObject({ email: null, status: 'off' }))
    expect(service.state().message).toMatch(/signed out/i)
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
    vi.mocked(client.verifyCode).mockRejectedValueOnce(new Error('That code is wrong or has expired.'))
    expect(await service.verifyCode('me@example.com', '000000')).toEqual({ ok: false, error: 'That code is wrong or has expired.' })
    expect(service.state().email).toBeNull()
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
