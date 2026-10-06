-- 분석 단계(stage) 제약 시험: 'translation'(전문 번역)이 허용되고, 다른 값은 거절되며, RLS는 그대로인지 확인한다.
-- rls_check.sql 과 같은 방식(한 트랜잭션 안에서 만들고 마지막에 예외로 롤백). 결과는 "ANALYSES_STAGE_RESULT" 메시지 안에 나온다.
-- 실행 후 `select count(*) from auth.users where email like '%@test.invalid'` 가 0 인지 확인한다.

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  paper uuid; r text := ''; n int; stages text;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'st-a@test.invalid', 'authenticated', 'authenticated'),
    (b, 'st-b@test.invalid', 'authenticated', 'authenticated');
  update public.pn_profiles set status = 'approved' where id in (a, b);

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.pn_papers (source, source_id, title) values ('arxiv', 'st1', 'paper') returning id into paper;

  insert into public.pn_analyses (paper_id, stage, model, result_json) values
    (paper, 'abstract', 'm', '{}'), (paper, 'fulltext', 'm', '{}'),
    (paper, 'translation', 'm', '{"title":"1 Introduction","ko":"서론 번역"}');
  select string_agg(stage, ',' order by stage) into stages from public.pn_analyses where paper_id = paper;
  r := r || 'S1  abstract, fulltext, translation 모두 저장됨: ' || stages || ' ' || case when stages = 'abstract,fulltext,translation' then 'PASS' else 'FAIL' end || E'\n';

  begin
    insert into public.pn_analyses (paper_id, stage, model, result_json) values (paper, 'unknown', 'm', '{}');
    r := r || 'S2  알 수 없는 단계: FAIL (허용됨)' || E'\n';
  exception when check_violation then
    r := r || 'S2  알 수 없는 단계 거절: PASS' || E'\n';
  end;

  -- 같은 섹션을 다시 번역하면 새 행이 생긴다 (덮어쓰지 않는다)
  insert into public.pn_analyses (paper_id, stage, model, result_json)
    values (paper, 'translation', 'm2', '{"title":"1 Introduction","ko":"다른 모델의 번역"}');
  select count(*) into n from public.pn_analyses where paper_id = paper and stage = 'translation';
  r := r || 'S3  같은 섹션의 번역이 여러 건: ' || n || ' ' || case when n = 2 then 'PASS' else 'FAIL' end || E'\n';

  -- 다른 계정은 남의 번역을 읽지도 쓰지도 못한다
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pn_analyses;
  r := r || 'S4  다른 계정이 보는 분석 수 (0 기대): ' || n || ' ' || case when n = 0 then 'PASS' else 'FAIL' end || E'\n';
  begin
    insert into public.pn_analyses (paper_id, stage, model, result_json) values (paper, 'translation', 'm', '{"title":"x","ko":"y"}');
    r := r || 'S5  남의 논문에 번역 저장: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'S5  남의 논문에 번역 저장 거절: PASS' || E'\n';
  end;
  reset role;

  -- 논문을 지우면 번역도 함께 지워진다
  delete from public.pn_papers where id = paper;
  select count(*) into n from public.pn_analyses where paper_id = paper;
  r := r || 'S6  논문 삭제 시 분석과 번역도 삭제 (0 기대): ' || n || ' ' || case when n = 0 then 'PASS' else 'FAIL' end || E'\n';

  raise exception 'ANALYSES_STAGE_RESULT:%', E'\n' || r;
end $$;
