/**
 * Billing, shared by the Mac app, the billing function (supabase/functions/billing) and
 * the tests. Sync is $4 a month or $30 a year, paid with Stripe on the web. See
 * docs/BILLING.md.
 */

export type Plan = 'monthly' | 'yearly'

export const PLANS: Record<Plan, { price: string; per: string }> = {
  monthly: { price: '$4', per: 'month' },
  yearly: { price: '$30', per: 'year' }
}

/** What `billing_status()` returns for the signed-in account. */
export interface BillingStatus {
  /** This server charges for sync. False on a self-hosted server. */
  required: boolean
  /** This account may sync: subscribed, given sync for free, or billing isn't required. */
  active: boolean
  /** 'monthly', 'yearly' or 'comp' while subscribed, otherwise null. */
  plan: Plan | 'comp' | null
  /** When the current period ends (ms), while subscribed. */
  renewsAt: number | null
  /** Cancelled: it ends at `renewsAt` instead of renewing. */
  cancelsAtPeriodEnd: boolean
}

/** The fields of a Stripe subscription that the webhook stores. */
export interface StripeSubscription {
  id: string
  customer: string
  status: string
  cancel_at_period_end: boolean
  /** Older API versions put it here; newer ones on each item. */
  current_period_end?: number
  metadata?: Record<string, string>
  items: { data: Array<{ price: { id: string }; current_period_end?: number }> }
}

/** A row of `public.subscriptions`. */
export interface SubscriptionRow {
  user_id: string
  status: string
  plan: Plan
  current_period_end: string | null
  cancel_at_period_end: boolean
  stripe_customer_id: string
  stripe_subscription_id: string
  updated_at: string
}

/**
 * The row to store for a subscription, or null if it isn't one of Cue's (no account id,
 * or a price that's neither plan).
 */
export function subscriptionRow(subscription: StripeSubscription, prices: Record<Plan, string>, now = new Date()): SubscriptionRow | null {
  const userId = subscription.metadata?.user_id
  const item = subscription.items.data[0]
  const plan = (Object.keys(prices) as Plan[]).find((p) => prices[p] === item?.price.id)
  if (!userId || !plan) return null
  const end = subscription.current_period_end ?? item.current_period_end
  return {
    user_id: userId,
    status: subscription.status,
    plan,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    updated_at: now.toISOString()
  }
}

/** Stripe's default: a signed event older than this is refused, so it can't be replayed. */
const TOLERANCE_S = 300

/**
 * Check a webhook's `Stripe-Signature` header: an HMAC-SHA256 of `timestamp.body` with
 * the endpoint's signing secret (https://docs.stripe.com/webhooks#verify-manually).
 */
export async function verifyStripeSignature(body: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header) return false
  const parts = header.split(',').map((part) => part.split('='))
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1])
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!Number.isFinite(timestamp) || !signatures.length) return false
  if (Math.abs(now / 1000 - timestamp) > TOLERANCE_S) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return signatures.some((signature) => constantTimeEqual(signature, expected))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
