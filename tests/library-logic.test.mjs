import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/search/filter.js');
await import('../src/js/search/sort.js');
await import('../src/js/filters-view.js');
await import('../src/js/results-view.js');
await import('../src/js/library-logic.js');
const PN = globalThis.PN;

const row = (id, over = {}) => ({
  id, source: 'arxiv', source_id: `1406.${id}`, title: `Title ${id}`, authors: ['Douglas Bates'], year: 2014, published_date: '2014-06-23',
  citation_count: 10, abstract: 'abs', doi: null, pdf_url: 'https://arxiv.org/pdf/x', landing_url: 'https://arxiv.org/abs/x', categories: ['stat.CO'],
  memo: '', saved_at: '2026-10-05T10:00:00Z', ...over,
});
const NOW = new Date('2026-10-06T00:00:00Z');

test('rowToPaper: 검색 결과와 같은 모양이고, 논문 열쇠가 검색 화면과 같다', () => {
  const p = PN.rowToPaper(row('a', { source: 'semantic_scholar', source_id: 'S2ID', doi: '10.1/x' }), 3);
  assert.equal(PN.paperKey(p), 'semantic_scholar:S2ID');
  assert.equal(p.s2Id, 'S2ID');
  assert.equal(p.arxivId, null);
  assert.equal(p.rank, 3);
  assert.equal(p.rowId, 'a');
  assert.deepEqual(p.sources, ['semantic_scholar']);
  const a = PN.rowToPaper(row('b'), 0);
  assert.equal(a.arxivId, '1406.b');
  assert.equal(PN.paperKey(a), 'arxiv:1406.b');
});

test('rowToPaper: 비어 있는 열은 null이나 빈 값으로 맞춘다', () => {
  const p = PN.rowToPaper(row('c', { year: null, published_date: null, citation_count: null, abstract: null, pdf_url: null, landing_url: null, authors: null, categories: null, memo: null }), 0);
  assert.equal(p.year, null);
  assert.equal(p.citationCount, null);
  assert.equal(p.abstract, null);
  assert.equal(p.pdfUrl, null);
  assert.deepEqual(p.authors, []);
  assert.equal(p.memo, '');
  assert.equal(PN.citationLabel(p.citationCount), '인용수 미확인');
  assert.equal(PN.citationLabel(PN.rowToPaper(row('d', { citation_count: 0 }), 0).citationCount), '인용 0'); // 0과 미확인은 구분된다
});

test('rowsToPapers: 저장일 최신순으로 늘어놓고 rank를 매긴다', () => {
  const ps = PN.rowsToPapers([row('old', { saved_at: '2026-10-01T00:00:00Z' }), row('new', { saved_at: '2026-10-05T00:00:00Z' }), row('mid', { saved_at: '2026-10-03T00:00:00Z' })]);
  assert.deepEqual(ps.map((p) => p.rowId), ['new', 'mid', 'old']);
  assert.deepEqual(ps.map((p) => p.rank), [0, 1, 2]);
});

const papers = () => PN.rowsToPapers([
  row('1', { title: 'Multilevel models in education', authors: ['Ann Lee'], memo: '앱 아이디어: 해설기', saved_at: '2026-10-05T00:00:00Z', year: 2020, published_date: '2020-03-01' }),
  row('2', { title: 'Structural equation modeling', authors: ['Bo Kim', 'Cy Park'], categories: ['stat.ME'], saved_at: '2026-10-04T00:00:00Z', year: 2022, published_date: '2022-03-01' }),
  row('3', { title: 'Bayesian workflow', authors: ['Dee Moon'], saved_at: '2026-10-03T00:00:00Z', year: 2018, published_date: '2018-03-01' }),
]);
const index = () => PN.indexAnalyses([{ paper_id: '1', stage: 'abstract' }, { paper_id: '1', stage: 'fulltext' }, { paper_id: '2', stage: 'abstract' }]);

test('filterLibrary: 제목, 저자, 분류, 메모에서 찾고 낱말이 모두 있어야 한다 (대소문자 무시)', () => {
  const ids = (opts) => PN.filterLibrary(papers(), opts, index()).map((p) => p.rowId);
  assert.deepEqual(ids({ text: '' }), ['1', '2', '3']);
  assert.deepEqual(ids({ text: 'MULTILEVEL' }), ['1']);
  assert.deepEqual(ids({ text: 'park' }), ['2']); // 저자
  assert.deepEqual(ids({ text: 'stat.me' }), ['2']); // 분류
  assert.deepEqual(ids({ text: '해설기' }), ['1']); // 메모
  assert.deepEqual(ids({ text: 'models education' }), ['1']); // 낱말 모두
  assert.deepEqual(ids({ text: 'models zzz' }), []);
});

test('filterLibrary: 분석 여부', () => {
  const ids = (analysis) => PN.filterLibrary(papers(), { analysis }, index()).map((p) => p.rowId);
  assert.deepEqual(ids('all'), ['1', '2', '3']);
  assert.deepEqual(ids('with'), ['1', '2']);
  assert.deepEqual(ids('without'), ['3']);
});

test('filterLibrary: 프리셋별 (프리셋 없음 포함)', () => {
  const ps = PN.rowsToPapers([row('a', { preset_id: 'P1', saved_at: '3' }), row('b', { preset_id: 'P2', saved_at: '2' }), row('c', { saved_at: '1' })]);
  const ids = (presetId) => PN.filterLibrary(ps, { presetId }, new Map()).map((p) => p.rowId);
  assert.deepEqual(ids(''), ['a', 'b', 'c']);
  assert.deepEqual(ids('P1'), ['a']);
  assert.deepEqual(ids('none'), ['c']);
});

test('filterLibrary: 조건을 함께 걸면 모두 만족해야 한다', () => {
  assert.deepEqual(PN.filterLibrary(papers(), { text: 'models', analysis: 'with' }, index()).map((p) => p.rowId), ['1']);
  assert.deepEqual(PN.filterLibrary(papers(), { text: 'bayesian', analysis: 'with' }, index()).map((p) => p.rowId), []);
});

test('sortLibrary: 저장일순은 새것부터, 그 밖의 기준은 검색과 같다', () => {
  const ids = (key) => PN.sortLibrary(papers(), key, NOW).map((p) => p.rowId);
  assert.deepEqual(ids('saved_desc'), ['1', '2', '3']);
  assert.deepEqual(ids('date_desc'), ['2', '1', '3']); // 연도 2022, 2020, 2018
  assert.deepEqual(ids('date_asc'), ['3', '1', '2']);
  assert.deepEqual(ids('title_asc'), ['3', '1', '2']); // Bayesian, Multilevel, Structural
  assert.deepEqual(ids('author_asc'), ['2', '1', '3']); // 첫 저자 성: Kim, Lee, Moon
});

test('sortLibrary: 원래 목록을 바꾸지 않는다', () => {
  const ps = papers();
  const before = ps.map((p) => p.rowId);
  PN.sortLibrary(ps, 'title_asc', NOW);
  assert.deepEqual(ps.map((p) => p.rowId), before);
});

test('서재 정렬 선택지: 저장일순이 맨 앞이고 관련도는 없다', () => {
  assert.equal(PN.LIBRARY_SORT_OPTIONS[0][0], 'saved_desc');
  assert.ok(!PN.LIBRARY_SORT_OPTIONS.some((o) => o[0] === 'relevance'));
  assert.equal(PN.LIBRARY_SORT_OPTIONS.length, 8); // 저장일순 + 검색 기준 7개
});

test('indexAnalyses와 analysisBadge', () => {
  const idx = index();
  assert.deepEqual(idx.get('1'), { abstract: 1, fulltext: 1 });
  assert.deepEqual(idx.get('2'), { abstract: 1, fulltext: 0 });
  assert.equal(idx.has('3'), false);
  assert.equal(PN.analysisBadge(idx.get('1')), '분석 초록·본문');
  assert.equal(PN.analysisBadge(idx.get('2')), '분석 초록');
  assert.equal(PN.analysisBadge(undefined), null);
  assert.equal(PN.analysisBadge({ abstract: 0, fulltext: 0 }), null);
  assert.equal(PN.indexAnalyses(null).size, 0);
});
