-- 공개 투표 신고 (앱스토어 UGC 요건).
-- 추가 전용 — 기존 테이블·데이터는 바꾸지 않는다.
-- 같은 신고자(reporter_hash)의 중복 신고는 기본키가 1회로 막고,
-- 서로 다른 신고자 3회부터 엔트리를 공개에서 내린다. 파일은 지우지 않는다 — 검토용으로 남긴다.

create table public.vote_reports (
  entry_id uuid not null references public.vote_entries(id) on delete cascade,
  reporter_hash text not null,
  reason text not null check (reason in ('inappropriate', 'spam', 'other')),
  created_at timestamptz not null default now(),
  primary key (entry_id, reporter_hash)
);

alter table public.vote_reports enable row level security;
revoke all on public.vote_reports from anon, authenticated;
grant select, insert, update, delete on public.vote_reports to service_role;

-- 신고 저장과 3회 자동 숨김을 한 트랜잭션에서 처리한다.
create or replace function public.report_vote_entry(
  p_entry_id uuid,
  p_reporter_hash text,
  p_reason text
) returns table(report_count bigint, is_hidden boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  entry vote_entries%rowtype;
  total bigint;
begin
  select * into entry from vote_entries where id = p_entry_id for update;
  if not found then raise exception 'entry_not_found'; end if;

  insert into vote_reports (entry_id, reporter_hash, reason)
  values (p_entry_id, p_reporter_hash, p_reason)
  on conflict (entry_id, reporter_hash) do nothing;

  select count(*) into total from vote_reports where entry_id = p_entry_id;

  -- 3회 이상이면 공개 목록·카드·썸네일·투표에서 모두 빠진다(전부 status = 'public'만 본다).
  -- unpublish와 달리 object_key·thumb_key를 남긴다 — 검토용.
  if total >= 3 and entry.status = 'public' then
    update vote_entries set status = 'hidden' where id = p_entry_id;
    entry.status := 'hidden';
  end if;

  return query select total, entry.status <> 'public';
end;
$$;

revoke all on function public.report_vote_entry(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_vote_entry(uuid, text, text) to service_role;
