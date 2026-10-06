import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PN, NOW } from './helpers/search-env.mjs';
import { buildUpstream } from '../supabase/functions/pn-search-proxy/requests.ts';

await import('../src/js/db/papers.js');
await import('../src/js/db/presets.js');

const sql = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const INIT = sql('20261005000000_pn_init.sql');
const SEED = sql('20261005010000_pn_default_presets.sql');

// CREATE TABLE public.<name> ( ... ); 안의 열 이름들
function columnsOf(table) {
  const body = INIT.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`))[1];
  return body.split('\n').map((l) => l.trim().match(/^([a-z_]+)\s+[a-z]/)?.[1]).filter((c) => c && !['unique', 'primary', 'check'].includes(c));
}

// ---- 가짜 Supabase 클라이언트: from(...).select().eq()... 를 기록하고, handler가 결과를 정한다
function fakeClient(handler) {
  const log = [];
  const client = {
    from(table) {
      const state = { table, filters: [], single: null };
      const b = {
        select(cols) { state.select = cols; return b; },
        insert(row) { state.op = 'insert'; state.row = row; return b; },
        delete() { state.op = 'delete'; return b; },
        update(row) { state.op = 'update'; state.row = row; return b; },
        eq(col, val) { state.filters.push([col, val]); return b; },
        order(col, opts) { state.order = [col, opts]; return b; },
        range(from, to) { state.range = [from, to]; return b; },
        single() { state.single = 'single'; return b; },
        maybeSingle() { state.single = 'maybe'; return b; },
        then(resolve, reject) { log.push({ ...state }); return Promise.resolve(handler({ ...state, op: state.op || 'select' })).then(resolve, reject); },
      };
      return b;
    },
  };
  return { client, log };
}

const paper = (over = {}) => ({
  source: 'arxiv', sourceId: '1406.5823', sources: ['arxiv', 'semantic_scholar'], arxivId: '1406.5823', s2Id: 'S2ID',
  doi: '10.18637/JSS.V067.I01', title: 'Fitting Linear Mixed-Effects Models Using lme4', authors: ['A', 'B'], year: 2014,
  publishedDate: '2014-06-23', abstract: 'abs', pdfUrl: 'https://arxiv.org/pdf/1406.5823v1', landingUrl: 'https://arxiv.org/abs/1406.5823',
  categories: ['stat.CO'], venue: 'JSS', citationCount: 88315, rank: 0, ...over,
});

// ---------------------------------------------------------------- paperToRow
test('paperToRow: 검색 결과를 pn_papers 열 이름으로 바꾼다', () => {
  assert.deepEqual(PN.paperToRow(paper()), {
    source: 'arxiv', source_id: '1406.5823', title: 'Fitting Linear Mixed-Effects Models Using lme4', authors: ['A', 'B'],
    year: 2014, published_date: '2014-06-23', citation_count: 88315, abstract: 'abs', doi: '10.18637/JSS.V067.I01',
    pdf_url: 'https://arxiv.org/pdf/1406.5823v1', landing_url: 'https://arxiv.org/abs/1406.5823', categories: ['stat.CO'],
  });
});

test('paperToRow: 값이 없으면 null, 인용수 0은 0으로 보낸다', () => {
  const row = PN.paperToRow(paper({ year: null, publishedDate: null, citationCount: 0, abstract: null, doi: null, pdfUrl: null, landingUrl: null, authors: undefined, categories: undefined }));
  assert.equal(row.year, null);
  assert.equal(row.published_date, null);
  assert.equal(row.citation_count, 0);
  assert.equal(row.abstract, null);
  assert.equal(row.doi, null);
  assert.equal(row.pdf_url, null);
  assert.deepEqual(row.authors, []);
  assert.deepEqual(row.categories, []);
});

test('paperToRow: 소유자와 DB가 채우는 열은 보내지 않고, 모든 열이 실제 테이블에 있다 (SQL과 대조)', () => {
  const cols = columnsOf('pn_papers');
  assert.ok(cols.includes('user_id') && cols.includes('source_id'));
  const keys = Object.keys(PN.paperToRow(paper()));
  for (const k of keys) assert.ok(cols.includes(k), `pn_papers에 없는 열: ${k}`);
  for (const k of ['id', 'user_id', 'memo', 'saved_at']) assert.ok(!keys.includes(k), `보내면 안 되는 열: ${k}`);
  // NOT NULL이고 기본값이 없는 열은 모두 채워서 보낸다
  for (const required of ['source', 'source_id', 'title']) assert.ok(keys.includes(required));
});

// ---------------------------------------------------------------- 저장 여부 색인
test('savedIndex: source와 source_id로 찾는다', () => {
  const idx = PN.createSavedIndex([{ id: 'r1', source: 'arxiv', source_id: '1406.5823', doi: null }]);
  assert.equal(idx.find(paper()).id, 'r1');
  assert.equal(idx.has(paper({ sourceId: '9999.9999', arxivId: '9999.9999', s2Id: null, doi: null })), false);
});

test('savedIndex: 소스에 따라 다른 ID로 보이는 같은 논문도 찾는다 (arXiv ID, Semantic Scholar ID, DOI)', () => {
  const s2Only = { source: 'semantic_scholar', sourceId: 'S2ID', sources: ['semantic_scholar'], arxivId: null, s2Id: 'S2ID', doi: null };
  // 예전에 Semantic Scholar ID로 저장됨 → 지금은 arXiv ID로 합쳐진 논문으로 보여도 s2Id로 찾는다
  assert.equal(PN.createSavedIndex([{ id: 'a', source: 'semantic_scholar', source_id: 'S2ID', doi: null }]).find(paper()).id, 'a');
  // arXiv로 저장됨 → Semantic Scholar 쪽만 아는 논문이 DOI(대소문자 무관)로 같은 논문임을 알린다
  const idx = PN.createSavedIndex([{ id: 'b', source: 'arxiv', source_id: '1406.5823', doi: '10.18637/jss.v067.i01' }]);
  assert.equal(idx.find({ ...s2Only, sourceId: 'OTHER', s2Id: 'OTHER', doi: '10.18637/JSS.V067.I01' }).id, 'b');
  // arXiv ID만 알려진 경우
  assert.equal(idx.find({ ...s2Only, sourceId: 'X', s2Id: 'X', arxivId: '1406.5823' }).id, 'b');
  // 아무 것도 겹치지 않으면 없음
  assert.equal(idx.find({ ...s2Only, sourceId: 'Z', s2Id: 'Z' }), undefined);
});

test('savedIndex: add와 removeById', () => {
  const idx = PN.createSavedIndex([]);
  assert.equal(idx.has(paper()), false);
  idx.add({ id: 'r1', source: 'arxiv', source_id: '1406.5823', doi: '10.18637/jss.v067.i01' });
  assert.equal(idx.has(paper()), true);
  idx.removeById('r1');
  assert.equal(idx.has(paper()), false);
  idx.removeById('nope'); // 없는 id를 지워도 오류 없음
});

// ---------------------------------------------------------------- 논문 저장 API
const ROW = { id: 'r1', source: 'arxiv', source_id: '1406.5823', doi: null };

test('save: 새 논문은 insert하고 저장된 행을 돌려준다', async () => {
  const { client, log } = fakeClient(() => ({ data: ROW, error: null }));
  const res = await PN.createPapersApi(client).save(paper());
  assert.deepEqual(res, { status: 'saved', row: ROW });
  assert.equal(log[0].table, 'pn_papers');
  assert.equal(log[0].op, 'insert');
  assert.deepEqual(log[0].row, PN.paperToRow(paper()));
  assert.equal(log[0].single, 'single');
});

test('save: 이미 저장된 논문(유일 키 충돌 23505)은 새로 만들지 않고 기존 행을 돌려준다', async () => {
  const { client, log } = fakeClient((s) => (s.op === 'insert' ? { data: null, error: { code: '23505' } } : { data: ROW, error: null }));
  const res = await PN.createPapersApi(client).save(paper());
  assert.deepEqual(res, { status: 'exists', row: ROW });
  assert.deepEqual(log[1].filters, [['source', 'arxiv'], ['source_id', '1406.5823']]);
});

test('save: 충돌했는데 기존 행을 못 찾으면, 그리고 그 밖의 오류(RLS 등)는 오류로 던진다', async () => {
  let c = fakeClient((s) => (s.op === 'insert' ? { data: null, error: { code: '23505' } } : { data: null, error: null }));
  await assert.rejects(PN.createPapersApi(c.client).save(paper()), (e) => e.code === '23505');
  c = fakeClient(() => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }));
  await assert.rejects(PN.createPapersApi(c.client).save(paper()), (e) => e.code === '42501');
});

test('remove: id로 지우고, 지운 행이 있으면 true, 이미 없었으면 false', async () => {
  let c = fakeClient(() => ({ data: [{ id: 'r1' }], error: null }));
  assert.equal(await PN.createPapersApi(c.client).remove('r1'), true);
  assert.equal(c.log[0].op, 'delete');
  assert.deepEqual(c.log[0].filters, [['id', 'r1']]);
  c = fakeClient(() => ({ data: [], error: null }));
  assert.equal(await PN.createPapersApi(c.client).remove('r1'), false);
  c = fakeClient(() => ({ data: null, error: { code: '42501' } }));
  await assert.rejects(PN.createPapersApi(c.client).remove('r1'), (e) => e.code === '42501');
});

test('getMemo: id로 memo 열만 읽고, 행이 없으면 null, 오류는 던진다', async () => {
  let c = fakeClient(() => ({ data: { memo: '내 메모' }, error: null }));
  assert.equal(await PN.createPapersApi(c.client).getMemo('r1'), '내 메모');
  assert.equal(c.log[0].select, 'memo');
  assert.deepEqual(c.log[0].filters, [['id', 'r1']]);
  c = fakeClient(() => ({ data: null, error: null }));
  assert.equal(await PN.createPapersApi(c.client).getMemo('r1'), null);
  c = fakeClient(() => ({ data: null, error: { code: '42501' } }));
  await assert.rejects(PN.createPapersApi(c.client).getMemo('r1'), (e) => e.code === '42501');
});

test('saveMemo: memo만 바꾸고, 바뀐 행이 있으면 true, 이미 없었으면 false', async () => {
  let c = fakeClient(() => ({ data: [{ id: 'r1' }], error: null }));
  assert.equal(await PN.createPapersApi(c.client).saveMemo('r1', '새 메모'), true);
  assert.equal(c.log[0].op, 'update');
  assert.deepEqual(c.log[0].row, { memo: '새 메모' });
  assert.deepEqual(c.log[0].filters, [['id', 'r1']]);
  c = fakeClient(() => ({ data: [], error: null }));
  assert.equal(await PN.createPapersApi(c.client).saveMemo('r1', 'x'), false);
  c = fakeClient(() => ({ data: null, error: { code: '42501' } }));
  await assert.rejects(PN.createPapersApi(c.client).saveMemo('r1', 'x'), (e) => e.code === '42501');
});

test('listSaved: 1000건씩 끝까지 읽는다', async () => {
  const page = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, source: 'arxiv', source_id: String(i), doi: null }));
  const { client, log } = fakeClient((s) => ({ data: s.range[0] === 0 ? page(1000) : s.range[0] === 1000 ? page(3) : [], error: null }));
  const rows = await PN.createPapersApi(client).listSaved();
  assert.equal(rows.length, 1003);
  assert.deepEqual(log.map((l) => l.range), [[0, 999], [1000, 1999]]);
  assert.equal(log[0].select, 'id,source,source_id,doi');
});

test('listSaved: 1000건 미만이면 한 번에 끝나고, 오류는 던진다', async () => {
  let c = fakeClient(() => ({ data: [], error: null }));
  assert.deepEqual(await PN.createPapersApi(c.client).listSaved(), []);
  assert.equal(c.log.length, 1);
  c = fakeClient(() => ({ data: null, error: { code: 'PGRST301' } }));
  await assert.rejects(PN.createPapersApi(c.client).listSaved(), (e) => e.code === 'PGRST301');
});

test('dbErrorMessage: 오류 종류별 문장', () => {
  assert.equal(PN.dbErrorMessage({ code: '42501' }, '저장'), '이 작업은 승인된 계정만 할 수 있습니다.');
  assert.match(PN.dbErrorMessage({ code: 'PGRST301', message: 'JWT expired' }, '저장'), /다시 로그인/);
  assert.match(PN.dbErrorMessage({ message: 'JWT expired' }), /다시 로그인/);
  assert.match(PN.dbErrorMessage({ message: 'TypeError: Failed to fetch' }, '삭제'), /네트워크 오류로 삭제에 실패했습니다/);
  assert.match(PN.dbErrorMessage({ code: 'XX000' }, '저장'), /저장에 실패했습니다/);
  assert.match(PN.dbErrorMessage(null), /처리에 실패했습니다/);
});

// ---------------------------------------------------------------- 프리셋
const PRESET_ROW = {
  id: 'p1', name: '통계', position: 1, query: 'structural equation modeling, multilevel model',
  sources: ['arxiv', 'semantic_scholar'], arxiv_categories: ['stat.ME', 'stat.AP'], sort: 'date_desc',
  date_range: '5y', min_citations: 10, result_limit: 30, stats_mode: true,
};

test('presetToSearchOpts: 프리셋의 검색어, 소스, 분류, 필터, 정렬을 검색 조건으로 바꾼다', () => {
  assert.deepEqual(PN.presetToSearchOpts(PRESET_ROW), {
    query: 'structural equation modeling, multilevel model', sources: ['arxiv', 'semantic_scholar'], categories: ['stat.ME', 'stat.AP'],
    dateRange: '5y', minCitations: 10, includeUnknownCitations: false, limit: 30, sort: 'date_desc', statsMode: true,
  });
});

test('presetToSearchOpts: 배열은 복사본이라 바꿔도 프리셋 행에 영향이 없다', () => {
  const opts = PN.presetToSearchOpts(PRESET_ROW);
  opts.sources.push('x');
  opts.categories.length = 0;
  assert.deepEqual(PRESET_ROW.sources, ['arxiv', 'semantic_scholar']);
  assert.deepEqual(PRESET_ROW.arxiv_categories, ['stat.ME', 'stat.AP']);
});

test('presetToSearchOpts가 읽는 열은 모두 pn_presets에 있다 (SQL과 대조)', () => {
  const cols = columnsOf('pn_presets');
  for (const c of ['query', 'sources', 'arxiv_categories', 'date_range', 'min_citations', 'result_limit', 'sort', 'stats_mode', 'position']) {
    assert.ok(cols.includes(c), `pn_presets에 없는 열: ${c}`);
  }
});

test('presets.list: 우선순위(position) 순서로 읽는다', async () => {
  let c = fakeClient(() => ({ data: [PRESET_ROW], error: null }));
  assert.deepEqual(await PN.createPresetsApi(c.client).list(), [PRESET_ROW]);
  assert.equal(c.log[0].table, 'pn_presets');
  assert.deepEqual(c.log[0].order, ['position', { ascending: true }]);
  c = fakeClient(() => ({ data: null, error: null }));
  assert.deepEqual(await PN.createPresetsApi(c.client).list(), []);
  c = fakeClient(() => ({ data: null, error: { code: 'PGRST301' } }));
  await assert.rejects(PN.createPresetsApi(c.client).list(), (e) => e.code === 'PGRST301');
});

// ---------------------------------------------------------------- 기본 프리셋 7개 (마이그레이션 SQL과 검색 코드의 일치)
function seededPresets() {
  const out = [];
  const re = /\(uid,\s*'([^']+)',\s*(\d+),\s*'([^']+)',\s*'\{([^}]*)\}',\s*'\{([^}]*)\}',\s*'([a-z_]+)',\s*(true|false)\)/g;
  for (const m of SEED.matchAll(re)) {
    out.push({
      name: m[1], position: Number(m[2]), query: m[3], sources: m[4].split(','), arxiv_categories: m[5] ? m[5].split(',') : [],
      sort: m[6], stats_mode: m[7] === 'true', date_range: 'all', min_citations: 0, result_limit: 20,
    });
  }
  return out;
}

test('기본 프리셋 SQL: PRD의 7개가 우선순위 순서로 들어 있다', () => {
  const presets = seededPresets();
  assert.deepEqual(presets.map((p) => p.name), ['통계', '데이터분석', 'AI·바이브 코딩', '생명과학', '학습동기', '교육심리', '교육방법']);
  assert.deepEqual(presets.map((p) => p.position), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(presets.filter((p) => p.stats_mode).map((p) => p.name), ['통계', '데이터분석']);
});

test('기본 프리셋 SQL: 모든 프리셋이 DB 제약과 검색 코드, 중계 함수의 검증을 통과한다', () => {
  const allowedSort = PN.SORT_KEYS;
  for (const p of seededPresets()) {
    assert.ok(allowedSort.includes(p.sort), `${p.name}: 알 수 없는 정렬 ${p.sort}`);
    assert.ok(p.sources.every((s) => ['arxiv', 'semantic_scholar'].includes(s)) && p.sources.length > 0, `${p.name}: 소스`);

    const opts = PN.presetToSearchOpts(p);
    const terms = PN.parseTerms(opts.query);
    assert.ok(terms.length >= 1 && terms.length <= PN.MAX_TERMS, `${p.name}: 검색어 ${terms.length}개`);
    // 영문 검색어가 쉼표 구분 그대로 모두 살아남는다 (잘리거나 사라진 검색어가 없다)
    assert.equal(terms.length, opts.query.split(',').length, `${p.name}: 검색어가 줄었다`);

    if (p.sources.includes('arxiv')) {
      const q = PN.arxiv.buildSearchQuery({ terms, categories: opts.categories, dateRange: '10y', now: NOW });
      assert.doesNotThrow(() => buildUpstream('arxiv_search', { search_query: q, max_results: 20 }), `${p.name}: ${q}`);
    }
    if (p.sources.includes('semantic_scholar')) {
      for (const t of terms) {
        assert.doesNotThrow(() => buildUpstream('s2_search', PN.s2.buildSearchParams(t, { limit: 20, dateRange: '10y', minCitations: 10, now: NOW }, 0)), `${p.name}: ${t}`);
      }
    }
  }
});

test('기본 프리셋으로 실제 검색 실행기를 돌릴 수 있다 (프리셋 → 검색 조건 → 검색)', async () => {
  const feed = '<feed><opensearch:totalResults>0</opensearch:totalResults></feed>';
  const calls = [];
  const relay = { call: async (op, params) => { buildUpstream(op, params); calls.push(op); return op === 'arxiv_search' ? feed : op === 's2_search' ? { total: 0 } : []; } };
  const instant = { wait: async () => {} };
  const searcher = PN.createSearcher({ relay, queues: { arxiv: instant, s2: instant }, cache: PN.createCache({ ttlMs: 1000, max: 10 }), now: () => NOW });
  for (const p of seededPresets()) {
    const res = await searcher.search(PN.presetToSearchOpts(p));
    assert.deepEqual(res.papers, [], p.name);
  }
  assert.ok(calls.includes('arxiv_search') && calls.includes('s2_search'));
});

// ---------------------------------------------------------------- 분석 결과
await import('../src/js/db/analyses.js');

test('analyses.save: pn_analyses에 논문·단계·모델·결과를 넣고 id와 시각을 돌려준다 (user_id는 보내지 않는다)', async () => {
  const { client, log } = fakeClient(() => ({ data: { id: 'a1', created_at: '2026-10-05T14:00:00Z' }, error: null }));
  const row = await PN.createAnalysesApi(client).save('p1', 'abstract', 'anthropic/claude-sonnet-5.5', { summary_3lines: ['a', 'b', 'c'] });
  assert.deepEqual(row, { id: 'a1', created_at: '2026-10-05T14:00:00Z' });
  assert.equal(log[0].table, 'pn_analyses');
  assert.equal(log[0].op, 'insert');
  assert.deepEqual(Object.keys(log[0].row).sort(), ['model', 'paper_id', 'result_json', 'stage']);
  assert.equal(log[0].single, 'single');
});

test('analyses.save: 같은 논문을 다른 모델로 분석하면 새 행이 따로 생긴다 (덮어쓰지 않는다)', async () => {
  const { client, log } = fakeClient(() => ({ data: { id: 'x', created_at: 't' }, error: null }));
  const api = PN.createAnalysesApi(client);
  await api.save('p1', 'abstract', 'anthropic/claude-sonnet-5.5', {});
  await api.save('p1', 'abstract', 'openai/gpt-6-luna', {});
  assert.equal(log.length, 2);
  assert.ok(log.every((l) => l.op === 'insert'));
  assert.deepEqual(log.map((l) => l.row.model), ['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna']);
});

test('analyses.save: 오류(RLS 거절 등)는 던진다', async () => {
  const { client } = fakeClient(() => ({ data: null, error: { code: '42501' } }));
  await assert.rejects(PN.createAnalysesApi(client).save('p1', 'abstract', 'm', {}), (e) => e.code === '42501');
});

test('analyses.listForPaper: 논문 id로 새것부터 읽고, 없으면 빈 목록', async () => {
  const rows = [{ id: 'a2', stage: 'abstract', model: 'm', result_json: {}, created_at: 't2' }];
  let c = fakeClient(() => ({ data: rows, error: null }));
  assert.deepEqual(await PN.createAnalysesApi(c.client).listForPaper('p1'), rows);
  assert.equal(c.log[0].table, 'pn_analyses');
  assert.deepEqual(c.log[0].filters, [['paper_id', 'p1']]);
  assert.deepEqual(c.log[0].order, ['created_at', { ascending: false }]);
  c = fakeClient(() => ({ data: null, error: null }));
  assert.deepEqual(await PN.createAnalysesApi(c.client).listForPaper('p1'), []);
  c = fakeClient(() => ({ data: null, error: { code: 'PGRST301' } }));
  await assert.rejects(PN.createAnalysesApi(c.client).listForPaper('p1'), (e) => e.code === 'PGRST301');
});
