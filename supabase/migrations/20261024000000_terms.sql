-- Which version of the Terms (usecue.today/terms) and Privacy Policy each person agreed
-- to, and when. Every sign-in says "By continuing, you agree to the Terms and Privacy
-- Policy", and the apps record it here once signed in. A version is the date on the page.
-- Deleting the account deletes its record too.

create table public.terms_acceptances (
  user_id     uuid not null references auth.users (id) on delete cascade,
  version     text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

alter table public.terms_acceptances enable row level security;

create policy "Users read their own acceptances" on public.terms_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.terms_acceptances from anon, authenticated;
grant select on public.terms_acceptances to authenticated;

-- Record that the signed-in person agreed to `version`. The first time counts: signing in
-- again keeps the original time. Assistants can't agree on anyone's behalf.
create function public.accept_terms(version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'Assistants can''t accept terms' using errcode = '42501';
  end if;
  insert into public.terms_acceptances (user_id, version)
  values (auth.uid(), accept_terms.version)
  on conflict do nothing;
end;
$$;

revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;
