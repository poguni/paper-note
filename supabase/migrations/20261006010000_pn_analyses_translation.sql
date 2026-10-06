-- 전문 번역(섹션 단위) 결과를 pn_analyses에 저장하려고 stage에 'translation'을 허용한다.
--  - 한 행이 섹션 하나의 번역: result_json = { "title": 섹션 제목, "ko": 번역문 }
--  - 기존 행(abstract, fulltext)은 그대로이고, RLS 정책은 바꾸지 않는다.

alter table public.pn_analyses drop constraint pn_analyses_stage_check;

alter table public.pn_analyses
  add constraint pn_analyses_stage_check check (stage in ('abstract', 'fulltext', 'translation'));
