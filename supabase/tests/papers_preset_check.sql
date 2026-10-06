-- 논문-프리셋 연결(pn_papers.preset_id) 시험. rls_check.sql 과 같은 방식: 한 트랜잭션 안에서 시험용 계정을 만들고 마지막에 일부러 예외로 롤백한다.
-- 결과는 "PAPERS_PRESET_RESULT" 오류 메시지 안에 나온다. FAIL 이 한 줄이라도 있으면 정책을 고쳐야 한다.
-- 실행 후 `select count(*) from auth.users where email like '%@test.invalid'` 가 0 인지 확인한다.

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  pa uuid; pb uuid; paper uuid;
  r text := ''; n int; got uuid;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'pp-a@test.invalid', 'authenticated', 'authenticated'),
    (b, 'pp-b@test.invalid', 'authenticated', 'authenticated');
  update public.pn_profiles set status = 'approved' where id in (a, b); -- 승인되면 기본 프리셋 7개가 생긴다
  select id into pa from public.pn_presets where user_id = a order by position limit 1;
  select id into pb from public.pn_presets where user_id = b order by position limit 1;
  r := r || 'T0  두 계정 모두 프리셋이 있다: ' || case when pa is not null and pb is not null then 'PASS' else 'FAIL' end || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- P1 자기 프리셋을 연결해서 저장
  insert into public.pn_papers (source, source_id, title, preset_id) values ('arxiv', 'pp1', 'with my preset', pa) returning id into paper;
  select preset_id into got from public.pn_papers where id = paper;
  r := r || 'P1  자기 프리셋을 연결해 저장: ' || case when got = pa then 'PASS' else 'FAIL' end || E'\n';

  -- P2 프리셋 없이 저장
  insert into public.pn_papers (source, source_id, title) values ('arxiv', 'pp2', 'no preset');
  select count(*) into n from public.pn_papers where source_id = 'pp2' and preset_id is null;
  r := r || 'P2  프리셋 없이 저장(null): ' || case when n = 1 then 'PASS' else 'FAIL' end || E'\n';

  -- P3 남의 프리셋을 연결해 저장하면 거절
  begin
    insert into public.pn_papers (source, source_id, title, preset_id) values ('arxiv', 'pp3', 'steal', pb);
    r := r || 'P3  남의 프리셋 연결 저장: FAIL (허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'P3  남의 프리셋 연결 저장 거절: PASS' || E'\n';
  end;

  -- P4 기존 논문을 남의 프리셋으로 바꾸면 거절 (UPDATE도 with check를 거친다)
  begin
    update public.pn_papers set preset_id = pb where id = paper;
    get diagnostics n = row_count;
    r := r || 'P4  남의 프리셋으로 수정: FAIL (' || n || '행 허용됨)' || E'\n';
  exception when insufficient_privilege then
    r := r || 'P4  남의 프리셋으로 수정 거절: PASS' || E'\n';
  end;

  -- P5 자기 프리셋으로는 수정 가능, null로도 가능
  update public.pn_papers set preset_id = null where id = paper;
  select preset_id into got from public.pn_papers where id = paper;
  r := r || 'P5  자기 논문의 연결을 null로 수정: ' || case when got is null then 'PASS' else 'FAIL' end || E'\n';
  update public.pn_papers set preset_id = pa where id = paper;
  reset role;

  -- P6 프리셋을 지워도 논문은 남고 연결만 끊어진다
  delete from public.pn_presets where id = pa;
  select count(*), max(preset_id::text) into n, got from public.pn_papers where id = paper;
  r := r || format('P6  프리셋 삭제 후 논문은 남고 연결은 null (논문 %s건): %s', n, case when n = 1 and got is null then 'PASS' else 'FAIL' end) || E'\n';

  -- P7 다른 계정은 남의 논문을 보지 못한다 (기존 RLS가 그대로)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.pn_papers;
  r := r || 'P7  다른 계정은 남의 논문이 안 보임 (0 기대): ' || n || ' ' || case when n = 0 then 'PASS' else 'FAIL' end || E'\n';
  reset role;

  raise exception 'PAPERS_PRESET_RESULT:%', E'\n' || r;
end $$;
