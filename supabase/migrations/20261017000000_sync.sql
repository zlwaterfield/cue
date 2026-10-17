-- Cue sync: one row per item, last-write-wins by hybrid logical clock version.
-- Clients never write the table directly; they call sync_push and sync_pull.
-- Protocol and reasoning: docs/SYNC.md.

create sequence public.items_seq as bigint;

create table public.items (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  date       text not null,
  parent_id  text,
  position   text not null,
  type       text not null check (type in ('text', 'bullet', 'todo')),
  text       text not null,
  done       boolean not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted    boolean not null,
  -- Versions compare as byte strings. A locale collation could order them differently.
  version    text collate "C" not null check (version ~ '^[0-9a-z]{10}-[0-9a-z]{4}-[0-9a-z]+$'),
  -- Position in this user's change feed; pull returns rows after a cursor in seq order.
  seq        bigint not null,
  primary key (user_id, id)
);

create index items_user_seq on public.items (user_id, seq);

alter table public.items enable row level security;

create policy "Users read their own items" on public.items
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.items from anon, authenticated;
grant select on public.items to authenticated;
revoke all on sequence public.items_seq from anon, authenticated;

-- Upload local changes. A record replaces the stored row only if its version is newer,
-- so replays, stale devices, and old backups can never revert or resurrect anything.
-- Every record counts as accepted: the server now holds that version or a newer one.
--
-- Returns the user's highest seq before and after the write. If `before` equals the
-- caller's cursor, nothing else changed in between, and the caller can move its cursor
-- to `after` without pulling back its own changes.
create function public.sync_push(records jsonb)
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

-- Download rows changed after `since`, oldest first, in the app's own record shape.
create function public.sync_pull(since bigint, max_rows int default 500)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with page as (
    select * from public.items
    where user_id = (select auth.uid()) and seq > since
    order by seq
    limit least(greatest(max_rows, 1), 1000)
  )
  select jsonb_build_object(
    'records', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'date', date, 'parentId', parent_id, 'position', position, 'type', type,
      'text', text, 'done', done, 'createdAt', created_at, 'updatedAt', updated_at,
      'deleted', deleted, 'version', version
    ) order by seq), '[]'::jsonb),
    'cursor', coalesce(max(seq), since),
    'hasMore', count(*) >= least(greatest(max_rows, 1), 1000)
  )
  from page;
$$;

-- Delete the signed-in account. Items go with it (on delete cascade).
create function public.sync_delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
revoke execute on function public.sync_pull(bigint, int) from public, anon;
revoke execute on function public.sync_delete_account() from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, int) to authenticated;
grant execute on function public.sync_delete_account() to authenticated;

-- Each user may listen only to their own hint channel.
create policy "Users receive their own sync hints" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'sync:' || (select auth.uid())::text and extension = 'broadcast');
