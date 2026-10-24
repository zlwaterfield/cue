-- Billing (docs/BILLING.md): sync is $4 a month or $30 a year, paid with Stripe.
--
-- It's off unless the project turns it on (`billing_config.required`), so a self-hosted
-- server keeps syncing for free. When it's on, an account needs an active subscription to
-- write. Reading isn't gated: someone whose subscription ended can still download their
-- notes to a new device; they just can't add to the server copy.

create table public.billing_config (
  id boolean primary key default true check (id),
  required boolean not null default false
);
insert into public.billing_config default values;
alter table public.billing_config enable row level security;
revoke all on public.billing_config from anon, authenticated;

-- One row per account, written only by the billing function's Stripe webhook (with the
-- service role), or by hand for an account given sync for free (plan 'comp').
create table public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  -- Stripe's status: trialing, active, past_due, canceled, unpaid, incomplete…
  status text not null,
  -- 'monthly', 'yearly', or 'comp'.
  plan text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;

-- Whether an account may sync. past_due keeps working while Stripe retries the card.
create function public.has_sync(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (select required from public.billing_config)
    or exists (
      select 1 from public.subscriptions
      where user_id = uid and status in ('active', 'trialing', 'past_due')
    );
$$;

-- What Settings shows: whether billing applies here, and the signed-in account's plan.
create function public.billing_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'required', (select required from public.billing_config),
    'active', public.has_sync(auth.uid()),
    'plan', s.plan,
    'renewsAt', (extract(epoch from s.current_period_end) * 1000)::bigint,
    'cancelsAtPeriodEnd', coalesce(s.cancel_at_period_end, false)
  )
  from (select 1) as one
  left join public.subscriptions s on s.user_id = auth.uid() and s.status in ('active', 'trialing', 'past_due');
$$;

-- Every write to the items (sync_push, from the apps or an assistant) checks once per
-- statement. The apps show "Sync isn’t active for this account." for this code.
create function public.items_require_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.has_sync(auth.uid()) then
    raise exception 'Sync isn''t active for this account' using errcode = 'CU402';
  end if;
  return null;
end;
$$;

create trigger items_require_sync
  before insert or update on public.items
  for each statement execute function public.items_require_sync();

revoke execute on function public.has_sync(uuid) from public, anon, authenticated;
revoke execute on function public.billing_status() from public, anon;
revoke execute on function public.items_require_sync() from public, anon, authenticated;
grant execute on function public.billing_status() to authenticated;
