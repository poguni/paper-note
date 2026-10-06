-- 내 서재의 "프리셋별 필터"를 위해, 논문을 저장할 때 어느 프리셋의 검색에서 나온 것인지 기록한다.
--  - 프리셋을 지우면 논문은 그대로 두고 연결만 끊는다 (on delete set null).
--  - 남의 프리셋을 가리키지 못하게 RLS의 with check에 소유자 확인을 더한다.
--  - 이미 저장된 논문은 preset_id가 null(프리셋 없음)로 남는다.

alter table public.pn_papers
  add column preset_id uuid references public.pn_presets (id) on delete set null;

create index pn_papers_preset_idx on public.pn_papers (preset_id);

drop policy pn_papers_own on public.pn_papers;

create policy pn_papers_own on public.pn_papers
  for all to authenticated
  using (user_id = (select auth.uid()) and (select pn_private.is_approved()))
  with check (
    user_id = (select auth.uid())
    and (select pn_private.is_approved())
    and (
      preset_id is null
      or exists (
        select 1 from public.pn_presets s
        where s.id = preset_id and s.user_id = (select auth.uid())
      )
    )
  );
