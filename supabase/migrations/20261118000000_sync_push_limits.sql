-- sync_push took any well-formed version, however far ahead of now. Any session could
-- push a line with the highest possible version (`zzzzzzzzzz-zzzz-…`), and an assistant's
-- token could too, with its text blanked: no device, restore or backup could ever replace
-- it again, so the line was as good as deleted, which 20261021000000_assistant_limits.sql
-- promises an assistant can't do. Worse, every device that pulled it moved its clock (core/hlc.ts)
-- there, so its next version overflowed to eleven digits, which the check below skips
-- without an error: from then on that device's edits never reached the server, and it
-- believed they had.
--
-- So a version may be at most a day ahead of the server's clock. A device whose clock runs
-- further ahead gets an error rather than a skip: its changes stay queued, and sync says it's
-- paused, instead of losing them. Before applying this to a project with data, check that
-- no stored version is already ahead, which would stop its account's devices syncing until
-- the time passes. This should find nothing:
--
--   select i.user_id, i.id, i.version from public.items i,
--     lateral (select sum((strpos('0123456789abcdefghijklmnopqrstuvwxyz', c) - 1) * 36::numeric ^ (10 - n)) as ms
--              from unnest(string_to_array(left(i.version, 10), null)) with ordinality as t(c, n)) v
--   where v.ms > extract(epoch from now()) * 1000 + 86400000;
--
-- Also: at most 1000 records per push (the apps send 500), and length limits on the two
-- fields that had none, so one request can't store unbounded data.

create or replace function public.sync_push(records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  before_seq bigint;
  after_seq bigint;
  -- The latest wall clock a version may carry, in the base 36 of core/hlc.ts.
  ms bigint := (extract(epoch from now()) * 1000)::bigint + 86400000;
  latest text := '';
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(records) <> 'array' then
    raise exception 'records must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(records) > 1000 then
    raise exception 'Push at most 1000 records at a time' using errcode = '54000';
  end if;
  -- Read `deleted` exactly as the upsert below does: Postgres also takes "t", "yes", "on"…
  if (auth.jwt() ->> 'client_id') is not null
     and exists (select 1 from jsonb_to_recordset(records) as r(deleted boolean) where r.deleted) then
    raise exception 'Assistants can''t delete lines' using errcode = '42501';
  end if;

  while ms > 0 loop
    latest := substr('0123456789abcdefghijklmnopqrstuvwxyz', (ms % 36)::int + 1, 1) || latest;
    ms := ms / 36;
  end loop;
  latest := lpad(latest, 10, '0');
  -- Versions are fixed width, so their first ten characters compare as times.
  if exists (
    select 1 from jsonb_to_recordset(records) as r(version text)
    where left(r.version, 10) collate "C" > latest collate "C"
  ) then
    raise exception 'A version is more than a day ahead of the server. Check this device''s clock.' using errcode = '22023';
  end if;

  -- Serialize this user's pushes so seq order is commit order. Otherwise a reader could
  -- see seq 11 committed before seq 10 and skip 10 forever.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select coalesce(max(seq), 0) into before_seq from public.items where user_id = uid;

  insert into public.items as i
    (user_id, id, date, parent_id, position, type, text, done, created_at, updated_at, deleted, version, seq)
  select distinct on (r.id)
    uid, r.id, r.date, r."parentId", r.position, r.type, r.text, r.done,
    round(r."createdAt")::bigint, round(r."updatedAt")::bigint, r.deleted, r.version,
    nextval('public.items_seq')
  from jsonb_to_recordset(records) as r(
    id text, date text, "parentId" text, position text, type text, text text, done boolean,
    "createdAt" numeric, "updatedAt" numeric, deleted boolean, version text
  )
  -- Skip, rather than fail on, a malformed record so one bad row can't block the rest.
  -- These mirror the client's own validation, so in practice nothing is skipped.
  where length(r.id) between 1 and 100
    and r.date ~ '^\d{4}-\d{2}-\d{2}$'
    and (r."parentId" is null or (r."parentId" <> r.id and length(r."parentId") <= 100))
    and length(r.position) between 1 and 200
    and r.type in ('text', 'bullet', 'todo')
    and length(r.text) <= 100000
    and r.done is not null
    and r.deleted is not null
    and abs(r."createdAt") < 1e15
    and abs(r."updatedAt") < 1e15
    and length(r.version) <= 64
    and r.version ~ '^[0-9a-z]{10}-[0-9a-z]{4}-[0-9a-z]+$'
  order by r.id, r.version collate "C" desc
  on conflict (user_id, id) do update set
    date = excluded.date,
    parent_id = excluded.parent_id,
    position = excluded.position,
    type = excluded.type,
    text = excluded.text,
    done = excluded.done,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    deleted = excluded.deleted,
    version = excluded.version,
    seq = excluded.seq
  where excluded.version > i.version;

  select coalesce(max(seq), 0) into after_seq from public.items where user_id = uid;

  -- One "pull now" hint per push, to this user's private channel. It's sent on commit.
  if after_seq > before_seq then
    perform realtime.send(jsonb_build_object('seq', after_seq), 'changed', 'sync:' || uid::text, true);
  end if;

  return jsonb_build_object('before', before_seq, 'after', after_seq);
end;
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
