-- 페이퍼노트 초기 스키마: 프로필(가입 승인), 논문, 분석 결과, 프리셋 + RLS
-- 규칙(PRD "로그인과 가입 승인"):
--   * 가입하면 pn_profiles에 status = 'pending' 행이 자동 생성된다.
--   * 데이터 테이블은 user_id = 본인 이고 status = 'approved' 인 계정만 읽고 쓴다.
--   * status, is_admin 은 관리자만 바꿀 수 있다 (일반 사용자에게는 UPDATE 정책이 없다).

-- ---------------------------------------------------------------- 도우미 함수
-- RPC로 노출되지 않도록 API가 공개하지 않는 별도 스키마에 둔다.
create schema if not exists pn_private;
revoke all on schema pn_private from public, anon;
grant usage on schema pn_private to authenticated;

-- ---------------------------------------------------------------- pn_profiles
create table public.pn_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

-- 승인 여부 / 관리자 여부 확인. security definer 로 pn_profiles RLS 재귀를 피한다.
create function pn_private.is_approved() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.pn_profiles
    where id = (select auth.uid()) and status = 'approved'
  );
$$;

create function pn_private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.pn_profiles
    where id = (select auth.uid()) and status = 'approved' and is_admin
  );
$$;

revoke all on function pn_private.is_approved() from public, anon;
revoke all on function pn_private.is_admin() from public, anon;
grant execute on function pn_private.is_approved() to authenticated;
grant execute on function pn_private.is_admin() to authenticated;

-- 가입 시 pending 프로필 자동 생성
create function pn_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.pn_profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;
revoke all on function pn_private.handle_new_user() from public, anon, authenticated;

create trigger pn_on_auth_user_created
  after insert on auth.users
  for each row execute function pn_private.handle_new_user();

-- 승인되는 순간 approved_at 기록
create function pn_private.touch_profile() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := now();
  end if;
  return new;
end;
$$;
revoke all on function pn_private.touch_profile() from public, anon, authenticated;

create trigger pn_profiles_touch
  before update on public.pn_profiles
  for each row execute function pn_private.touch_profile();

-- 이미 가입된 계정(트리거 이전)의 프로필 보충
insert into public.pn_profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------- pn_papers
create table public.pn_papers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source         text not null check (source in ('arxiv', 'semantic_scholar')),
  source_id      text not null,
  title          text not null,
  authors        text[] not null default '{}',
  year           integer,
  published_date date,
  citation_count integer check (citation_count is null or citation_count >= 0),
  abstract       text,
  doi            text,
  pdf_url        text,
  landing_url    text,
  categories     text[] not null default '{}',
  memo           text not null default '',
  saved_at       timestamptz not null default now(),
  unique (user_id, source, source_id)
);

-- ---------------------------------------------------------------- pn_analyses
create table public.pn_analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  paper_id    uuid not null references public.pn_papers (id) on delete cascade,
  stage       text not null check (stage in ('abstract', 'fulltext')),
  model       text not null,
  result_json jsonb not null,
  created_at  timestamptz not null default now()
);
create index pn_analyses_paper_id_idx on public.pn_analyses (paper_id);
create index pn_analyses_user_id_idx on public.pn_analyses (user_id);

-- ---------------------------------------------------------------- pn_presets
create table public.pn_presets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null,
  position         integer not null,
  query            text not null,
  sources          text[] not null default '{arxiv,semantic_scholar}'
                   check (sources <@ array['arxiv', 'semantic_scholar'] and cardinality(sources) > 0),
  arxiv_categories text[] not null default '{}',
  sort             text not null default 'relevance'
                   check (sort in ('relevance', 'date_desc', 'date_asc', 'citations_desc',
                                   'citations_per_year_desc', 'author_asc', 'title_asc', 'has_pdf_first')),
  date_range       text not null default 'all'
                   check (date_range in ('6m', '1y', '3y', '5y', '10y', 'all')),
  min_citations    integer not null default 0 check (min_citations >= 0),
  result_limit     integer not null default 20 check (result_limit in (10, 20, 30, 50, 100)),
  stats_mode       boolean not null default false
);
create index pn_presets_user_id_idx on public.pn_presets (user_id, position);

-- ---------------------------------------------------------------- RLS
alter table public.pn_profiles enable row level security;
alter table public.pn_papers   enable row level security;
alter table public.pn_analyses enable row level security;
alter table public.pn_presets  enable row level security;

-- 비로그인(anon)은 아예 접근 권한을 주지 않는다 (RLS와 이중 방어)
revoke all on public.pn_profiles, public.pn_papers, public.pn_analyses, public.pn_presets from anon;

-- 프로필: 본인 행 읽기 / 관리자는 전체 읽기. 수정은 관리자만. INSERT·DELETE 정책 없음.
create policy pn_profiles_select on public.pn_profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select pn_private.is_admin()));

create policy pn_profiles_update_admin on public.pn_profiles
  for update to authenticated
  using ((select pn_private.is_admin()))
  with check ((select pn_private.is_admin()));

-- 논문, 프리셋: 본인 행 + 승인된 계정
create policy pn_papers_own on public.pn_papers
  for all to authenticated
  using (user_id = (select auth.uid()) and (select pn_private.is_approved()))
  with check (user_id = (select auth.uid()) and (select pn_private.is_approved()));

create policy pn_presets_own on public.pn_presets
  for all to authenticated
  using (user_id = (select auth.uid()) and (select pn_private.is_approved()))
  with check (user_id = (select auth.uid()) and (select pn_private.is_approved()));

-- 분석: 본인 행 + 승인된 계정 + 연결된 논문도 본인 것이어야 함
create policy pn_analyses_own on public.pn_analyses
  for all to authenticated
  using (user_id = (select auth.uid()) and (select pn_private.is_approved()))
  with check (
    user_id = (select auth.uid())
    and (select pn_private.is_approved())
    and exists (
      select 1 from public.pn_papers p
      where p.id = paper_id and p.user_id = (select auth.uid())
    )
  );
