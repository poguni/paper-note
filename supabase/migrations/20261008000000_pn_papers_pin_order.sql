-- 내 서재에서 논문 카드를 "맨 위에 고정"하고, 읽을 차례를 직접 정할 수 있게 열 두 개를 더한다.
--  - pinned: true면 어떤 정렬에서도 목록 맨 위에 놓인다.
--  - sort_index: "내 순서" 정렬에서 쓰는 자리 번호(작을수록 앞). null이면 아직 순서를 정하지 않은 논문이고, 새로 저장한 논문이 위에 오도록 맨 앞에 둔다.
-- 기존 RLS 정책(pn_papers_own, 소유자와 승인 확인)이 그대로 적용된다. 이미 저장된 논문은 pinned=false, sort_index=null로 남는다.

alter table public.pn_papers
  add column pinned boolean not null default false,
  add column sort_index integer;
