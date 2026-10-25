-- Cue accounts never have a password (20261021000000_assistant_limits.sql): one would let
-- an assistant's token, or anyone who learned it, sign in without the assistant's
-- `client_id` claim and so without the limits that claim carries.
--
-- That trigger fired only on update, so `POST /auth/v1/signup` could still create an
-- account with a password. Sign-in is an emailed code, so email confirmations are off and
-- a signup is confirmed at once: anyone could register an address they don't own, and
-- whoever later signed in to it with a code would be handed that account, password and
-- all. So refuse a password on the way in as well as on the way through.

create or replace function public.refuse_passwords()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Emailed codes and Apple leave this null or empty; only a password sets it.
  if coalesce(new.encrypted_password, '') = '' then
    return new;
  end if;
  -- `old` doesn't exist on insert, so check the operation before reading it.
  if tg_op = 'INSERT' or new.encrypted_password is distinct from old.encrypted_password then
    raise exception 'Cue accounts don''t use passwords' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists refuse_passwords on auth.users;

create trigger refuse_passwords
  before insert or update of encrypted_password on auth.users
  for each row execute function public.refuse_passwords();

-- Nothing calls it but the trigger, which doesn't need the privilege.
revoke execute on function public.refuse_passwords() from public, anon, authenticated;
