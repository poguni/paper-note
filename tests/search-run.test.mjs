import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PN, fixture, NOW } from './helpers/search-env.mjs';
import { buildUpstream } from '../supabase/functions/pn-search-proxy/requests.ts';

const ARXIV_ENTRIES = fixture('arxiv-sample.xml').match(/<entry>[\s\S]*?<\/entry>/g); // 1002.3784, 1406.5823, 2207.12455
const S2_DATA = JSON.parse(fixture('s2-search-sample.json')).data; // lme4(겹침), 2011 DOI(겹침), primer, yearOnly, 제목 없음
const BATCH_COUNTS = { 'ARXIV:1002.3784': 321, 'ARXIV:1406.5823': 1234, 'ARXIV:2207.12455': 7 };

const relayError = (code, extra = {}) => Object.assign(new Error(code), { name: 'RelayError', code, status: 429, ...extra });

// 가짜 중계 함수. 호출마다 실제 중계 함수의 검증을 통과하는지 확인하고, 쪽 넘기기와 서버 쪽 인용수 필터를 흉내 낸다.
function makeEnv(over = {}) {
  const calls = [];
  const queueWaits = { arxiv: 0, s2: 0 };
  const handlers = {
    arxiv_search: (p) => {
      const entries = ARXIV_ENTRIES.slice(p.start, p.start + p.max_results);
      return `<feed><opensearch:totalResults>${ARXIV_ENTRIES.length}</opensearch:totalResults>${entries.join('')}</feed>`;
    },
    s2_search: (p) => {
      const matching = S2_DATA.filter((d) => !p.minCitationCount || (d.citationCount ?? 0) >= p.minCitationCount);
      return { total: matching.length, offset: p.offset, data: matching.slice(p.offset, p.offset + p.limit) };
    },
    s2_batch: (p) => p.ids.map((id) => (id in BATCH_COUNTS ? { paperId: 'x', citationCount: BATCH_COUNTS[id] } : null)),
    ...over.handlers,
  };
  const relay = {
    call: async (op, params) => {
      buildUpstream(op, params); // 중계 함수가 거절할 요청을 만들면 여기서 실패한다
      calls.push({ op, params });
      return handlers[op](params);
    },
  };
  let clock = 0;
  const searcher = PN.createSearcher({
    relay,
    queues: {
      arxiv: { wait: async () => { queueWaits.arxiv++; } },
      s2: { wait: async () => { queueWaits.s2++; } },
    },
    cache: PN.createCache({ ttlMs: 30 * 60 * 1000, max: 50, now: () => clock }),
    now: () => NOW,
  });
  const ops = () => calls.map((c) => c.op);
  return { searcher, calls, ops, queueWaits, advance: (ms) => { clock += ms; } };
}

const base = { query: 'linear mixed effects', sources: ['arxiv', 'semantic_scholar'], limit: 10 };
const ids = (res) => res.papers.map((p) => p.arxivId ?? p.s2Id.slice(0, 4)).sort();

test('검색: 두 소스를 합쳐 중복을 하나로 만들고 인용수를 보강한다', async () => {
  const { searcher, calls, ops } = makeEnv();
  const res = await searcher.search(base);

  // arXiv 3건 + Semantic Scholar 4건(제목 없는 1건 제외) 중 2건이 겹쳐서 5건
  assert.equal(res.papers.length, 5);
  assert.deepEqual(ids(res), ['1002.3784', '1406.5823', '2207.12455', '3333', '4444']);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.meta.rounds, 1);
  assert.equal(res.meta.shortfall, true); // 10건을 요청했는데 5건뿐

  // 호출: arXiv 1번, Semantic Scholar 검색 1번(검색어 1개), 인용수 조회 1번 — 인용수를 이미 아는 논문은 조회하지 않는다
  assert.deepEqual(ops().sort(), ['arxiv_search', 's2_batch', 's2_search']);
  assert.deepEqual(calls.find((c) => c.op === 's2_batch').params.ids, ['ARXIV:2207.12455']);

  const byId = Object.fromEntries(res.papers.map((p) => [p.arxivId ?? p.s2Id.slice(0, 4), p]));
  assert.equal(byId['1406.5823'].citationCount, 1234); // Semantic Scholar 검색 결과에서
  assert.equal(byId['1002.3784'].citationCount, 321); // DOI로 합쳐진 Semantic Scholar 항목에서 (대소문자만 다른 DOI)
  assert.equal(byId['2207.12455'].citationCount, 7); // 일괄 조회에서
  assert.deepEqual(byId['1406.5823'].sources.sort(), ['arxiv', 'semantic_scholar']);
  assert.equal(byId['1406.5823'].source, 'arxiv');
  assert.equal(byId['3333'].source, 'semantic_scholar'); // arXiv ID가 없으면 Semantic Scholar 기준
  assert.equal(byId['4444'].citationCount, 0);
});

test('검색: 여러 검색어는 Semantic Scholar에 검색어마다 한 번씩, arXiv에는 OR 검색식 한 번', async () => {
  const { searcher, calls } = makeEnv();
  await searcher.search({ ...base, query: 'structural equation modeling, multilevel model' });
  const s2 = calls.filter((c) => c.op === 's2_search').map((c) => c.params.query);
  assert.deepEqual(s2, ['structural equation modeling', 'multilevel model']);
  const arxiv = calls.filter((c) => c.op === 'arxiv_search');
  assert.equal(arxiv.length, 1);
  assert.equal(arxiv[0].params.search_query, '(all:"structural equation modeling" OR all:"multilevel model")');
});

test('검색: 두 소스의 호출은 각자의 대기열을 거친다', async () => {
  const { searcher, queueWaits } = makeEnv();
  await searcher.search(base);
  assert.equal(queueWaits.arxiv, 1);
  assert.equal(queueWaits.s2, 2); // 검색 1 + 인용수 조회 1
});

test('검색: 소스를 하나만 고르면 그 소스만 부른다 (arXiv만이어도 인용수는 보강)', async () => {
  let env = makeEnv();
  await env.searcher.search({ ...base, sources: ['arxiv'] });
  assert.deepEqual(env.ops().sort(), ['arxiv_search', 's2_batch']);

  env = makeEnv();
  const res = await env.searcher.search({ ...base, sources: ['semantic_scholar'] });
  assert.deepEqual(env.ops(), ['s2_search']); // Semantic Scholar 결과에는 인용수가 이미 있다
  assert.equal(res.papers.length, 4);
});

test('캐시: 같은 검색을 다시 해도 호출하지 않고, 정렬만 바꿔도 호출하지 않는다', async () => {
  const { searcher, calls } = makeEnv();
  const first = await searcher.search({ ...base, sort: 'relevance' });
  assert.equal(first.meta.fromCache, false);
  const n = calls.length;

  const again = await searcher.search({ ...base, sort: 'relevance' });
  const resorted = await searcher.search({ ...base, sort: 'citations_desc' });
  assert.equal(calls.length, n);
  assert.equal(again.meta.fromCache, true);
  assert.equal(resorted.meta.fromCache, true);
  assert.deepEqual(resorted.papers.map((p) => p.citationCount), [1234, 321, 50, 7, 0]);
  assert.notDeepEqual(resorted.papers.map((p) => p.title), first.papers.map((p) => p.title));
});

test('캐시: 필터, 소스, 개수, 검색어가 다르면 다시 호출한다. 키 순서는 무관', async () => {
  const { searcher, calls } = makeEnv();
  await searcher.search(base);
  let n = calls.length;
  for (const change of [{ minCitations: 10 }, { dateRange: '5y' }, { limit: 20 }, { sources: ['arxiv'] }, { categories: ['stat.ME'] }, { query: 'multilevel' }]) {
    await searcher.search({ ...base, ...change });
    assert.ok(calls.length > n, JSON.stringify(change));
    n = calls.length;
  }
  n = calls.length;
  await searcher.search({ limit: 10, sources: ['semantic_scholar', 'arxiv'], query: 'linear mixed effects' }); // 순서만 다른 같은 검색
  assert.equal(calls.length, n);
});

test('캐시: 시간이 지나면 만료되어 다시 호출한다', async () => {
  const { searcher, calls, advance } = makeEnv();
  await searcher.search(base);
  const n = calls.length;
  advance(31 * 60 * 1000);
  const res = await searcher.search(base);
  assert.ok(calls.length > n);
  assert.equal(res.meta.fromCache, false);
});

test('인용수 필터: 서버에도 최소 인용수를 보내고, arXiv 쪽은 보강한 값으로 다시 거른다', async () => {
  const { searcher, calls } = makeEnv();
  const res = await searcher.search({ ...base, minCitations: 100 });
  assert.equal(calls.find((c) => c.op === 's2_search').params.minCitationCount, 100);
  assert.deepEqual(ids(res), ['1002.3784', '1406.5823']); // 321, 1234. 2207.12455는 7이라 제외
});

test('인용수 필터: 인용수를 못 구한 논문은 "미확인 포함"을 켜야 보인다', async () => {
  const batchFails = { s2_batch: () => { throw relayError('upstream_rate_limited'); } };
  let env = makeEnv({ handlers: batchFails });
  let res = await env.searcher.search({ ...base, sources: ['arxiv'], minCitations: 10 });
  assert.equal(res.papers.length, 0); // 인용수를 하나도 모르니 모두 제외
  assert.equal(res.warnings[0].code, 'upstream_rate_limited');

  env = makeEnv({ handlers: batchFails });
  res = await env.searcher.search({ ...base, sources: ['arxiv'], minCitations: 10, includeUnknownCitations: true });
  assert.equal(res.papers.length, 3);
  assert.ok(res.papers.every((p) => p.citationCount === null));
});

test('기간 필터: 검색식과 연도 범위에 반영하고, 가져온 뒤 날짜로 다시 거른다', async () => {
  const { searcher, calls } = makeEnv();
  const res = await searcher.search({ ...base, dateRange: '5y' }); // 기준일 2021-10-05
  assert.match(calls.find((c) => c.op === 'arxiv_search').params.search_query, /submittedDate:\[202110050000 TO 202610052359\]/);
  assert.equal(calls.find((c) => c.op === 's2_search').params.year, '2021-');
  // 가짜 서버는 날짜를 거르지 않으므로, 클라이언트 재필터가 2022년 이후 논문만 남긴다: 2207.12455(2022), yearOnly(2024)
  assert.deepEqual(ids(res), ['2207.12455', '4444']);
});

test('개수 채우기: 필터로 줄어들면 다음 쪽을 더 가져온다 (최대 3라운드)', async () => {
  const { searcher, calls } = makeEnv();
  const res = await searcher.search({ query: 'x', sources: ['arxiv'], limit: 2, dateRange: '10y' }); // 기준일 2016-10-05
  const starts = calls.filter((c) => c.op === 'arxiv_search').map((c) => c.params.start);
  assert.deepEqual(starts, [0, 2]);
  assert.equal(res.meta.rounds, 2);
  assert.deepEqual(res.papers.map((p) => p.arxivId), ['2207.12455']);
  assert.equal(res.meta.shortfall, true);
  assert.equal(calls.filter((c) => c.op === 's2_batch').length, 2); // 라운드마다 새로 생긴 논문만 조회
});

test('개수 채우기: 이미 N개를 채웠으면 더 가져오지 않고, 결과는 N개로 자른다', async () => {
  const { searcher, calls } = makeEnv();
  const res = await searcher.search({ query: 'x', sources: ['arxiv'], limit: 2 });
  assert.equal(calls.filter((c) => c.op === 'arxiv_search').length, 1);
  assert.equal(res.papers.length, 2);
  assert.equal(res.meta.shortfall, false);
});

test('개수 채우기: 라운드는 3번을 넘지 않는다', async () => {
  // 모든 쪽이 가득 찬 것처럼 응답하지만 필터에 걸려 하나도 남지 않는 경우
  const entry = (n) => ARXIV_ENTRIES[0].replace('1002.3784v2', `1002.${3000 + n}v1`).replace(/<published>[^<]*/, '<published>2001-01-01T00:00:00Z');
  const { searcher, calls } = makeEnv({
    handlers: { arxiv_search: (p) => `<feed><opensearch:totalResults>1000</opensearch:totalResults>${Array.from({ length: p.max_results }, (_, i) => entry(p.start + i)).join('')}</feed>` },
  });
  const res = await searcher.search({ query: 'x', sources: ['arxiv'], limit: 10, dateRange: '1y' });
  assert.equal(calls.filter((c) => c.op === 'arxiv_search').length, 3);
  assert.equal(res.meta.rounds, 3);
  assert.equal(res.papers.length, 0);
});

test('일부 소스가 실패하면 나머지 결과와 경고를 돌려주고 캐시하지 않는다', async () => {
  const rateLimited = { s2_search: () => { throw relayError('upstream_rate_limited', { retryAfter: 9 }); } };
  const { searcher, calls } = makeEnv({ handlers: rateLimited });
  const res = await searcher.search(base);
  assert.equal(res.papers.length, 3); // arXiv 3건
  assert.deepEqual(res.warnings.map((w) => [w.source, w.code]), [['semantic_scholar', 'upstream_rate_limited']]);
  assert.match(res.warnings[0].message, /9초/);
  const n = calls.length;
  await searcher.search(base);
  assert.ok(calls.length > n, '부분 결과는 캐시되면 안 된다');
});

test('호출 한도(429)에 한 번 걸리면 간격을 두고 다시 불러 경고 없이 결과를 얻는다', async () => {
  const env = makeEnv({
    handlers: {
      s2_search: (() => { let n = 0; return (p) => { if (n++ === 0) throw relayError('upstream_rate_limited'); return { total: S2_DATA.length, offset: p.offset, data: S2_DATA.slice(p.offset, p.offset + p.limit) }; }; })(),
      s2_batch: (() => { let n = 0; return (p) => { if (n++ === 0) throw relayError('upstream_rate_limited'); return p.ids.map((id) => (id in BATCH_COUNTS ? { paperId: 'x', citationCount: BATCH_COUNTS[id] } : null)); }; })(),
    },
  });
  const res = await env.searcher.search(base);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.papers.length, 5);
  assert.equal(res.meta.requests.s2, 2); // 검색 2번(실패 1 + 성공 1)
  assert.equal(res.meta.requests.batch, 2);
  assert.equal(env.queueWaits.s2, 4); // 다시 부를 때도 대기열 간격을 지킨다
});

test('호출 한도가 계속되면 다시 부르는 것은 한 번뿐이고 경고로 남는다', async () => {
  const env = makeEnv({ handlers: { s2_search: () => { throw relayError('upstream_rate_limited'); } } });
  const res = await env.searcher.search(base); // arXiv 결과가 있어서 경고로 끝난다
  assert.equal(env.ops().filter((o) => o === 's2_search').length, 2);
  assert.deepEqual(res.warnings.map((w) => w.code), ['upstream_rate_limited']);
});

test('호출 한도 외의 오류(서버 오류 등)는 다시 부르지 않는다', async () => {
  const env = makeEnv({ handlers: { s2_search: () => { throw relayError('upstream_error'); } } });
  await env.searcher.search(base);
  assert.equal(env.ops().filter((o) => o === 's2_search').length, 1);
});

test('검색 서비스 호출 실패가 겹쳐도 경고는 소스·종류별로 한 번만', async () => {
  const fails = {
    s2_search: () => { throw relayError('upstream_rate_limited'); },
    s2_batch: () => { throw relayError('upstream_rate_limited'); },
  };
  const { searcher } = makeEnv({ handlers: fails });
  const res = await searcher.search(base);
  assert.equal(res.warnings.length, 1);
  assert.equal(res.papers.length, 3);
  assert.ok(res.papers.every((p) => p.citationCount === null));
});

test('한 소스의 응답을 해석하지 못해도 다른 소스 결과는 살린다', async () => {
  const { searcher } = makeEnv({ handlers: { arxiv_search: () => fixture('arxiv-error.xml') } });
  const res = await searcher.search(base);
  assert.equal(res.papers.length, 4); // Semantic Scholar 4건
  assert.deepEqual(res.warnings.map((w) => [w.source, w.code]), [['arxiv', 'arxiv_error']]);
});

test('가져온 것이 하나도 없고 소스가 실패했다면 빈 결과가 아니라 오류', async () => {
  const { searcher } = makeEnv({ handlers: { arxiv_search: () => { throw relayError('upstream_timeout'); } } });
  await assert.rejects(searcher.search({ ...base, sources: ['arxiv'] }), (e) => e.code === 'upstream_timeout');
});

test('로그인·승인·네트워크 오류는 바로 검색 전체를 멈춘다', async () => {
  for (const code of ['unauthorized', 'not_approved', 'network']) {
    const boom = () => { throw relayError(code); };
    const { searcher } = makeEnv({ handlers: { arxiv_search: boom, s2_search: boom } });
    await assert.rejects(searcher.search(base), (e) => e.code === code, code);
  }
});

test('입력 오류: 영문 검색어가 없거나 arXiv 분류가 잘못되면 호출하기 전에 오류', async () => {
  const { searcher, calls } = makeEnv();
  for (const query of ['', '   ', '다층모형', ',,,']) {
    await assert.rejects(searcher.search({ ...base, query }), (e) => e.name === 'SearchError' && e.code === 'empty_query', query);
  }
  await assert.rejects(searcher.search({ ...base, categories: ['stat.ME)) OR all:(x'] }), (e) => e.code === 'invalid_category');
  assert.equal(calls.filter((c) => c.op === 'arxiv_search').length, 0);
});

test('정렬 결과: 요청한 정렬로 돌려주고, 목록은 N개 안에서만 늘어놓는다', async () => {
  const { searcher } = makeEnv();
  const byDate = await searcher.search({ ...base, sort: 'date_desc' });
  const dates = byDate.papers.map((p) => p.publishedDate ?? `${p.year}-07-01`);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const byTitle = await searcher.search({ ...base, sort: 'title_asc' });
  const titles = byTitle.papers.map((p) => p.title.toLowerCase().replace(/^[^a-z0-9]+/, ''));
  assert.deepEqual(titles, [...titles].sort());
});

test('결과를 바꿔도 캐시는 영향을 받지 않는다 (배열과 논문 객체 모두)', async () => {
  const { searcher } = makeEnv();
  const first = await searcher.search(base);
  const original = JSON.stringify(first.papers);
  first.papers[0].title = 'HACKED';
  first.papers[0].authors.push('Mallory');
  first.papers[0].saved = true; // 화면 코드가 붙일 수 있는 값
  first.papers.length = 0;
  first.warnings.push({ source: 'x' });
  const again = await searcher.search(base);
  assert.equal(again.meta.fromCache, true);
  assert.equal(JSON.stringify(again.papers), original);
  assert.deepEqual(again.warnings, []);
});
