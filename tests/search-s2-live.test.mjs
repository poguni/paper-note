// 실제 Semantic Scholar 응답(tests/manual/relay-check.mjs 로 2026-10-05에 저장)으로 파서를 검증한다.
// s2-search-sample.json 은 겹침 시나리오를 만들려고 직접 쓴 가짜 데이터이고, 이 파일의 s2-live-*.json 이 실제 형식의 기준이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PN, fixture } from './helpers/search-env.mjs';
import { buildUpstream } from '../supabase/functions/pn-search-proxy/requests.ts';

const live = JSON.parse(fixture('s2-live-search.json'));
const batch = JSON.parse(fixture('s2-live-batch.json'));

test('실제 검색 응답: 5건 모두 공통 형식으로 해석된다', () => {
  const { papers, total } = PN.s2.parseSearch(live);
  assert.equal(total, live.total);
  assert.equal(papers.length, live.data.length);
  for (const p of papers) {
    assert.equal(p.source, 'semantic_scholar');
    assert.match(p.sourceId, /^[0-9a-f]{40}$/);
    assert.ok(p.title.length > 10);
    assert.equal(typeof p.year, 'number');
    assert.match(p.publishedDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof p.citationCount, 'number');
    assert.ok(p.authors.length > 0 && p.authors.every((a) => typeof a === 'string' && a));
    assert.ok(p.abstract && p.abstract.length > 100);
    assert.match(p.landingUrl, /^https:\/\/www\.semanticscholar\.org\/paper\//);
  }
});

test('실제 응답의 빈 문자열은 "없음"으로 바꾼다 (venue "", openAccessPdf.url "")', () => {
  const papers = PN.s2.parseSearch(live).papers;
  assert.equal(live.data[2].venue, '');
  assert.equal(papers[2].venue, null);
  assert.equal(live.data[4].openAccessPdf.url, '');
  assert.equal(papers[4].pdfUrl, null); // 공개 PDF가 없는 논문
  assert.match(papers[0].pdfUrl, /^https:\/\/www\.frontiersin\.org\//);
});

test('실제 응답: DOI는 Semantic Scholar가 준 대소문자 그대로 두고, 인용수 조회용 ID로 쓸 수 있다', () => {
  const papers = PN.s2.parseSearch(live).papers;
  assert.equal(papers[2].doi, '10.18637/JSS.V080.I01'); // 대문자 DOI
  assert.equal(papers[0].arxivId, null); // 이 논문들은 arXiv에 없다
  const ids = papers.map(PN.s2.lookupId);
  assert.ok(ids.every((id) => id && id.startsWith('DOI:')));
  assert.doesNotThrow(() => buildUpstream('s2_batch', { ids })); // 중계 함수의 검증도 통과
});

test('실제 응답: 요청한 파라미터는 중계 함수의 검증을 통과한다', () => {
  assert.doesNotThrow(() => buildUpstream('s2_search', { query: 'multilevel model', limit: 5 }));
});

test('실제 일괄 조회 응답: ids와 같은 순서로 짝을 짓고, 없는 논문(null)은 건너뛴다', () => {
  assert.equal(batch.response.length, batch.ids.length);
  assert.equal(batch.response[3], null); // ARXIV:0000.00000
  const counts = PN.s2.parseBatch(batch.response, batch.ids);
  assert.equal(counts.size, 4);
  assert.equal(counts.has('ARXIV:0000.00000'), false);
  assert.ok(counts.get('ARXIV:1406.5823') > 80000); // lme4
  assert.equal(counts.get('ARXIV:1406.5823'), counts.get('DOI:10.18637/jss.v067.i01')); // 같은 논문을 다른 ID로 물어도 같은 값
  assert.equal(counts.get('ARXIV:2207.12455'), 0); // 0은 값이다
  assert.ok(counts.get('ARXIV:1002.3784') > 100);
});

test('실제 일괄 조회에 쓴 ID는 모두 중계 함수의 검증을 통과한다', () => {
  assert.doesNotThrow(() => buildUpstream('s2_batch', { ids: batch.ids }));
});
