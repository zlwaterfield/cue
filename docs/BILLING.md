# Billing

Cue is free. On the hosted server, **sync** costs **$4 a month or $30 a year**. Sync
includes connecting assistants over MCP. Notes on a device never depend on paying:
without a subscription, the Mac and iPhone work exactly as they do with sync off.

A self-hosted server doesn't charge. Billing is off unless the project turns it on.

## How it works

There's one payment system, Stripe, and one source of truth, the `subscriptions` table.

```
Cue for Mac ── Subscribe ──▶ billing/checkout ──▶ Stripe Checkout (browser)
                                                       │ paid
Stripe ── customer.subscription.* ──▶ billing/webhook ──▶ subscriptions table
                                                       │
sync_push / MCP tools ── has_sync(user)? ◀─────────────┘
```

- **The database decides** (`supabase/migrations/20261024000000_billing.sql`).
  `has_sync(user)` is true when billing is off, or when the account's subscription is
  `active`, `trialing` or `past_due` (Stripe is still retrying the card). A statement
  trigger on `items` refuses writes from accounts without it, with SQLSTATE `CU402`.
  Reads aren't gated, so someone whose subscription ended can still download their notes
  to a new device. `billing_status()` tells the apps whether billing applies and the plan.
- **The billing function** (`supabase/functions/billing`) has three routes and calls
  Stripe's REST API directly, with no SDK:
  - `POST /billing/checkout {plan}` returns a Checkout URL for the signed-in account.
    The account id goes into the subscription's metadata.
  - `POST /billing/portal` returns a Stripe customer portal URL, where people switch
    plans, update their card, see invoices or cancel.
  - `POST /billing/webhook` takes Stripe's `customer.subscription.*` events. It checks
    the signature (`verifyStripeSignature`), reads the subscription again from Stripe
    instead of trusting the event, and upserts the row (`subscriptionRow`). Duplicate or
    out-of-order events end up storing the same thing.
- **The Mac** sells. When sync isn't active, Settings ▸ Sync shows "Sync needs a
  subscription: $4 a month or $30 a year." with **Subscribe Yearly · $30** and
  **Subscribe Monthly · $4**. Subscribed, it shows the plan and renewal date with
  **Manage Subscription…**. Both open Stripe in the browser. Coming back to Cue
  re-reads `billing_status()` and syncs right away, and the engine's own retries (at
  most a minute apart) would get there anyway.
- **The iPhone doesn't sell.** App Store rules don't allow buying or pointing to
  purchases outside the App Store in most countries, so the iPhone only says "Sync isn’t
  active for this account." It picks up a subscription made on the Mac the next time it
  syncs. (In the US, apps may now link to web checkout. That's a possible next step.)
- **Assistants** can connect and list tools without a subscription. Tool calls answer
  with "Sync isn’t active for this Cue account…" until there is one.

## Setting it up

1. In Stripe, create a product "Cue Sync" with two recurring prices: $4/month and
   $30/year. Turn on the [customer portal](https://dashboard.stripe.com/settings/billing/portal)
   and allow switching between the two prices and cancelling.
2. Add a webhook endpoint for
   `https://<project>.supabase.co/functions/v1/billing/webhook` with the events
   `customer.subscription.created`, `customer.subscription.updated` and
   `customer.subscription.deleted`.
3. Set the function's secrets and deploy it:

   ```sh
   npx supabase secrets set \
     STRIPE_SECRET_KEY=sk_live_… \
     STRIPE_WEBHOOK_SECRET=whsec_… \
     STRIPE_PRICE_MONTHLY=price_… \
     STRIPE_PRICE_YEARLY=price_… \
     CUE_SITE_URL=https://www.usecue.today
   npx supabase functions deploy billing --no-verify-jwt
   npx supabase functions deploy mcp --no-verify-jwt
   ```

4. Give existing beta accounts sync for free, if you like, then turn billing on:

   ```sql
   insert into public.subscriptions (user_id, status, plan)
   select id, 'active', 'comp' from auth.users
   on conflict (user_id) do nothing;

   update public.billing_config set required = true;
   ```

To give one account sync for free later, insert a row like the ones above. To turn
billing off again, set `required = false`.

Checkout comes back to `site/subscribed`, a page that says to go back to Cue.

Sales tax isn't handled. Turn on [Stripe Tax](https://stripe.com/tax) and add
`automatic_tax[enabled]=true` to the Checkout call once you need it.

## Tests

- `tests/unit/billing.test.ts`: webhook signatures (a good one, another secret, a
  changed body, a replayed old event) and storing a subscription.
- `tests/unit/syncService.test.ts`: the Mac asks for a subscription, opens Checkout and
  the portal, and syncs as soon as it's paid.
- `tests/integration/billing.test.ts`: against the local stack. With billing off, sync is
  free. With it on, writes are refused and reads still work, and assistants are told why.
  A subscription stored the way the webhook stores it turns sync on; cancelled, it stops
  again. It turns billing on for the whole server, so with `CUE_SUPABASE_URL` set,
  vitest runs test files one at a time. It also needs the stack's secret key:

  ```sh
  CUE_SUPABASE_URL=http://127.0.0.1:54321 CUE_SUPABASE_KEY=<publishable key> \
    CUE_SUPABASE_SECRET_KEY=<secret key> pnpm test:sync
  ```

Checkout, the portal and the webhook's calls to Stripe aren't covered by tests. Try them
with Stripe's test mode keys and `stripe listen --forward-to
http://127.0.0.1:54321/functions/v1/billing/webhook`, with the secrets in
`supabase/functions/.env`.
