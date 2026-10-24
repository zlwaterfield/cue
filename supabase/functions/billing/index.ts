import { subscriptionRow, verifyStripeSignature, type Plan, type StripeSubscription } from '../../../src/shared/billing.ts'

/**
 * Cue's billing endpoint (docs/BILLING.md). Three routes, each a few calls to Stripe's API:
 *
 *   POST /billing/checkout  { plan }  → { url } of a Stripe Checkout page for that plan
 *   POST /billing/portal              → { url } of Stripe's page to change or cancel it
 *   POST /billing/webhook             ← Stripe, whenever a subscription changes
 *
 * The first two take the person's Supabase access token, as sync does. The webhook is
 * signed by Stripe instead. It never trusts the event's copy of the subscription: it reads
 * the subscription again and stores what Stripe says now, so events arriving out of order
 * or twice store the same thing.
 */

const API = Deno.env.get('SUPABASE_URL')!
const KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const PRICES: Record<Plan, string> = {
  monthly: Deno.env.get('STRIPE_PRICE_MONTHLY') ?? '',
  yearly: Deno.env.get('STRIPE_PRICE_YEARLY') ?? ''
}
/** Where Checkout and the portal send people back to. */
const SITE = Deno.env.get('CUE_SITE_URL') ?? 'https://www.usecue.today'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  if (!STRIPE_KEY) return json({ error: 'Billing isn’t set up on this server.' }, 501)
  const route = new URL(request.url).pathname.split('/').pop()
  try {
    if (route === 'webhook') return await webhook(request)
    const user = await signedIn(request)
    if (!user) return json({ error: 'Not signed in.' }, 401)
    if (route === 'checkout') return await checkout(user, await request.json().catch(() => ({})))
    if (route === 'portal') return await portal(user)
    return json({ error: 'Not found.' }, 404)
  } catch (error) {
    console.error(error)
    return json({ error: 'Billing isn’t responding. Try again in a moment.' }, 502)
  }
})

interface User {
  id: string
  email: string
}

/** Start Checkout for a plan. Someone already subscribed gets the portal instead. */
async function checkout(user: User, body: { plan?: string }): Promise<Response> {
  const plan = body.plan === 'monthly' || body.plan === 'yearly' ? body.plan : null
  if (!plan || !PRICES[plan]) return json({ error: 'Choose monthly or yearly.' }, 400)
  const existing = await subscription(user.id)
  if (existing?.stripe_customer_id && ['active', 'trialing', 'past_due'].includes(existing.status)) return portal(user)
  const session = await stripe('checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': PRICES[plan],
    'line_items[0][quantity]': '1',
    // Someone who subscribed before keeps their Stripe customer (and card, and invoices).
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : { customer_email: user.email }),
    client_reference_id: user.id,
    // The webhook finds the account from this.
    'subscription_data[metadata][user_id]': user.id,
    allow_promotion_codes: 'true',
    success_url: `${SITE}/subscribed`,
    cancel_url: SITE
  })
  return json({ url: session.url })
}

/** Stripe's page to switch plans, update the card, see invoices or cancel. */
async function portal(user: User): Promise<Response> {
  const existing = await subscription(user.id)
  if (!existing?.stripe_customer_id) return json({ error: 'This account doesn’t have a subscription.' }, 404)
  const session = await stripe('billing_portal/sessions', { customer: existing.stripe_customer_id, return_url: SITE })
  return json({ url: session.url })
}

async function webhook(request: Request): Promise<Response> {
  const body = await request.text()
  if (!(await verifyStripeSignature(body, request.headers.get('stripe-signature'), WEBHOOK_SECRET))) {
    return json({ error: 'Bad signature.' }, 400)
  }
  const event = JSON.parse(body) as { type: string; data: { object: { id: string } } }
  if (!event.type.startsWith('customer.subscription.')) return json({ received: true })
  const current = (await stripe(`subscriptions/${event.data.object.id}`)) as StripeSubscription
  const row = subscriptionRow(current, PRICES)
  // Not one of Cue's plans, or made outside Checkout: nothing to store.
  if (!row) return json({ received: true })
  const response = await fetch(`${API}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...service(), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(row)
  })
  if (!response.ok) throw new Error(`Couldn’t store the subscription: ${response.status} ${await response.text()}`)
  return json({ received: true })
}

/* ------------------------------------------------------------------ Helpers */

/** The person the access token belongs to, as Supabase Auth says. */
async function signedIn(request: Request): Promise<User | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization) return null
  const response = await fetch(`${API}/auth/v1/user`, { headers: { apikey: KEY, authorization } })
  if (!response.ok) return null
  const user = (await response.json()) as { id: string; email?: string }
  return { id: user.id, email: user.email ?? '' }
}

async function subscription(userId: string): Promise<{ status: string; stripe_customer_id: string | null } | null> {
  const response = await fetch(`${API}/rest/v1/subscriptions?user_id=eq.${userId}&select=status,stripe_customer_id`, { headers: service() })
  if (!response.ok) throw new Error(`Couldn’t read the subscription: ${response.status}`)
  return ((await response.json()) as Array<{ status: string; stripe_customer_id: string | null }>)[0] ?? null
}

/** A Stripe API call: a GET without a body, a form-encoded POST with one. */
async function stripe(path: string, form?: Record<string, string>): Promise<Record<string, unknown> & { url?: string }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${STRIPE_KEY}`, ...(form && { 'content-type': 'application/x-www-form-urlencoded' }) },
    body: form && new URLSearchParams(form)
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`Stripe ${path}: ${response.status} ${JSON.stringify(data.error ?? data)}`)
  return data
}

/** The service role, which alone may read and write `subscriptions`. A legacy (JWT) key goes in both headers. */
function service(): Record<string, string> {
  return SERVICE_KEY.startsWith('sb_') ? { apikey: SERVICE_KEY } : { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
