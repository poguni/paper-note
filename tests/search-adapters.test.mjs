import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PN, fixture, NOW } from './helpers/search-env.mjs';
import { buildUpstream } from '../supabase/functions/pn-search-proxy/requests.ts';

// ---------------------------------------------------------------- arXiv 응답 해석
test('arXiv: 실제 응답을 공통 형식으로 바꾼다', () => {
  const { papers, total } = PN.arxiv.parseFeed(fixture('arxiv-sample.xml'));
  assert.equal(total, 25);
  assert.equal(papers.length, 3);

  const p = papers[0];
  assert.equal(p.source, 'arxiv');
  assert.equal(p.sourceId, '1002.3784'); // 버전(v2)은 뗀다
  assert.equal(p.arxivId, '1002.3784');
  assert.deepEqual(p.sources, ['arxiv']);
  assert.equal(p.title, 'Estimation for High-Dimensional Linear Mixed-Effects Models Using $\\ell_1$-Penalization');
  assert.deepEqual(p.authors, ['Jürg Schelldorfer', 'Peter Bühlmann', 'Sara van de Geer']);
  assert.equal(p.doi, '10.1111/j.1467-9469.2011.00740.x');
  assert.equal(p.publishedDate, '2010-02-19'); // 최초 제출일
  assert.equal(p.year, 2010);
  assert.equal(p.pdfUrl, 'https://arxiv.org/pdf/1002.3784v2');
  assert.equal(p.landingUrl, 'https://arxiv.org/abs/1002.3784');
  assert.deepEqual(p.categories, ['stat.ME', 'stat.CO']);
  assert.equal(p.venue, 'Scandinavian Journal of Statistics 2011, 38: 197-214');
  assert.equal(p.citationCount, null);
  assert.ok(!/\n/.test(p.abstract) && p.abstract.startsWith('We propose'));
});

test('arXiv: DOI가 없으면 null, 저자 이름의 비ASCII 글자를 보존한다', () => {
  const p = PN.arxiv.parseFeed(fixture('arxiv-sample.xml')).papers[1];
  assert.equal(p.arxivId, '1406.5823');
  assert.equal(p.doi, null);
  assert.equal(p.venue, null);
  assert.deepEqual(p.authors, ['Douglas Bates', 'Martin Mächler', 'Ben Bolker', 'Steve Walker']);
});

test('arXiv: 오류 응답(오류 항목 1개짜리 정상 응답)은 SearchError', () => {
  assert.throws(
    () => PN.arxiv.parseFeed(fixture('arxiv-error.xml')),
    (e) => e.name === 'SearchError' && e.code === 'arxiv_error' && /Invalid query/.test(e.message));
});

test('arXiv: 응답이 XML 피드가 아니면 SearchError', () => {
  for (const bad of ['', '<html>', null, undefined, {}]) {
    assert.throws(() => PN.arxiv.parseFeed(bad), (e) => e.code === 'arxiv_bad_response');
  }
});

test('arXiv: XML 엔티티와 줄바꿈을 처리하고, 옛 형식 ID도 해석한다', () => {
  const xml = `<feed><opensearch:totalResults>1</opensearch:totalResults><entry>
    <id>http://arxiv.org/abs/math/0211159v3</id>
    <title>Tom &amp; Jerry:
      A &lt;study&gt; &#945; &#x3b2;</title>
    <published>2002-11-11T00:00:00Z</published>
    <summary>Line one
      line two &quot;quoted&quot;.</summary>
    <author><name>A &amp; B</name></author>
  </entry></feed>`;
  const p = PN.arxiv.parseFeed(xml).papers[0];
  assert.equal(p.arxivId, 'math/0211159');
  assert.equal(p.title, 'Tom & Jerry: A <study> α β');
  assert.equal(p.abstract, 'Line one line two "quoted".');
  assert.deepEqual(p.authors, ['A & B']);
  assert.equal(p.pdfUrl, 'https://arxiv.org/pdf/math/0211159'); // pdf 링크가 없으면 ID로 만든다
});

// ---------------------------------------------------------------- arXiv 검색식
const base = { terms: ['multilevel model'], categories: [], dateRange: 'all', now: NOW };

test('arXiv 검색식: 검색어 하나, 여러 개, 분류, 기간', () => {
  assert.equal(PN.arxiv.buildSearchQuery(base), 'all:"multilevel model"');
  assert.equal(
    PN.arxiv.buildSearchQuery({ ...base, terms: ['structural equation modeling', 'multilevel model'] }),
    '(all:"structural equation modeling" OR all:"multilevel model")');
  assert.equal(
    PN.arxiv.buildSearchQuery({ ...base, categories: ['stat.ME', 'stat.AP'] }),
    'all:"multilevel model" AND (cat:stat.ME OR cat:stat.AP)');
  assert.equal(
    PN.arxiv.buildSearchQuery({ ...base, dateRange: '1y' }),
    'all:"multilevel model" AND submittedDate:[202510050000 TO 202610052359]');
});

test('arXiv 검색식: 잘못된 분류와 너무 긴 검색어는 SearchError', () => {
  assert.throws(() => PN.arxiv.buildSearchQuery({ ...base, categories: ['stat.ME OR all:x'] }), (e) => e.code === 'invalid_category');
  assert.throws(() => PN.arxiv.buildSearchQuery({ ...base, terms: ['x'.repeat(601)] }), (e) => e.code === 'query_too_long');
});

test('arXiv 검색식: 만든 검색식은 모두 중계 함수의 검증을 통과한다 (규칙 일치)', () => {
  const variants = [
    base,
    { ...base, terms: ['structural equation modeling', 'multilevel model', 'vibe coding'] },
    { ...base, categories: ['stat.ME', 'stat.AP', 'cs.AI', 'q-bio.*'], dateRange: '6m' },
    { ...base, terms: ['C++ and R_2 v1.5'], dateRange: '10y' },
  ];
  for (const v of variants) {
    const q = PN.arxiv.buildSearchQuery(v);
    assert.doesNotThrow(() => buildUpstream('arxiv_search', { search_query: q, start: 0, max_results: 100 }), q);
  }
});

// ---------------------------------------------------------------- Semantic Scholar
test('Semantic Scholar: 응답을 공통 형식으로 바꾸고 제목 없는 항목은 버린다', () => {
  const { papers, total } = PN.s2.parseSearch(JSON.parse(fixture('s2-search-sample.json')));
  assert.equal(total, 5);
  assert.equal(papers.length, 4); // 제목이 null인 항목 제외

  const lme4 = papers[0];
  assert.equal(lme4.source, 'semantic_scholar');
  assert.equal(lme4.sourceId, '1'.repeat(40));
  assert.equal(lme4.s2Id, '1'.repeat(40));
  assert.equal(lme4.arxivId, '1406.5823');
  assert.equal(lme4.doi, '10.18637/jss.v067.i01');
  assert.deepEqual(lme4.authors, ['D. Bates', 'M. Mächler', 'B. Bolker', 'S. Walker']);
  assert.equal(lme4.publishedDate, '2015-10-07');
  assert.equal(lme4.year, 2015);
  assert.equal(lme4.citationCount, 1234);
  assert.equal(lme4.pdfUrl, 'https://www.jstatsoft.org/article/view/v067i01/v67i01.pdf');
  assert.equal(lme4.venue, 'Journal of Statistical Software');
});

test('Semantic Scholar: 공개 PDF가 없는 논문, 연도만 아는 논문, 제목의 공백', () => {
  const papers = PN.s2.parseSearch(JSON.parse(fixture('s2-search-sample.json'))).papers;
  const primer = papers[2];
  assert.equal(primer.title, 'A Primer on Multilevel Modeling'); // 줄바꿈 정리
  assert.equal(primer.pdfUrl, null);
  assert.equal(primer.arxivId, null);
  assert.equal(primer.abstract, null);
  const yearOnly = papers[3];
  assert.equal(yearOnly.publishedDate, null);
  assert.equal(yearOnly.year, 2024);
  assert.equal(yearOnly.citationCount, 0); // 0은 "없음"이 아니라 실제 값
  assert.equal(yearOnly.venue, null);
  assert.deepEqual(yearOnly.authors, []);
  assert.equal(yearOnly.landingUrl, null);
  // arXiv ID가 있는 논문은 공개 PDF가 없어도 arXiv PDF를 쓴다
  const noPdf = PN.s2.parseSearch({ data: [{ paperId: 'x', title: 't', externalIds: { ArXiv: '1406.5823v2' }, openAccessPdf: null }] }).papers[0];
  assert.equal(noPdf.pdfUrl, 'https://arxiv.org/pdf/1406.5823');
  assert.equal(noPdf.arxivId, '1406.5823');
});

test('Semantic Scholar: 결과가 0건일 때 data가 빠진 응답, 해석할 수 없는 응답', () => {
  assert.deepEqual(PN.s2.parseSearch({ total: 0, offset: 0 }), { papers: [], total: 0 });
  for (const bad of [null, {}, { data: 'x' }, []]) {
    assert.throws(() => PN.s2.parseSearch(bad), (e) => e.code === 's2_bad_response');
  }
});

test('Semantic Scholar: 요청 파라미터', () => {
  const o = { limit: 20, dateRange: 'all', minCitations: 0, now: NOW };
  assert.deepEqual(PN.s2.buildSearchParams('multilevel model', o, 0), { query: 'multilevel model', limit: 20, offset: 0 });
  assert.deepEqual(PN.s2.buildSearchParams('x', o, 2), { query: 'x', limit: 20, offset: 40 });
  assert.deepEqual(
    PN.s2.buildSearchParams('x', { ...o, dateRange: '3y', minCitations: 50 }, 0),
    { query: 'x', limit: 20, offset: 0, year: '2023-', minCitationCount: 50 });
});

test('Semantic Scholar: 쪽 넘기기 한계는 offset + limit ≤ 1000', () => {
  assert.equal(PN.s2.canFetchPage(100, 9), true);
  assert.equal(PN.s2.canFetchPage(100, 10), false);
  assert.equal(PN.s2.canFetchPage(30, 32), true); // 32*30 + 30 = 990
  assert.equal(PN.s2.canFetchPage(30, 33), false); // 1020
});

test('Semantic Scholar: 만든 요청은 모두 중계 함수의 검증을 통과한다 (규칙 일치)', () => {
  const o = { limit: 100, dateRange: '10y', minCitations: 500, now: NOW };
  for (const page of [0, 9]) assert.doesNotThrow(() => buildUpstream('s2_search', PN.s2.buildSearchParams('multilevel model', o, page)));
  const papers = PN.s2.parseSearch(JSON.parse(fixture('s2-search-sample.json'))).papers
    .concat(PN.arxiv.parseFeed(fixture('arxiv-sample.xml')).papers);
  const ids = papers.map(PN.s2.lookupId).filter(Boolean);
  assert.ok(ids.length >= 4);
  assert.doesNotThrow(() => buildUpstream('s2_batch', { ids }));
});

test('인용수 조회 ID: arXiv ID 우선, 없으면 DOI, 둘 다 없거나 형식이 틀리면 null', () => {
  assert.equal(PN.s2.lookupId({ arxivId: '1406.5823', doi: '10.1/x' }), 'ARXIV:1406.5823');
  assert.equal(PN.s2.lookupId({ arxivId: 'math/0211159' }), 'ARXIV:math/0211159');
  assert.equal(PN.s2.lookupId({ arxivId: null, doi: '10.1000/XYZ.1' }), 'DOI:10.1000/XYZ.1');
  assert.equal(PN.s2.lookupId({ arxivId: null, doi: null }), null);
  assert.equal(PN.s2.lookupId({ arxivId: null, doi: 'not-a-doi' }), null);
  assert.equal(PN.s2.lookupId({ arxivId: 'x; drop table' }), null);
});

test('인용수 일괄 조회 응답: 순서대로 짝을 짓고 null(못 찾음)은 건너뛴다', () => {
  const ids = ['ARXIV:1', 'ARXIV:2', 'DOI:10.1/a'];
  const counts = PN.s2.parseBatch([{ citationCount: 7 }, null, { citationCount: 0 }], ids);
  assert.equal(counts.get('ARXIV:1'), 7);
  assert.equal(counts.has('ARXIV:2'), false);
  assert.equal(counts.get('DOI:10.1/a'), 0); // 0도 유효한 값
  assert.throws(() => PN.s2.parseBatch({ error: 'x' }, ids), (e) => e.code === 's2_bad_response');
  assert.equal(PN.s2.parseBatch([{ citationCount: 'many' }], ['ARXIV:1']).size, 0);
});
