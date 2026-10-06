-- 기본 검색 프리셋 7개: 가입이 승인되는 순간 DB가 만든다. (PRD "검색 프리셋", 우선순위 순서)
--   * 프리셋이 하나도 없는 계정에만 채운다 (다시 승인되거나 두 번 실행되어도 중복되지 않는다).
--   * 기간과 인용수 필터는 "제한 없음", 검색 개수는 20 (열의 기본값).
--   * 기본 정렬: 새 논문이 중요한 arXiv 중심 분야(1~4)는 최신순, 교육 분야(5~7)는 관련도순.
--   * 통계 분석 모드는 "통계"와 "데이터분석"에서 기본으로 켠다.

create function pn_private.seed_default_presets(uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.pn_presets where user_id = uid) then
    return;
  end if;

  insert into public.pn_presets (user_id, name, position, query, sources, arxiv_categories, sort, stats_mode) values
    (uid, '통계',          1, 'structural equation modeling, multilevel model',
       '{arxiv,semantic_scholar}', '{stat.ME,stat.AP}',  'date_desc', true),
    (uid, '데이터분석',    2, 'data analysis, statistical computing, Python',
       '{arxiv,semantic_scholar}', '{}',                 'date_desc', true),
    (uid, 'AI·바이브 코딩', 3, 'large language model, vibe coding, AI-assisted programming',
       '{arxiv,semantic_scholar}', '{cs.AI,cs.LG,cs.SE}', 'date_desc', false),
    (uid, '생명과학',      4, 'computational biology, bioinformatics',
       '{arxiv,semantic_scholar}', '{q-bio.*}',          'date_desc', false),
    (uid, '학습동기',      5, 'learning motivation, self-determination theory',
       '{semantic_scholar}',       '{}',                 'relevance', false),
    (uid, '교육심리',      6, 'educational psychology',
       '{semantic_scholar}',       '{}',                 'relevance', false),
    (uid, '교육방법',      7, 'instructional method, active learning',
       '{semantic_scholar}',       '{}',                 'relevance', false);
end;
$$;
revoke all on function pn_private.seed_default_presets(uuid) from public, anon, authenticated;

create function pn_private.on_profile_approved() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pn_private.seed_default_presets(new.id);
  return new;
end;
$$;
revoke all on function pn_private.on_profile_approved() from public, anon, authenticated;

-- status가 approved가 아니던 계정이 approved로 바뀔 때만
create trigger pn_profiles_seed_presets
  after update of status on public.pn_profiles
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function pn_private.on_profile_approved();

-- 이미 승인된 계정(이 마이그레이션 이전에 승인됨)에는 한 번 채운다
select pn_private.seed_default_presets(id) from public.pn_profiles where status = 'approved';
