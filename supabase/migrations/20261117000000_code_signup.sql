-- 20261025000000_no_password_signup.sql refused a password on insert, and that refused every
-- new email account. Supabase Auth creates a new address's account through its own signup,
-- with a random temporary password it never tells anyone or reads back (MagicLink in
-- supabase/auth, internal/api/magic_link.go). The trigger saw a password, Auth answered 500,
-- and the apps said "The sync server isn’t responding".
--
-- The database can't tell that signup from `POST /auth/v1/signup`, so drop the password on
-- the way in instead of refusing it. After the insert Auth writes only the columns it
-- changes, so the check on update still stops anything setting a password later.
--
-- Dropping the password doesn't stop `/signup` handing its caller a session for an address
-- they don't own, if signups are confirmed at once. So email confirmations are on
-- (supabase/config.toml; "Confirm email" on a hosted project): a signup has no session until
-- the address's owner types the code it emails them.

create or replace function public.refuse_passwords()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Emailed codes and Apple store no password as ''.
    new.encrypted_password := '';
    return new;
  end if;
  if coalesce(new.encrypted_password, '') <> '' and new.encrypted_password is distinct from old.encrypted_password then
    raise exception 'Cue accounts don''t use passwords' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_passwords() from public, anon, authenticated;
