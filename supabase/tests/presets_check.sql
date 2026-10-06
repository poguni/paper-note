-- 기본 프리셋 생성 시험. rls_check.sql 과 같은 방식: 한 트랜잭션 안에서 시험용 계정을 만들고 마지막에 일부러 예외로 롤백한다.
-- 결과는 "PRESET_TEST_RESULT" 오류 메시지 안에 나온다. FAIL 이 한 줄이라도 있으면 함수를 고쳐야 한다.
-- 실행 후 `select count(*) from auth.users where email like '%@test.invalid'` 가 0 인지 확인한다.

do $$
declare
  a uuid := gen_random_uuid();
  r text := ''; n int; names text; ok boolean;
begin
  insert into auth.users (id, email, aud, role) values (a, 'preset-a@test.invalid', 'authenticated', 'authenticated');

  select count(*) into n from public.pn_presets where user_id = a;
  r := r || format('T1  가입 직후(승인 전)에는 프리셋이 없다 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';

  update public.pn_profiles set status = 'approved' where id = a;
  select count(*), string_agg(name, ',' order by position) into n, names from public.pn_presets where user_id = a;
  r := r || format('T2  승인되면 7개가 우선순위 순서로 생긴다: %s개 %s', n,
    case when n = 7 and names = '통계,데이터분석,AI·바이브 코딩,생명과학,학습동기,교육심리,교육방법' then 'PASS' else 'FAIL (' || coalesce(names, '') || ')' end) || E'\n';

  select count(*) = 7 and bool_and(date_range = 'all' and min_citations = 0 and result_limit = 20) into ok
    from public.pn_presets where user_id = a;
  r := r || 'T2b 모든 프리셋의 필터 기본값(기간 제한 없음, 인용수 0, 개수 20): ' || case when ok then 'PASS' else 'FAIL' end || E'\n';

  select bool_and(stats_mode = (name in ('통계', '데이터분석'))) into ok from public.pn_presets where user_id = a;
  r := r || 'T2c 통계 분석 모드는 통계·데이터분석에서만 켜짐: ' || case when ok then 'PASS' else 'FAIL' end || E'\n';

  select bool_and(case when position <= 4 then sources = '{arxiv,semantic_scholar}' and sort = 'date_desc'
                       else sources = '{semantic_scholar}' and sort = 'relevance' end) into ok
    from public.pn_presets where user_id = a;
  r := r || 'T2d 소스와 기본 정렬 (1~4는 두 소스·최신순, 5~7은 Semantic Scholar·관련도순): ' || case when ok then 'PASS' else 'FAIL' end || E'\n';

  select arxiv_categories = '{stat.ME,stat.AP}' into ok from public.pn_presets where user_id = a and name = '통계';
  r := r || 'T2e 통계 프리셋의 arXiv 분류: ' || case when ok then 'PASS' else 'FAIL' end || E'\n';

  -- 다시 승인되어도 늘어나지 않는다
  update public.pn_profiles set status = 'rejected' where id = a;
  update public.pn_profiles set status = 'approved' where id = a;
  select count(*) into n from public.pn_presets where user_id = a;
  r := r || format('T3  거절 후 다시 승인해도 7개 그대로: %s %s', n, case when n = 7 then 'PASS' else 'FAIL' end) || E'\n';

  -- 프리셋이 하나라도 남아 있으면 다시 채우지 않는다 (사용자가 지운 것을 되살리지 않는다)
  delete from public.pn_presets where user_id = a and position > 1;
  update public.pn_profiles set status = 'pending' where id = a;
  update public.pn_profiles set status = 'approved' where id = a;
  select count(*) into n from public.pn_presets where user_id = a;
  r := r || format('T4  일부만 지운 뒤 다시 승인해도 되살리지 않는다 (1 기대): %s %s', n, case when n = 1 then 'PASS' else 'FAIL' end) || E'\n';

  -- 승인 계정은 자기 프리셋을 읽을 수 있다 (RLS)
  delete from public.pn_presets where user_id = a;
  update public.pn_profiles set status = 'rejected' where id = a;
  update public.pn_profiles set status = 'approved' where id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.pn_presets;
  r := r || format('T5  승인 계정이 RLS로 자기 프리셋을 읽는다 (7 기대): %s %s', n, case when n = 7 then 'PASS' else 'FAIL' end) || E'\n';

  -- 로그인한 사용자가 생성 함수를 직접 호출할 수 없다
  begin
    perform pn_private.seed_default_presets(a);
    r := r || 'T6  authenticated가 생성 함수 직접 호출: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'T6  authenticated가 생성 함수 직접 호출 거부: PASS' || E'\n';
  end;
  reset role;

  begin
    set local role anon;
    perform pn_private.seed_default_presets(a);
    r := r || 'T7  anon이 생성 함수 직접 호출: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'T7  anon이 생성 함수 직접 호출 거부: PASS' || E'\n';
  end;
  reset role;

  raise exception 'PRESET_TEST_RESULT:%', E'\n' || r;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 두 번째 시험: 실제 운영 경로. 위 시험은 슈퍼유저 권한으로 승인을 바꾸지만, 실제로는 로그인한 관리자가
-- authenticated 권한으로 승인한다. 이 경로에서도 트리거가 프리셋을 만드는지 확인한다. (위 시험과 따로 실행한다)
-- 결과는 "ADMIN_PATH_RESULT" 오류 메시지 안에 나온다.
do $$
declare
  adm uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  r text := ''; n int;
begin
  insert into auth.users (id, email, aud, role) values
    (adm, 'preset-adm@test.invalid', 'authenticated', 'authenticated'),
    (p,   'preset-p@test.invalid',   'authenticated', 'authenticated');
  update public.pn_profiles set status = 'approved', is_admin = true where id = adm;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.pn_profiles set status = 'approved' where id = p;
  get diagnostics n = row_count;
  r := r || format('A1  관리자(authenticated)가 대기 계정을 승인, 영향 행 (1 기대): %s %s', n, case when n = 1 then 'PASS' else 'FAIL' end) || E'\n';

  select count(*) into n from public.pn_presets where user_id = p;
  r := r || format('A2  관리자 권한으로 승인해도 RLS 때문에 남의 프리셋은 안 보임 (0 기대): %s %s', n, case when n = 0 then 'PASS' else 'FAIL' end) || E'\n';
  reset role;

  select count(*) into n from public.pn_presets where user_id = p;
  r := r || format('A3  그래도 트리거가 승인된 계정의 프리셋 7개를 만들었다 (슈퍼유저로 확인): %s %s', n, case when n = 7 then 'PASS' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.pn_presets;
  r := r || format('A4  승인된 본인이 자기 프리셋을 읽는다 (7 기대): %s %s', n, case when n = 7 then 'PASS' else 'FAIL' end) || E'\n';
  reset role;

  raise exception 'ADMIN_PATH_RESULT:%', E'\n' || r;
end $$;
