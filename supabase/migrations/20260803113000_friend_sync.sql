create extension if not exists pgcrypto;

create table public.friend_pairs (
  id uuid primary key default gen_random_uuid(),
  challenge_date date not null,
  invite_hash text unique,
  invite_expires_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'closed')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friend_members (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.friend_pairs(id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  token_hash text not null unique,
  status text not null check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  unique (pair_id, slot)
);

create table public.friend_photos (
  pair_id uuid not null references public.friend_pairs(id) on delete cascade,
  owner_slot smallint not null check (owner_slot in (1, 2)),
  object_key text,
  version bigint not null default 0,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (pair_id, owner_slot)
);

create table public.friend_rate_limits (
  key_hash text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);

alter table public.friend_pairs enable row level security;
alter table public.friend_members enable row level security;
alter table public.friend_photos enable row level security;
alter table public.friend_rate_limits enable row level security;

revoke all on public.friend_pairs from anon, authenticated;
revoke all on public.friend_members from anon, authenticated;
revoke all on public.friend_photos from anon, authenticated;
revoke all on public.friend_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.friend_pairs to service_role;
grant select, insert, update, delete on public.friend_members to service_role;
grant select, insert, update, delete on public.friend_photos to service_role;
grant select, insert, update, delete on public.friend_rate_limits to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('friend-photos', 'friend-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.close_expired_friend_pairs()
returns void
language sql
security definer
set search_path = public
as $$
  update friend_pairs
  set status = 'closed', invite_hash = null, invite_expires_at = null, updated_at = now()
  where status = 'waiting' and invite_expires_at < now();
$$;

revoke all on function public.close_expired_friend_pairs() from public, anon, authenticated;

create or replace function public.consume_friend_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_attempts integer;
begin
  insert into friend_rate_limits (key_hash, window_start, attempts)
  values (p_key_hash, now(), 1)
  on conflict (key_hash) do update set
    window_start = case
      when friend_rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else friend_rate_limits.window_start
    end,
    attempts = case
      when friend_rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else friend_rate_limits.attempts + 1
    end
  returning attempts into current_attempts;
  return current_attempts <= p_limit;
end;
$$;

revoke all on function public.consume_friend_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_friend_rate_limit(text, integer, integer) to service_role;

create or replace function public.approve_friend_join(
  p_pair_id uuid,
  p_expected_version bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_pair friend_pairs%rowtype;
begin
  select * into current_pair from friend_pairs where id = p_pair_id for update;
  if not found or current_pair.status <> 'waiting' or current_pair.version <> p_expected_version then
    return false;
  end if;
  update friend_members
  set status = 'active'
  where pair_id = p_pair_id and slot = 2 and status = 'pending';
  if not found then return false; end if;
  update friend_pairs
  set status = 'active', invite_hash = null, invite_expires_at = null,
      version = version + 1, updated_at = now()
  where id = p_pair_id;
  return true;
end;
$$;

revoke all on function public.approve_friend_join(uuid, bigint) from public, anon, authenticated;
grant execute on function public.approve_friend_join(uuid, bigint) to service_role;

create or replace function public.replace_friend_photo(
  p_pair_id uuid,
  p_owner_slot smallint,
  p_expected_version bigint,
  p_new_object_key text
) returns table(old_object_key text, new_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_photo friend_photos%rowtype;
begin
  select * into current_photo
  from friend_photos
  where pair_id = p_pair_id and owner_slot = p_owner_slot
  for update;

  if not found then
    if p_expected_version <> 0 then raise exception 'version_conflict'; end if;
    insert into friend_photos (pair_id, owner_slot, object_key, version, deleted_at)
    values (p_pair_id, p_owner_slot, p_new_object_key, 1, null);
    return query select null::text, 1::bigint;
    return;
  end if;

  if current_photo.version <> p_expected_version then raise exception 'version_conflict'; end if;
  update friend_photos
  set object_key = p_new_object_key,
      version = version + 1,
      deleted_at = null,
      updated_at = now()
  where pair_id = p_pair_id and owner_slot = p_owner_slot;
  return query select current_photo.object_key, current_photo.version + 1;
end;
$$;

create or replace function public.delete_friend_photo(
  p_pair_id uuid,
  p_owner_slot smallint,
  p_expected_version bigint
) returns table(old_object_key text, new_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_photo friend_photos%rowtype;
begin
  select * into current_photo
  from friend_photos
  where pair_id = p_pair_id and owner_slot = p_owner_slot
  for update;
  if not found or current_photo.version <> p_expected_version then raise exception 'version_conflict'; end if;
  update friend_photos
  set object_key = null,
      version = version + 1,
      deleted_at = now(),
      updated_at = now()
  where pair_id = p_pair_id and owner_slot = p_owner_slot;
  return query select current_photo.object_key, current_photo.version + 1;
end;
$$;

revoke all on function public.replace_friend_photo(uuid, smallint, bigint, text) from public, anon, authenticated;
revoke all on function public.delete_friend_photo(uuid, smallint, bigint) from public, anon, authenticated;
grant execute on function public.replace_friend_photo(uuid, smallint, bigint, text) to service_role;
grant execute on function public.delete_friend_photo(uuid, smallint, bigint) to service_role;
