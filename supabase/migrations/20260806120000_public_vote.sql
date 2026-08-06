-- 공개 투표와 순위 (A단계).
-- 기존 friend_* 테이블과 friend-photos 버킷은 건드리지 않는다.
-- 명세: docs/friend-flow-scenario.md `A단계 실행 스펙` 절.

create table public.vote_devices (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

create table public.vote_entries (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.vote_devices(id) on delete cascade,
  challenge_date date not null,
  color_id text not null,
  object_key text,
  thumb_key text,
  share_token text not null unique,
  status text not null default 'public' check (status in ('public', 'hidden', 'deleted')),
  pair_id uuid,
  owner_slot smallint check (owner_slot in (1, 2)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

-- 친구 모드는 한 방의 한 슬롯이 엔트리 하나만 갖는다. 혼자 모드는 pair_id가 없다.
create unique index vote_entries_pair_slot on public.vote_entries (pair_id, owner_slot) where pair_id is not null;
create index vote_entries_board on public.vote_entries (challenge_date, status);
create index vote_entries_expiry on public.vote_entries (expires_at);

create table public.vote_matches (
  id uuid primary key default gen_random_uuid(),
  entry_a uuid not null references public.vote_entries(id) on delete cascade,
  entry_b uuid not null references public.vote_entries(id) on delete cascade,
  share_token text not null unique,
  challenge_date date not null,
  created_at timestamptz not null default now(),
  check (entry_a <> entry_b),
  unique (entry_a, entry_b)
);

create table public.votes (
  match_id uuid not null references public.vote_matches(id) on delete cascade,
  voter_hash text not null,
  entry_id uuid not null references public.vote_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, voter_hash)
);

create index votes_entry on public.votes (entry_id);

alter table public.vote_devices enable row level security;
alter table public.vote_entries enable row level security;
alter table public.vote_matches enable row level security;
alter table public.votes enable row level security;

revoke all on public.vote_devices from anon, authenticated;
revoke all on public.vote_entries from anon, authenticated;
revoke all on public.vote_matches from anon, authenticated;
revoke all on public.votes from anon, authenticated;
grant select, insert, update, delete on public.vote_devices to service_role;
grant select, insert, update, delete on public.vote_entries to service_role;
grant select, insert, update, delete on public.vote_matches to service_role;
grant select, insert, update, delete on public.votes to service_role;

-- 공개 사진 전용 버킷. 공개 URL은 만들지 않고 Edge Function이 내보낸다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-entries', 'public-entries', false, 5242880, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 득표수는 저장하지 않고 votes를 세어 만든다. 앱이 보낸 숫자가 끼어들 자리를 없앤다.
create or replace view public.vote_standings as
with participation as (
  select id as match_id, entry_a as entry_id from public.vote_matches
  union all
  select id as match_id, entry_b as entry_id from public.vote_matches
)
select
  e.id as entry_id,
  e.challenge_date,
  e.color_id,
  e.share_token,
  count(v.*) filter (where v.entry_id = e.id) as votes_for,
  count(v.*) as votes_total
from public.vote_entries e
join participation p on p.entry_id = e.id
left join public.votes v on v.match_id = p.match_id
where e.status = 'public'
group by e.id, e.challenge_date, e.color_id, e.share_token;

revoke all on public.vote_standings from anon, authenticated;
grant select on public.vote_standings to service_role;

-- 투표 한 건과 그 대결의 집계를 한 트랜잭션에서 처리한다.
-- 중복은 votes 기본키가 막고, unique_violation은 호출자가 already_voted로 옮긴다.
create or replace function public.cast_vote(
  p_match_id uuid,
  p_voter_hash text,
  p_entry_id uuid,
  p_device_id uuid
) returns table(votes_a bigint, votes_b bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_match vote_matches%rowtype;
begin
  select * into current_match from vote_matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if p_entry_id <> current_match.entry_a and p_entry_id <> current_match.entry_b then
    raise exception 'entry_not_in_match';
  end if;

  -- 한쪽이라도 공개를 내렸으면 그 대결은 더 이상 투표를 받지 않는다.
  if exists (
    select 1 from vote_entries
    where id in (current_match.entry_a, current_match.entry_b) and status <> 'public'
  ) then
    raise exception 'entry_not_public';
  end if;

  -- 앱에서 온 요청이면 자기 엔트리에 투표할 수 없다. 웹 익명 투표는 기기를 알 수 없다.
  if p_device_id is not null and exists (
    select 1 from vote_entries
    where id in (current_match.entry_a, current_match.entry_b) and device_id = p_device_id
  ) then
    raise exception 'self_vote';
  end if;

  insert into votes (match_id, voter_hash, entry_id)
  values (p_match_id, p_voter_hash, p_entry_id);

  return query
    select
      count(*) filter (where entry_id = current_match.entry_a),
      count(*) filter (where entry_id = current_match.entry_b)
    from votes where match_id = p_match_id;
end;
$$;

revoke all on function public.cast_vote(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid, text, uuid, uuid) to service_role;

-- 두 슬롯이 모두 공개일 때만 대결을 만든다. 이미 있으면 그대로 돌려준다.
-- OUT 이름을 컬럼과 겹치지 않게 둔다 — 겹치면 plpgsql이 ambiguous reference로 죽는다.
create or replace function public.ensure_vote_match(
  p_pair_id uuid,
  p_share_token text
) returns table(match_id uuid, match_share_token text, was_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  a_entry vote_entries%rowtype;
  b_entry vote_entries%rowtype;
  existing vote_matches%rowtype;
  new_id uuid;
begin
  select * into a_entry from vote_entries
  where pair_id = p_pair_id and owner_slot = 1 and status = 'public';
  if not found then return; end if;

  select * into b_entry from vote_entries
  where pair_id = p_pair_id and owner_slot = 2 and status = 'public';
  if not found then return; end if;

  select * into existing from vote_matches
  where entry_a = a_entry.id and entry_b = b_entry.id;
  if found then
    return query select existing.id, existing.share_token, false;
    return;
  end if;

  begin
    insert into vote_matches (entry_a, entry_b, share_token, challenge_date)
    values (a_entry.id, b_entry.id, p_share_token, a_entry.challenge_date)
    returning id into new_id;
    return query select new_id, p_share_token, true;
  exception when unique_violation then
    -- 두 기기가 동시에 공개하면 한쪽만 만들고 나머지는 만들어진 것을 받는다.
    select * into existing from vote_matches
    where entry_a = a_entry.id and entry_b = b_entry.id;
    return query select existing.id, existing.share_token, false;
  end;
end;
$$;

revoke all on function public.ensure_vote_match(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_vote_match(uuid, text) to service_role;

-- 7일 지난 엔트리를 지우고 삭제해야 할 파일 키를 돌려준다. 파일 삭제는 호출자가 한다.
create or replace function public.purge_expired_vote_entries()
returns table(object_key text, thumb_key text)
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from vote_entries where expires_at < now()
    returning vote_entries.object_key, vote_entries.thumb_key
  )
  select gone.object_key, gone.thumb_key from gone;
$$;

revoke all on function public.purge_expired_vote_entries() from public, anon, authenticated;
grant execute on function public.purge_expired_vote_entries() to service_role;
