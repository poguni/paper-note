-- RLS 시험 (Phase 1에서 실행, Phase 5 보안 재확인에서 다시 실행)
-- 실행: Supabase SQL Editor 또는 execute_sql 로 그대로 실행한다.
-- 시험용 계정은 한 트랜잭션 안에서만 만들고, 마지막에 일부러 예외를 내서 전부 롤백한다.
-- 그래서 결과는 "RLS_TEST_RESULT" 오류 메시지 안에 나온다. FAIL 이 한 줄이라도 있으면 정책을 고쳐야 한다.
-- 실행 후 `select count(*) from auth.users where email like '%@test.invalid'` 가 0 인지 확인한다.

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  r text := ''; n int; pid uuid; adm_flag boolean; ap timestamptz;
begin
  -- 준비: 시험용 계정 4개 (트리거가 pending 프로필을 만들어야 한다)
  insert into auth.users (id, email, aud, role) values
    (a,   'rls-a@test.invalid',   'authenticated', 'authenticated'),
    (b,   'rls-b@test.invalid',   'authenticated', 'authenticated'),
    (p,   'rls-p@test.invalid',   'authenticated', 'authenticated'),
    (adm, 'rls-adm@test.invalid', 'authenticated', 'authenticated');
  select count(*) into n from public.pn_profiles where id in (a,b,p,adm) and status = 'pending';
  r := r || format('T0  가입 트리거가 pending 프로필 생성 (%s/4): %s', n, case when n = 4 then 'PASS' else 'FAIL' end) || E'\n';

  update public.pn_profiles set status = 'approved' where id in (a, b, adm);
  update public.pn_profiles set is_admin = true where id = adm;
  select approved_at into ap from public.pn_profiles where id = a;
  r := r || 'T0b 승인 시 approved_at 기록: ' || case when ap is not null then 'PASS' else 'FAIL' end || E'\n';

  -- T1 비로그인(anon)
  begin
    set local role anon;
    perform 1 from public.pn_papers limit 1;
    r := r || 'T1  anon 읽기 거부: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'T1  anon 읽기 거부: PASS' || E'\n';
  end;
  reset role;

  -- T3 승인 계정 A: 자기 데이터 쓰기·읽기
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.pn_papers (source, source_id, title) values ('arxiv', 'a1', 'A paper') returning id into pid;
  insert into public.pn_analyses (paper_id, stage, model, result_json) values (pid, 'abstract', 'm', '{}');
  insert into public.pn_presets (name, position, query) values ('p', 99, 'q'); -- 승인되면 기본 프리셋 7개가 생기므로 겹치지 않는 자리
  select count(*) into n from public.pn_papers;
  r := r || format('T3  승인 계정 A 쓰기 후 자기 논문 수 (1 기대): %s %s', n, case when n = 1 then 'PASS' else 'FAIL' end) || E'\n';
  select count(*) into n from public.pn_profiles where id in (a,b,p,adm);
  r := r || format('T3b 일반 계정 A가 보이는 프로필 수 (1 기대): %s %s', n, case when n = 1 then 'PASS' else 'FAIL' end) || E'\n';

  -- T4 계정 B: A의 데이터 격리
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pn_papers;
  r := r || format('T4  계정 B가 보이는 A의 논문 수 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';
  update public.pn_papers set memo = 'hacked' where id = pid;
  get diagnostics n = row_count;
  r := r || format('T4b B가 A의 논문 수정 시도, 영향 행 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';
  delete from public.pn_papers where id = pid;
  get diagnostics n = row_count;
  r := r || format('T4c B가 A의 논문 삭제 시도, 영향 행 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';
  begin
    insert into public.pn_analyses (paper_id, stage, model, result_json) values (pid, 'abstract', 'm', '{}');
    r := r || 'T4d B가 A의 논문에 분석 연결: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'T4d B가 A의 논문에 분석 연결 거부: PASS' || E'\n';
  end;
  begin
    insert into public.pn_papers (user_id, source, source_id, title) values (a, 'arxiv', 'b-as-a', 'x');
    r := r || 'T4e B가 user_id를 A로 속여 저장: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'T4e B가 user_id를 A로 속여 저장 거부: PASS' || E'\n';
  end;

  -- T2 pending 계정 P
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  begin
    insert into public.pn_papers (source, source_id, title) values ('arxiv', 'p1', 'x');
    r := r || 'T2  pending 계정 쓰기: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'T2  pending 계정 쓰기 거부: PASS' || E'\n';
  end;
  select count(*) into n from public.pn_papers;
  r := r || format('T2b pending 계정이 보이는 논문 수 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';
  select count(*) into n from public.pn_profiles where id in (a,b,p,adm);
  r := r || format('T2c pending 계정이 보이는 프로필 수 (자기 1 기대): %s %s', n, case when n = 1 then 'PASS' else 'FAIL' end) || E'\n';

  -- T5 자기 승인/관리자 권한 상승 시도
  update public.pn_profiles set status = 'approved' where id = p;
  get diagnostics n = row_count;
  r := r || format('T5  pending 계정이 스스로 승인 시도, 영향 행 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.pn_profiles set is_admin = true where id = a;
  get diagnostics n = row_count;
  r := r || format('T5b 승인 계정이 스스로 관리자 승격 시도, 영향 행 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';
  begin
    insert into public.pn_profiles (id, email) values (gen_random_uuid(), 'x@test.invalid');
    r := r || 'T5c 프로필 직접 INSERT: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege or foreign_key_violation then
    r := r || 'T5c 프로필 직접 INSERT 거부: PASS' || E'\n';
  end;
  delete from public.pn_profiles where id = a;
  get diagnostics n = row_count;
  r := r || format('T5d 프로필 DELETE 시도, 영향 행 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';

  -- T6 관리자
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pn_profiles where id in (a,b,p,adm);
  r := r || format('T6  관리자가 보이는 프로필 수 (4 기대): %s %s', n, case when n = 4 then 'PASS' else 'FAIL' end) || E'\n';
  update public.pn_profiles set status = 'approved' where id = p;
  get diagnostics n = row_count;
  r := r || format('T6b 관리자가 P를 승인, 영향 행 (1 기대): %s %s', n, case when n = 1 then 'PASS' else 'FAIL' end) || E'\n';
  select count(*) into n from public.pn_papers;
  r := r || format('T6c 관리자도 남의 논문은 못 봄 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';

  -- T7 승인 후 P는 쓰기 가능
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  insert into public.pn_papers (source, source_id, title) values ('arxiv', 'p1', 'x');
  r := r || 'T7  승인된 P가 쓰기 성공: PASS' || E'\n';

  -- 최종 상태 확인 (슈퍼유저로 돌아와서)
  reset role;
  select is_admin into adm_flag from public.pn_profiles where id = a;
  r := r || 'T8  A의 is_admin이 여전히 false: ' || case when adm_flag is false then 'PASS' else 'FAIL' end || E'\n';

  -- 롤백을 위해 일부러 예외로 끝낸다 (결과는 메시지로 전달)
  raise exception 'RLS_TEST_RESULT:%', E'\n' || r;
end $$;
