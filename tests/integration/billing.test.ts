import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { subscriptionRow } from '../../src/shared/billing'
import { SubscriptionError } from '../../src/shared/sync/engine'
import { SupabaseSync, type Account } from '../../src/shared/sync/supabase'
import { signInCode, syncServer, testEmail } from '../syncServer'
import { memoryRepo, newItem } from '../unit/helpers'

/**
 * Billing against the local stack (docs/BILLING.md): with billing turned on, an account
 * without a subscription can read but not write, and assistants are told why; once the
 * webhook stores a subscription, it syncs. Needs the stack's secret key too
 * (CUE_SUPABASE_SECRET_KEY), to turn billing on and store the subscription as the
 * webhook does. It turns billing on for the whole server, so integration test files run
 * one at a time (vitest.config.mts).
 */

const secret = process.env.CUE_SUPABASE_SECRET_KEY

/** A line as a device stores it, with a version, ready to push. */
const line = (text: string) => memoryRepo().saveItems([newItem({ text })])

describe.skipIf(!syncServer || !secret)('billing', { timeout: 30_000 }, () => {
  const rest = `${syncServer?.url}/rest/v1`
  const service = { apikey: secret!, 'content-type': 'application/json' }
  let client: SupabaseSync
  let account: Account
  let token: string

  async function setRequired(required: boolean): Promise<void> {
    const response = await fetch(`${rest}/billing_config?id=eq.true`, { method: 'PATCH', headers: service, body: JSON.stringify({ required }) })
    expect(response.ok).toBe(true)
  }

  async function mcpTool(): Promise<{ isError?: boolean; content: Array<{ text: string }> }> {
    const response = await fetch(`${syncServer!.url}/functions/v1/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_todos', arguments: { from: '2026-10-17' } } })
    })
    expect(response.status).toBe(200)
    return (await response.json()).result
  }

  beforeAll(async () => {
    const values = new Map<string, string>()
    client = new SupabaseSync(syncServer!, { get: (k) => values.get(k) ?? null, set: (k, v) => void values.set(k, v), remove: (k) => void values.delete(k) })
    const email = testEmail('billing')
    await client.sendCode(email)
    account = await client.verifyCode(email, await signInCode(email))
    token = (JSON.parse(values.get('session')!) as { access_token: string }).access_token
  })

  afterAll(async () => {
    await setRequired(false)
  })

  it('syncs for free while billing is off, as on a self-hosted server', async () => {
    expect(await client.billingStatus()).toEqual({ required: false, active: true, plan: null, renewsAt: null, cancelsAtPeriodEnd: false })
    await client.push(line('free'))
  })

  it('needs a subscription to write once billing is on, but still reads', async () => {
    await setRequired(true)
    expect(await client.billingStatus()).toMatchObject({ required: true, active: false, plan: null })
    await expect(client.push(line('not yet'))).rejects.toBeInstanceOf(SubscriptionError)
    const pulled = await client.pull(0, 100)
    expect(pulled.records.map((r) => r.text)).toEqual(['free'])
    // Assistants can connect, and are told why their tools don't work.
    const result = await mcpTool()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Sync isn’t active for this Cue account/)
  })

  it('syncs once the webhook stores a subscription, and stops when it ends', async () => {
    const prices = { monthly: 'price_month', yearly: 'price_year' }
    const store = async (status: string): Promise<void> => {
      const row = subscriptionRow(
        {
          id: `sub_${account.id}`,
          customer: `cus_${account.id}`,
          status,
          cancel_at_period_end: false,
          metadata: { user_id: account.id },
          items: { data: [{ price: { id: 'price_year' }, current_period_end: 1_800_000_000 }] }
        },
        prices
      )
      // As the billing function's webhook writes it.
      const response = await fetch(`${rest}/subscriptions?on_conflict=user_id`, {
        method: 'POST',
        headers: { ...service, prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(row)
      })
      expect(response.ok).toBe(true)
    }

    await store('active')
    expect(await client.billingStatus()).toEqual({ required: true, active: true, plan: 'yearly', renewsAt: 1_800_000_000_000, cancelsAtPeriodEnd: false })
    await client.push(line('paid'))
    expect((await mcpTool()).isError).toBeUndefined()

    // The same subscription again, now cancelled: the row is updated, not duplicated.
    await store('canceled')
    expect(await client.billingStatus()).toMatchObject({ required: true, active: false, plan: null })
    await expect(client.push(line('lapsed'))).rejects.toBeInstanceOf(SubscriptionError)
  })

  it('keeps subscriptions private to the server', async () => {
    const response = await fetch(`${rest}/subscriptions?select=*`, { headers: { apikey: syncServer!.key, authorization: `Bearer ${token}` } })
    expect(response.ok).toBe(false)
  })
})
