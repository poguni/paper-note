import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PN, NOW } from './helpers/search-env.mjs';

const paper = (over = {}) => ({
  source: 'arxiv', sourceId: 'x', sources: ['arxiv'], arxivId: null, s2Id: null, doi: null, title: 'T',
  authors: [], year: null, publishedDate: null, abstract: null, pdfUrl: null, landingUrl: null,
  categories: [], venue: null, citationCount: null, rank: 0, ...over,
});

// ---------------------------------------------------------------- 검색어
test('parseTerms: 쉼표로 나누고 영문 검색어에 쓰는 글자만 남긴다', () => {
  assert.deepEqual(PN.parseTerms('structural equation modeling, multilevel model'), ['structural equation modeling', 'multilevel model']);
  assert.deepEqual(PN.parseTerms('  a   b ;  c\nd  '), ['a b', 'c', 'd']);
  assert.deepEqual(PN.parseTerms('C++ & R_2: "quoted" (x)'), ['C++ R_2 quoted x']);
});

test('parseTerms: 중복(대소문자 무시)과 빈 값을 버리고 최대 3개', () => {
  assert.deepEqual(PN.parseTerms('A, a, , B'), ['A', 'B']);
  assert.deepEqual(PN.parseTerms('a, b, c, d, e'), ['a', 'b', 'c']);
});

test('parseTerms: 영문이 하나도 없으면 빈 목록', () => {
  assert.deepEqual(PN.parseTerms('다층모형, 구조방정식'), []);
  assert.deepEqual(PN.parseTerms(''), []);
  assert.deepEqual(PN.parseTerms(null), []);
});

// ---------------------------------------------------------------- 섞기와 합치기
test('interleave: 소스별 순위를 번갈아 섞고 rank를 매기며 원본은 그대로', () => {
  const a = [paper({ title: 'a1' }), paper({ title: 'a2' }), paper({ title: 'a3' })];
  const b = [paper({ title: 'b1' })];
  const out = PN.interleave([a, b]);
  assert.deepEqual(out.map((p) => p.title), ['a1', 'b1', 'a2', 'a3']);
  assert.deepEqual(out.map((p) => p.rank), [0, 1, 2, 3]);
  assert.equal(a[0].rank, 0);
  assert.notEqual(out[0], a[0]);
  assert.deepEqual(PN.interleave([]), []);
  assert.deepEqual(PN.interleave([[], []]), []);
});

test('mergePapers: arXiv ID가 같으면 하나로 합치고 정보를 채운다', () => {
  const arxiv = paper({ arxivId: '1406.5823', sourceId: '1406.5823', title: 'lme4', authors: ['A', 'B'], publishedDate: '2014-06-23', year: 2014,
    pdfUrl: 'https://arxiv.org/pdf/1406.5823v1', abstract: 'short', rank: 1 });
  const s2 = paper({ source: 'semantic_scholar', sources: ['semantic_scholar'], s2Id: 'S2ID', sourceId: 'S2ID', arxivId: '1406.5823',
    doi: '10.18637/jss.v067.i01', title: 'lme4 (S2)', authors: ['A', 'B', 'C'], publishedDate: '2015-10-07', year: 2015,
    pdfUrl: 'https://jss.example/x.pdf', abstract: 'a much longer abstract', citationCount: 1234, venue: 'JSS', landingUrl: 'https://s2/x', rank: 0 });
  const [m, ...rest] = PN.mergePapers([s2, arxiv]);
  assert.equal(rest.length, 0);
  assert.deepEqual(m.sources, ['semantic_scholar', 'arxiv']);
  assert.equal(m.source, 'arxiv'); // 저장 기준은 arXiv ID가 있으면 arXiv
  assert.equal(m.sourceId, '1406.5823');
  assert.equal(m.s2Id, 'S2ID');
  assert.equal(m.doi, '10.18637/jss.v067.i01');
  assert.equal(m.citationCount, 1234);
  assert.equal(m.abstract, 'a much longer abstract');
  assert.deepEqual(m.authors, ['A', 'B', 'C']);
  assert.equal(m.publishedDate, '2014-06-23'); // 날짜는 arXiv(최초 제출일) 기준
  assert.equal(m.year, 2014);
  assert.equal(m.pdfUrl, 'https://arxiv.org/pdf/1406.5823v1');
  assert.equal(m.landingUrl, 'https://arxiv.org/abs/1406.5823');
  assert.equal(m.venue, 'JSS');
  assert.equal(m.rank, 0); // 더 높은 순위(작은 값)를 유지
});

test('mergePapers: DOI는 대소문자를 구분하지 않고 같은 논문으로 본다', () => {
  const a = paper({ arxivId: '1002.3784', doi: '10.1111/j.1467-9469.2011.00740.x', rank: 0 });
  const b = paper({ source: 'semantic_scholar', sources: ['semantic_scholar'], s2Id: 'S', doi: '10.1111/J.1467-9469.2011.00740.X', citationCount: 321, rank: 1 });
  const merged = PN.mergePapers([a, b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].citationCount, 321);
});

test('mergePapers: arXiv ID와 DOI로 따로 이어진 두 묶음도 한 논문이 들어오면 하나로 합친다', () => {
  const x = paper({ arxivId: '1111.1111', title: 'X', rank: 0 });
  const y = paper({ source: 'semantic_scholar', sources: ['semantic_scholar'], s2Id: 'Y', doi: '10.1/y', title: 'Y', rank: 1 });
  const bridge = paper({ source: 'semantic_scholar', sources: ['semantic_scholar'], s2Id: 'Z', arxivId: '1111.1111', doi: '10.1/y', title: 'Z', rank: 2 });
  const merged = PN.mergePapers([x, y, bridge]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].arxivId, '1111.1111');
  assert.equal(merged[0].doi, '10.1/y');
  assert.equal(merged[0].s2Id, 'Y');
  assert.equal(merged[0].rank, 0);
});

test('mergePapers: 겹치지 않는 논문은 그대로 두고 rank 순으로 돌려주며 원본을 바꾸지 않는다', () => {
  const input = [paper({ title: 'late', arxivId: '2.2', rank: 5 }), paper({ title: 'early', arxivId: '1.1', rank: 1 }), paper({ title: 'noid', rank: 3 })];
  const snapshot = JSON.stringify(input);
  const out = PN.mergePapers(input);
  assert.deepEqual(out.map((p) => p.title), ['early', 'noid', 'late']);
  assert.equal(JSON.stringify(input), snapshot);
});

test('mergePapers: ID가 없는 논문끼리는 합치지 않는다 (제목이 같아도 다른 논문일 수 있음)', () => {
  const out = PN.mergePapers([paper({ title: 'Same', rank: 0 }), paper({ title: 'Same', rank: 1 })]);
  assert.equal(out.length, 2);
});

test('mergePapers: 인용수 0은 "모름"이 아니라 값으로 취급한다', () => {
  const a = paper({ arxivId: '1.1', citationCount: null, rank: 0 });
  const b = paper({ arxivId: '1.1', citationCount: 0, rank: 1, sources: ['semantic_scholar'] });
  assert.equal(PN.mergePapers([a, b])[0].citationCount, 0);
});

// ---------------------------------------------------------------- 기간·인용수 필터
test('sinceDate: 기간 선택값을 기준 날짜로 바꾼다', () => {
  assert.equal(PN.sinceDate('6m', NOW), '2026-04-05');
  assert.equal(PN.sinceDate('1y', NOW), '2025-10-05');
  assert.equal(PN.sinceDate('3y', NOW), '2023-10-05');
  assert.equal(PN.sinceDate('5y', NOW), '2021-10-05');
  assert.equal(PN.sinceDate('10y', NOW), '2016-10-05');
  assert.equal(PN.sinceDate('all', NOW), null);
  assert.equal(PN.sinceDate('toString', NOW), null);
});

test('sinceDate: 달의 마지막 날은 달을 넘기지 않는다', () => {
  assert.equal(PN.sinceDate('6m', new Date('2026-08-31T00:00:00Z')), '2026-02-28');
  assert.equal(PN.sinceDate('1y', new Date('2028-02-29T00:00:00Z')), '2027-02-28');
  assert.equal(PN.sinceDate('6m', new Date('2026-03-31T00:00:00Z')), '2025-09-30');
});

test('filterPapers: 기간 경계는 포함, 연도만 아는 논문은 연도로 판단', () => {
  const o = { dateRange: '6m', now: NOW }; // 기준일 2026-04-05
  const ps = [
    paper({ title: 'on', publishedDate: '2026-04-05' }),
    paper({ title: 'before', publishedDate: '2026-04-04' }),
    paper({ title: 'yearIn', year: 2026 }),
    paper({ title: 'yearOut', year: 2025 }),
    paper({ title: 'unknown' }),
  ];
  assert.deepEqual(PN.filterPapers(ps, o).map((p) => p.title), ['on', 'yearIn', 'unknown']);
  assert.equal(PN.filterPapers(ps, { dateRange: 'all', now: NOW }).length, 5);
});

test('filterPapers: 최소 인용수, 경계값, 인용수 미확인 포함 옵션', () => {
  const ps = [
    paper({ title: 'c9', citationCount: 9 }), paper({ title: 'c10', citationCount: 10 }),
    paper({ title: 'c0', citationCount: 0 }), paper({ title: 'unk', citationCount: null }),
  ];
  const f = (o) => PN.filterPapers(ps, { dateRange: 'all', now: NOW, ...o }).map((p) => p.title);
  assert.deepEqual(f({ minCitations: 10 }), ['c10']);
  assert.deepEqual(f({ minCitations: 10, includeUnknownCitations: true }), ['c10', 'unk']);
  assert.deepEqual(f({ minCitations: 0 }), ['c9', 'c10', 'c0', 'unk']); // 필터 없음이면 미확인도 보임
  assert.deepEqual(f({ minCitations: 1 }), ['c9', 'c10']);
});

// ---------------------------------------------------------------- 정렬
const sortTitles = (ps, key) => PN.sortPapers(ps, key, NOW).map((p) => p.title);

test('정렬: 관련도는 rank 순서, 원본은 바꾸지 않는다', () => {
  const ps = [paper({ title: 'b', rank: 1 }), paper({ title: 'a', rank: 0 }), paper({ title: 'c', rank: 2 })];
  assert.deepEqual(sortTitles(ps, 'relevance'), ['a', 'b', 'c']);
  assert.deepEqual(ps.map((p) => p.title), ['b', 'a', 'c']);
  assert.deepEqual(sortTitles(ps, 'unknown_key'), ['a', 'b', 'c']);
});

test('정렬: 최신순과 오래된순 (연도만 아는 논문은 그 해 중간, 날짜 없는 논문은 항상 맨 뒤)', () => {
  const ps = [
    paper({ title: 'old', publishedDate: '2010-01-01', rank: 0 }),
    paper({ title: 'none', rank: 1 }),
    paper({ title: 'new', publishedDate: '2024-05-01', rank: 2 }),
    paper({ title: 'yearOnly2020', year: 2020, rank: 3 }),
  ];
  assert.deepEqual(sortTitles(ps, 'date_desc'), ['new', 'yearOnly2020', 'old', 'none']);
  assert.deepEqual(sortTitles(ps, 'date_asc'), ['old', 'yearOnly2020', 'new', 'none']);
});

test('정렬: 인용수 많은순 (미확인은 맨 뒤, 0은 값)', () => {
  const ps = [
    paper({ title: 'unk', citationCount: null, rank: 0 }), paper({ title: 'zero', citationCount: 0, rank: 1 }),
    paper({ title: 'hi', citationCount: 500, rank: 2 }), paper({ title: 'mid', citationCount: 20, rank: 3 }),
  ];
  assert.deepEqual(sortTitles(ps, 'citations_desc'), ['hi', 'mid', 'zero', 'unk']);
});

test('정렬: 연평균 인용수는 최신 논문이 오래된 논문에 밀리지 않게 보정한다 (경과 연수 최소 1년)', () => {
  const ps = [
    paper({ title: 'oldBig', citationCount: 1000, publishedDate: '2006-10-05', rank: 0 }), // 20년 → 50/년
    paper({ title: 'newSmall', citationCount: 80, publishedDate: '2026-06-01', rank: 1 }), // 1년 미만 → 80/1
    paper({ title: 'noCount', citationCount: null, publishedDate: '2020-01-01', rank: 2 }),
    paper({ title: 'noDate', citationCount: 999, rank: 3 }),
  ];
  assert.deepEqual(sortTitles(ps, 'citations_per_year_desc'), ['newSmall', 'oldBig', 'noCount', 'noDate']);
});

test('정렬: 저자 이름순은 첫 저자의 성 기준, 발음 부호를 무시', () => {
  const ps = [
    paper({ title: 'noAuthor', authors: [], rank: 0 }),
    paper({ title: 'walker', authors: ['Steve Walker', 'X'], rank: 1 }),
    paper({ title: 'machler', authors: ['Martin Mächler'], rank: 2 }),
    paper({ title: 'bates', authors: ['Douglas Bates'], rank: 3 }),
    paper({ title: 'bates2', authors: ['Alan Bates'], rank: 4 }),
  ];
  assert.deepEqual(sortTitles(ps, 'author_asc'), ['bates2', 'bates', 'machler', 'walker', 'noAuthor']);
});

test('정렬: 제목순은 대소문자와 앞쪽 기호를 무시', () => {
  const ps = [paper({ title: 'beta', rank: 0 }), paper({ title: '"Alpha" test', rank: 1 }), paper({ title: 'Éclair', rank: 2 }), paper({ title: 'Gamma', rank: 3 })];
  assert.deepEqual(sortTitles(ps, 'title_asc'), ['"Alpha" test', 'beta', 'Éclair', 'Gamma']);
});

test('정렬: PDF 있는 논문이 먼저, 같은 쪽 안에서는 관련도 순서', () => {
  const ps = [paper({ title: 'a', rank: 0 }), paper({ title: 'b', pdfUrl: 'u', rank: 1 }), paper({ title: 'c', rank: 2 }), paper({ title: 'd', pdfUrl: 'u', rank: 3 })];
  assert.deepEqual(sortTitles(ps, 'has_pdf_first'), ['b', 'd', 'a', 'c']);
});

test('정렬: 값이 같으면 관련도 순서를 유지한다', () => {
  const ps = [paper({ title: 'x', citationCount: 5, rank: 2 }), paper({ title: 'y', citationCount: 5, rank: 0 }), paper({ title: 'z', citationCount: 5, rank: 1 })];
  assert.deepEqual(sortTitles(ps, 'citations_desc'), ['y', 'z', 'x']);
});

test('정렬 키는 DB(pn_presets.sort)의 허용 값과 같다', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/migrations/20261005000000_pn_init.sql', import.meta.url), 'utf8');
  const allowed = [...sql.match(/sort\s+text[^;]*?check \(sort in \(([^)]*)\)/s)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...PN.SORT_KEYS].sort(), [...allowed].sort());
  const ranges = [...sql.match(/date_range[^;]*?check \(date_range in \(([^)]*)\)/s)[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...PN.DATE_RANGES].sort(), [...ranges].sort());
});

// ---------------------------------------------------------------- 캐시
test('cacheKey: 객체 키 순서와 관계없이 같은 내용이면 같은 키', () => {
  assert.equal(PN.cacheKey({ a: 1, b: { x: 1, y: [1, 2] } }), PN.cacheKey({ b: { y: [1, 2], x: 1 }, a: 1 }));
  assert.notEqual(PN.cacheKey({ a: [1, 2] }), PN.cacheKey({ a: [2, 1] })); // 배열 순서는 의미가 있다
  assert.notEqual(PN.cacheKey({ a: 1 }), PN.cacheKey({ a: 2 }));
});

test('cache: 저장과 조회, 만료, 가득 차면 오래 안 쓴 것부터 버림', () => {
  let t = 0;
  const c = PN.createCache({ ttlMs: 1000, max: 2, now: () => t });
  assert.equal(c.get('k'), undefined);
  c.set('a', 1); c.set('b', 2);
  assert.equal(c.get('a'), 1); // a를 방금 썼으니 b가 가장 오래된 것
  c.set('c', 3);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
  t = 1500;
  assert.equal(c.get('a'), undefined, '만료');
  assert.equal(c.size(), 1); // 만료된 a는 지워지고 c만 남음 (c는 조회 시 만료 확인 전)
});

test('cache: clear', () => {
  const c = PN.createCache({ ttlMs: 1000, max: 5, now: () => 0 });
  c.set('a', 1);
  c.clear();
  assert.equal(c.size(), 0);
});

// ---------------------------------------------------------------- 대기열
test('queue: 요청을 한 줄로 세워 최소 간격을 지킨다 (arXiv 3초)', async () => {
  let t = 1000;
  const sleeps = [];
  const q = PN.createQueue(3000, () => t, async (ms) => { sleeps.push(ms); t += ms; });
  const order = [];
  await Promise.all([1, 2, 3].map((n) => q.wait().then(() => order.push([n, t]))));
  assert.deepEqual(sleeps, [3000, 3000]);
  assert.deepEqual(order, [[1, 1000], [2, 4000], [3, 7000]]);
});

test('queue: 간격이 이미 지났으면 기다리지 않고, 앞선 요청이 실패해도 뒤 요청은 진행한다', async () => {
  let t = 0;
  const sleeps = [];
  const q = PN.createQueue(3000, () => t, async (ms) => { sleeps.push(ms); t += ms; });
  await q.wait();
  t += 5000;
  await q.wait();
  assert.deepEqual(sleeps, []);
  const failing = PN.createQueue(10, () => t, async () => { throw new Error('sleep failed'); });
  await failing.wait();
  t += 1;
  await assert.rejects(failing.wait(), /sleep failed/);
  t += 100;
  await failing.wait(); // 이전 실패가 뒤 요청을 막지 않는다
});
