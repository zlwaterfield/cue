import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { subscriptionRow, verifyStripeSignature, type StripeSubscription } from '../../src/shared/billing'

const SECRET = 'whsec_test'
const NOW = 1_790_000_000_000

/** A `Stripe-Signature` header as Stripe signs it. */
function sign(body: string, secret = SECRET, at = NOW / 1000): string {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`
}

describe('verifyStripeSignature', () => {
  const body = '{"type":"customer.subscription.updated"}'

  it('accepts what Stripe signed with this endpoint’s secret', async () => {
    expect(await verifyStripeSignature(body, sign(body), SECRET, NOW)).toBe(true)
    // Stripe may send several v1 signatures while a secret is being rolled.
    expect(await verifyStripeSignature(body, `${sign(body)},v1=${'0'.repeat(64)}`, SECRET, NOW)).toBe(true)
  })

  it('refuses another secret, a changed body, an old event, or no signature', async () => {
    expect(await verifyStripeSignature(body, sign(body, 'whsec_other'), SECRET, NOW)).toBe(false)
    expect(await verifyStripeSignature(`${body} `, sign(body), SECRET, NOW)).toBe(false)
    expect(await verifyStripeSignature(body, sign(body, SECRET, NOW / 1000 - 600), SECRET, NOW)).toBe(false)
    expect(await verifyStripeSignature(body, null, SECRET, NOW)).toBe(false)
    expect(await verifyStripeSignature(body, 't=123', SECRET, NOW)).toBe(false)
  })
})

describe('subscriptionRow', () => {
  const prices = { monthly: 'price_month', yearly: 'price_year' }
  const subscription: StripeSubscription = {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { user_id: 'user-1' },
    items: { data: [{ price: { id: 'price_year' }, current_period_end: 1_800_000_000 }] }
  }

  it('stores the account, plan and period from the subscription', () => {
    expect(subscriptionRow(subscription, prices, new Date(NOW))).toEqual({
      user_id: 'user-1',
      status: 'active',
      plan: 'yearly',
      current_period_end: '2027-01-15T08:00:00.000Z',
      cancel_at_period_end: false,
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      updated_at: new Date(NOW).toISOString()
    })
    // Older API versions put the period on the subscription itself.
    expect(subscriptionRow({ ...subscription, current_period_end: 1_700_000_000 }, prices)?.current_period_end).toBe('2023-11-14T22:13:20.000Z')
  })

  it('ignores subscriptions that aren’t one of Cue’s plans or have no account', () => {
    expect(subscriptionRow({ ...subscription, items: { data: [{ price: { id: 'price_other' } }] } }, prices)).toBeNull()
    expect(subscriptionRow({ ...subscription, metadata: {} }, prices)).toBeNull()
  })
})
