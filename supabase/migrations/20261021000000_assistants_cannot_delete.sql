-- Assistants connected over MCP (docs/MCP.md) hold an OAuth token: the person's own
-- session plus a `client_id` claim, which the apps' sessions never have. The consent page
-- promises an assistant can't delete anything, so the database refuses it here, whatever
-- the assistant calls directly: no deleting the account, and no deleted lines in a push.

create or replace function public.sync_delete_account()
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
    raise exception 'Assistants can''t delete accounts' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- As in 20261017000000_sync.sql, plus the check after the argument checks.
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
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(records) <> 'array' then
    raise exception 'records must be an array' using errcode = '22023';
  end if;
  if (auth.jwt() ->> 'client_id') is not null
     and exists (select 1 from jsonb_array_elements(records) as r where r ->> 'deleted' = 'true') then
    raise exception 'Assistants can''t delete lines' using errcode = '42501';
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
    and (r."parentId" is null or r."parentId" <> r.id)
    and length(r.position) between 1 and 200
    and r.type in ('text', 'bullet', 'todo')
    and length(r.text) <= 100000
    and r.done is not null
    and r.deleted is not null
    and abs(r."createdAt") < 1e15
    and abs(r."updatedAt") < 1e15
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
