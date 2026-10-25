import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SessionError, SyncEngine, type SessionEnd, type SyncTransport } from '@shared/sync/engine'
import { SupabaseSync, type Account, type SessionStore } from '@shared/sync/supabase'
import type { Repository } from '@shared/repository'
import { TERMS_VERSION } from '@shared/terms'
import type { Item } from '@shared/types'
import { signInCode, syncServer, testEmail } from '../syncServer'
import { memoryRepo, newItem } from '../unit/helpers'

/**
 * The real protocol against a real Supabase: the migration's SQL, row-level security,
 * email sign-in, and realtime hints. Run with `pnpm test:sync` (docs/SYNC.md).
 */

interface Device {
  repo: Repository
  client: SupabaseSync
  account: Account
  store: SessionStore & { values: Map<string, string> }
  engine: SyncEngine
  received: Item[]
  pulls: number
}

function memoryStore(): Device['store'] {
  const values = new Map<string, string>()
  return { values, get: (k) => values.get(k) ?? null, set: (k, v) => void values.set(k, v), remove: (k) => void values.delete(k) }
}

async function signIn(email: string): Promise<Device> {
  const store = memoryStore()
  const client = new SupabaseSync(syncServer!, store)
  // An address can request a code once a second.
  await client.sendCode(email).catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await client.sendCode(email)
  })
  const account = await client.verifyCode(email, await signInCode(email))
  return attach({ client, account, store }, memoryRepo())
}

/** A device: a database, a signed-in client, and an engine counting its pulls. */
function attach(base: Pick<Device, 'client' | 'account' | 'store'>, repo: Repository): Device {
  const device = { ...base, repo, received: [] as Item[], pulls: 0 } as Device
  const transport: SyncTransport = {
    push: (records) => base.client.push(records),
    pull: (since, limit) => {
      device.pulls += 1
      return base.client.pull(since, limit)
    }
  }
  device.engine = new SyncEngine(repo, transport, { onRemoteChanges: (items) => device.received.push(...items) })
  return device
}

function accessToken(device: Device): string {
  return (JSON.parse(device.store.values.get('session')!) as { access_token: string }).access_token
}

describe.skipIf(!syncServer)('sync with Supabase', { timeout: 30_000 }, () => {
  const devices: Device[] = []
  let laptop: Device
  let desktop: Device
  let other: Device

  beforeAll(async () => {
    const email = testEmail('sync')
    laptop = await signIn(email)
    desktop = await signIn(email)
    other = await signIn(testEmail('other'))
    devices.push(laptop, desktop, other)
  }, 60_000)

  afterAll(async () => {
    for (const device of devices) {
      device.client.unlisten()
      await device.engine.stop()
    }
  })

  it('signs both Macs in to one account with an emailed code', () => {
    expect(laptop.account.id).toBe(desktop.account.id)
    expect(laptop.account.email).toMatch(/@example\.com$/)
    expect(other.account.id).not.toBe(laptop.account.id)
  })

  it('records agreeing to the terms at the first sign-in, readable only by its account', async () => {
    const read = async (device: Device): Promise<Array<{ version: string; accepted_at: string }>> => {
      const response = await fetch(`${syncServer!.url}/rest/v1/terms_acceptances?select=version,accepted_at`, {
        headers: { apikey: syncServer!.key, Authorization: `Bearer ${accessToken(device)}` }
      })
      return response.json()
    }
    // Both Macs signed in to one account: the first time stands.
    const [laptopSaw, desktopSaw, otherSaw] = await Promise.all([read(laptop), read(desktop), read(other)])
    expect(laptopSaw).toEqual([{ version: TERMS_VERSION, accepted_at: expect.any(String) }])
    expect(desktopSaw).toEqual(laptopSaw)
    expect(otherSaw).toHaveLength(1)
    expect(otherSaw[0].accepted_at).not.toBe(laptopSaw[0].accepted_at)

    const anonymous = await fetch(`${syncServer!.url}/rest/v1/rpc/accept_terms`, {
      method: 'POST',
      headers: { apikey: syncServer!.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: TERMS_VERSION })
    })
    expect(anonymous.ok).toBe(false)
  })

  it('delivers an edit to the other Mac within about a second of typing pausing', async () => {
    for (const device of [laptop, desktop]) {
      await device.client.listen(device.account, (seq) => device.engine.remoteChange(seq))
      device.engine.start()
    }
    await vi.waitFor(() => expect([laptop.engine.status, desktop.engine.status]).toEqual(['idle', 'idle']))
    await new Promise((resolve) => setTimeout(resolve, 1000)) // let both channels subscribe

    const item = newItem({ text: 'Written on the laptop' })
    const typedAt = Date.now()
    laptop.repo.saveItems([item])
    laptop.engine.localChange()
    await vi.waitFor(() => expect(desktop.repo.get(item.id)?.text).toBe('Written on the laptop'), { timeout: 10_000, interval: 20 })
    const latency = Date.now() - typedAt
    console.log(`laptop → desktop in ${latency} ms (includes the 600 ms typing pause)`)
    expect(latency).toBeLessThan(3000)
    expect(desktop.received.map((i) => i.id)).toContain(item.id)
  })

  it('never downloads its own changes', async () => {
    await vi.waitFor(() => expect(laptop.engine.status).toBe('idle'))
    const pulls = laptop.pulls
    laptop.repo.saveItems([newItem({ text: 'one' }), newItem({ text: 'two' })])
    await laptop.engine.flush()
    await new Promise((resolve) => setTimeout(resolve, 1500)) // the echoed hint has arrived by now
    expect(laptop.pulls).toBe(pulls)
    await vi.waitFor(() => expect(desktop.repo.allItems().map((i) => i.text)).toEqual(expect.arrayContaining(['one', 'two'])))
  })

  it('keeps accounts apart', async () => {
    const theirs = laptop.repo.allItems()[0]
    // Same id, newer version, different account: must not touch the first account's row.
    other.repo.applyRemote([{ ...theirs, text: 'hijacked', version: theirs.version.replace(/^0/, 'z') }], { upload: true })
    await other.engine.sync()
    await laptop.engine.sync()
    expect(laptop.repo.get(theirs.id)?.text).toBe(theirs.text)
    expect(other.repo.allItems().map((i) => i.text)).toEqual(['hijacked'])

    // Direct table reads only ever see your own rows, and signed-out callers get nothing.
    const rows = (await (
      await fetch(`${syncServer!.url}/rest/v1/items?select=user_id`, {
        headers: { apikey: syncServer!.key, Authorization: `Bearer ${accessToken(other)}` }
      })
    ).json()) as Array<{ user_id: string }>
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([other.account.id]))
    const anonymous = await fetch(`${syncServer!.url}/rest/v1/rpc/sync_pull`, {
      method: 'POST',
      headers: { apikey: syncServer!.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: 0 })
    })
    expect(anonymous.ok).toBe(false)
    const write = await fetch(`${syncServer!.url}/rest/v1/items`, {
      method: 'POST',
      headers: { apikey: syncServer!.key, Authorization: `Bearer ${accessToken(other)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: laptop.account.id, id: 'x', date: '2026-01-01', position: 'a', type: 'text', text: 'x', done: false, created_at: 0, updated_at: 0, deleted: false, version: '0000000000-0000-x', seq: 1 })
    })
    expect(write.ok).toBe(false)
  })

  it('keeps the newer version and skips malformed records without failing the batch', async () => {
    const [stored] = laptop.repo.saveItems([newItem({ text: 'current' })])
    await laptop.engine.flush()
    const fresh = newItem({ text: 'fresh', version: stored.version.replace(/-[0-9a-z]+$/, '-zz') })
    await laptop.client.push([
      { ...stored, text: 'stale', version: '0000000001-0000-old' },
      { ...newItem({ text: 'bad type' }), type: 'heading' as Item['type'], version: stored.version },
      { ...newItem({ text: 'bad version' }), version: 'not-a-version' },
      fresh
    ])
    const { records } = await laptop.client.pull(0, 1000)
    const byId = new Map(records.map((r) => [r.id, r]))
    expect(byId.get(stored.id)?.text).toBe('current')
    expect(byId.get(fresh.id)?.text).toBe('fresh')
    expect(records.some((r) => r.text === 'bad type' || r.text === 'bad version')).toBe(false)
  })

  it('reads a range of days straight from the table, only ever your own', async () => {
    const day = '2031-02-03'
    const [mine] = laptop.repo.saveItems([newItem({ date: day, type: 'todo', done: true, text: 'on the third' })])
    const [tomb] = laptop.repo.saveItems([{ ...newItem({ date: day, text: 'deleted' }), deleted: true }])
    await laptop.engine.flush()
    other.repo.saveItems([newItem({ date: day, text: 'someone else’s' })])
    await other.engine.sync()

    const records = await laptop.client.pullDates('2031-02-01', '2031-02-05')
    const byId = (items: Item[]) => [...items].sort((a, b) => (a.id < b.id ? -1 : 1))
    // The app's own record shape, tombstones included.
    expect(byId(records)).toEqual(byId([mine, tomb]))
    expect(await laptop.client.pullDates('2031-02-04', '2031-02-05')).toEqual([])
  })

  it('never skips a change while two Macs push at once', async () => {
    await Promise.all([laptop.engine.stop(), desktop.engine.stop()])
    const watcher = attach(laptop, memoryRepo())
    devices.push(watcher)
    let pushing = true
    // Pull continuously while both push in small batches, interleaving commits.
    const watching = (async () => {
      while (pushing) await watcher.engine.sync().catch(() => {})
    })()
    const burst = (device: Device, label: string) => {
      device.repo.saveItems(Array.from({ length: 300 }, (_, i) => newItem({ text: `${label} ${i}` })))
      return new SyncEngine(device.repo, device.client, {}, { batchSize: 25 }).sync()
    }
    await Promise.all([burst(laptop, 'laptop'), burst(desktop, 'desktop')])
    pushing = false
    await watching
    await watcher.engine.sync()

    const { records } = await everything(laptop.client)
    const live = (items: Item[]) => items.filter((i) => !i.deleted).map((i) => `${i.id}:${i.version}`).sort()
    expect(live(watcher.repo.allItems({ includeDeleted: true }))).toEqual(live(records))
    expect(watcher.repo.allItems().filter((i) => /^(laptop|desktop) \d+$/.test(i.text))).toHaveLength(600)
  })

  it('moves five thousand items quickly', async () => {
    const big = attach(other, memoryRepo())
    devices.push(big)
    big.repo.saveItems(Array.from({ length: 5000 }, (_, i) => newItem({ text: `Item ${i} with a bit of text to make it realistic` })))
    let started = performance.now()
    await big.engine.sync()
    const up = performance.now() - started

    const fresh = attach(other, memoryRepo())
    devices.push(fresh)
    started = performance.now()
    await fresh.engine.sync()
    const down = performance.now() - started
    console.log(`5,000 items: upload ${Math.round(up)} ms, download ${Math.round(down)} ms`)
    expect(fresh.repo.allItems().length).toBeGreaterThanOrEqual(5000)
    expect(up).toBeLessThan(15_000)
    expect(down).toBeLessThan(15_000)
  })

  it('says in Cue when the server can’t do Sign in with Apple on the Mac', async () => {
    // The local stack has no Apple secret (only a hosted project can take Apple's
    // HTTPS callback), so the browser sign-in is refused before any browser opens.
    const client = new SupabaseSync(syncServer!, memoryStore())
    await expect(client.appleSignInUrl('http://127.0.0.1:51234/auth/callback')).rejects.toThrow(
      'This sync server doesn’t offer Sign in with Apple. Use your email instead.'
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(client.exchangeCode('not-a-real-code')).rejects.toThrow('Couldn’t sign in. Try again in a moment.')
  })

  it('refuses an Apple identity token it can’t verify, in words', async () => {
    const client = new SupabaseSync(syncServer!, memoryStore())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(client.signInWithApple('not.a.token', 'nonce')).rejects.toThrow('Couldn’t sign in. Try again in a moment.')
  })

  it('restores a stored session without signing in again', async () => {
    const restored = new SupabaseSync(syncServer!, laptop.store)
    const { records } = await restored.pull(0, 1)
    expect(records).toHaveLength(1)
  })

  it('signs a device out cleanly once its account is deleted on another', async () => {
    const email = testEmail('gone')
    const phone = await signIn(email)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const mac = await signIn(email)
    devices.push(phone, mac)
    mac.repo.saveItems([newItem({ text: 'before' })])
    await mac.engine.sync()
    await phone.client.deleteAccount()

    // The token outlives the account, so the next push is the first to notice.
    const ended: SessionEnd[] = []
    mac.client.onSignedOut((reason) => ended.push(reason))
    mac.repo.saveItems([newItem({ text: 'after' })])
    const refused = (await mac.engine.sync().catch((error) => error)) as SessionError
    await mac.engine.stop()
    expect(refused).toBeInstanceOf(SessionError)
    expect(refused.reason).toBe('deleted')
    expect(refused.message).not.toMatch(/foreign key|violates|items_/)
    await mac.client.checkSession(refused.reason)
    expect(ended).toEqual(['deleted'])
    expect(mac.store.values.has('session')).toBe(false)
  })

  it('deletes the account and everything in it', async () => {
    await other.client.deleteAccount()
    // The session's token outlives the account, but there's nothing left to read.
    expect((await other.client.pull(0, 10)).records).toHaveLength(0)
    await other.client.signOut()
    await expect(other.client.pull(0, 10)).rejects.toThrow()
    // The other account is untouched.
    expect((await laptop.client.pull(0, 1)).records).toHaveLength(1)
  })
})

async function everything(client: SupabaseSync): Promise<{ records: Item[] }> {
  const records: Item[] = []
  let since = 0
  for (;;) {
    const page = await client.pull(since, 1000)
    records.push(...page.records)
    since = page.cursor
    if (!page.hasMore) return { records }
  }
}
