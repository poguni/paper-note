import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstream, BadRequest } from '../supabase/functions/pn-search-proxy/requests.ts';
import { createGate } from '../supabase/functions/pn-search-proxy/gate.ts';
import { handle } from '../supabase/functions/pn-search-proxy/handler.ts';

// ---------------------------------------------------------------- requests.ts
const rejects = (op, params, msg) =>
  assert.throws(() => buildUpstream(op, params), (e) => e instanceof BadRequest, msg ?? JSON.stringify([op, params]));

test('arxiv_search: 정해진 주소와 인코딩된 파라미터만 만든다', () => {
  const u = buildUpstream('arxiv_search', { search_query: 'all:"multilevel model" AND cat:stat.ME', max_results: 5 });
  const url = new URL(u.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://export.arxiv.org/api/query');
  assert.equal(url.searchParams.get('search_query'), 'all:"multilevel model" AND cat:stat.ME');
  assert.equal(url.searchParams.get('max_results'), '5');
  assert.equal(url.searchParams.get('start'), '0');
  assert.equal(url.searchParams.get('sortBy'), 'relevance');
  assert.equal(u.method, 'GET');
  assert.equal(u.kind, 'arxiv');
});

test('arxiv_search: 날짜 범위 같은 arXiv 문법은 허용한다', () => {
  const q = 'cat:stat.ME AND submittedDate:[202401010000 TO 202412312359]';
  assert.equal(new URL(buildUpstream('arxiv_search', { search_query: q }).url).searchParams.get('search_query'), q);
});

test('arxiv_search: 파라미터 끼워 넣기와 범위를 벗어난 값은 거절한다', () => {
  for (const q of ['x&max_results=5000', 'x#frag', 'x%26y', 'a/b', '', 'x'.repeat(601), 5, null]) {
    rejects('arxiv_search', { search_query: q });
  }
  rejects('arxiv_search', { search_query: 'x', max_results: 101 });
  rejects('arxiv_search', { search_query: 'x', max_results: 0 });
  rejects('arxiv_search', { search_query: 'x', max_results: 1.5 });
  rejects('arxiv_search', { search_query: 'x', start: -1 });
  rejects('arxiv_search', { search_query: 'x', sort_by: 'random' });
  rejects('arxiv_search', { search_query: 'x', sort_order: 'up' });
  rejects('arxiv_search', {});
});

test('s2_search: 기본 필드와 주소', () => {
  const u = buildUpstream('s2_search', { query: 'multilevel model' });
  const url = new URL(u.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.semanticscholar.org/graph/v1/paper/search');
  assert.equal(url.searchParams.get('query'), 'multilevel model');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.match(url.searchParams.get('fields'), /citationCount/);
  assert.equal(u.kind, 's2');
});

test('s2_search: 연도와 최소 인용수, 필드 지정', () => {
  const url = new URL(buildUpstream('s2_search', { query: 'q', year: '2020-', minCitationCount: 10, fields: ['title', 'citationCount'] }).url);
  assert.equal(url.searchParams.get('year'), '2020-');
  assert.equal(url.searchParams.get('minCitationCount'), '10');
  assert.equal(url.searchParams.get('fields'), 'title,citationCount');
  for (const y of ['2020', '2018-2022', '-2015']) assert.ok(buildUpstream('s2_search', { query: 'q', year: y }));
});

test('s2_search: 잘못된 값은 거절한다', () => {
  rejects('s2_search', { query: '' });
  rejects('s2_search', { query: 'x'.repeat(301) });
  rejects('s2_search', { query: 'a\u0000b' });
  rejects('s2_search', { query: 'q', limit: 101 });
  rejects('s2_search', { query: 'q', limit: 100, offset: 901 }); // offset + limit > 1000
  rejects('s2_search', { query: 'q', year: '20' });
  rejects('s2_search', { query: 'q', year: '2020&x=1' });
  rejects('s2_search', { query: 'q', minCitationCount: -1 });
  rejects('s2_search', { query: 'q', fields: ['title', 'password'] });
  rejects('s2_search', { query: 'q', fields: [] });
  rejects('s2_search', { query: 'q', fields: 'title' });
});

test('s2_batch: POST 본문에 ids만 담는다', () => {
  const ids = ['ARXIV:1406.5823', 'ARXIV:1406.5823v2', 'ARXIV:math/0211159', 'DOI:10.18637/jss.v067.i01', 'a'.repeat(40)];
  const u = buildUpstream('s2_batch', { ids });
  assert.equal(u.method, 'POST');
  assert.deepEqual(JSON.parse(u.body), { ids });
  const url = new URL(u.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.semanticscholar.org/graph/v1/paper/batch');
  assert.equal(url.searchParams.get('fields'), 'citationCount,externalIds');
});

test('s2_batch: 개수와 형식을 검사한다', () => {
  rejects('s2_batch', { ids: [] });
  rejects('s2_batch', { ids: Array.from({ length: 501 }, () => 'ARXIV:1406.5823') });
  assert.ok(buildUpstream('s2_batch', { ids: Array.from({ length: 500 }, () => 'ARXIV:1406.5823') }));
  for (const bad of ['https://evil.example/x', 'URL:https://x.y', 'ARXIV:', 'DOI:abc', 'xyz', 123, null]) {
    rejects('s2_batch', { ids: [bad] });
  }
  rejects('s2_batch', { ids: 'ARXIV:1406.5823' });
});

test('알 수 없는 op와 객체가 아닌 params는 거절한다', () => {
  rejects('fetch_any_url', { url: 'https://evil.example' });
  rejects(undefined, {});
  rejects('arxiv_search', null);
  rejects('arxiv_search', []);
  rejects('arxiv_search', 'x');
});

// ---------------------------------------------------------------- gate.ts
test('gate: 요청을 한 줄로 세워 최소 간격을 지킨다', async () => {
  let t = 1000;
  const sleeps = [];
  const wait = createGate(3000, () => t, async (ms) => { sleeps.push(ms); t += ms; });
  const order = [];
  await Promise.all([wait().then(() => order.push(['a', t])), wait().then(() => order.push(['b', t])), wait().then(() => order.push(['c', t]))]);
  assert.deepEqual(sleeps, [3000, 3000]); // 첫 요청은 바로, 이후 3초씩
  assert.deepEqual(order, [['a', 1000], ['b', 4000], ['c', 7000]]);
});

test('gate: 간격이 이미 지났으면 기다리지 않는다', async () => {
  let t = 0;
  const sleeps = [];
  const wait = createGate(3000, () => t, async (ms) => { sleeps.push(ms); t += ms; });
  await wait();
  t += 5000;
  await wait();
  assert.deepEqual(sleeps, []);
});

// ---------------------------------------------------------------- handler.ts
const ORIGIN = 'http://localhost:5173';
const SECRET = 'S2-SECRET-KEY-VALUE';

function makeDeps(over = {}) {
  const calls = { fetch: [], gate: 0, log: [], order: [] };
  const deps = {
    authorize: async () => ({ ok: true }),
    fetch: async (url, init) => {
      calls.order.push('fetch');
      calls.fetch.push({ url, init });
      return new Response('<feed/>', { status: 200, headers: { 'content-type': 'application/atom+xml' } });
    },
    allowedOrigins: [ORIGIN],
    arxivGate: async () => { calls.gate += 1; calls.order.push('gate'); },
    log: (e) => calls.log.push(e),
    s2ApiKey: SECRET,
    ...over,
  };
  return { deps, calls };
}

const post = (body, headers = {}) =>
  new Request('https://fn.test/pn-search-proxy', {
    method: 'POST',
    headers: { origin: ORIGIN, authorization: 'Bearer user-token', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const ARXIV_REQ = { op: 'arxiv_search', params: { search_query: 'all:"secret query words"' } };

test('handler: 허용된 출처의 사전 요청(OPTIONS)은 CORS 헤더와 함께 204', async () => {
  const { deps } = makeDeps();
  const res = await handle(new Request('https://fn.test/', { method: 'OPTIONS', headers: { origin: ORIGIN } }), deps);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(res.headers.get('access-control-allow-headers'), /apikey/);
});

test('handler: 허용되지 않은 출처는 403이고 CORS 헤더가 없다', async () => {
  const { deps, calls } = makeDeps();
  for (const method of ['OPTIONS', 'POST']) {
    const res = await handle(new Request('https://fn.test/', { method, headers: { origin: 'https://evil.example', authorization: 'Bearer t' }, body: method === 'POST' ? '{}' : undefined }), deps);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(calls.fetch.length, 0);
});

test('handler: POST가 아니면 405', async () => {
  const { deps } = makeDeps();
  const res = await handle(new Request('https://fn.test/', { method: 'GET', headers: { origin: ORIGIN } }), deps);
  assert.equal(res.status, 405);
});

test('handler: 로그인하지 않았거나 승인되지 않은 계정은 외부로 요청을 보내지 않는다', async () => {
  for (const [auth, status, code] of [[{ ok: false, status: 401, code: 'unauthorized' }, 401, 'unauthorized'], [{ ok: false, status: 403, code: 'not_approved' }, 403, 'not_approved']]) {
    const { deps, calls } = makeDeps({ authorize: async () => auth });
    const res = await handle(post(ARXIV_REQ), deps);
    assert.equal(res.status, status);
    assert.equal((await res.json()).error.code, code);
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.gate, 0);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN); // 브라우저가 오류 내용을 읽을 수 있게
  }
});

test('handler: authorize에는 Authorization 헤더가 그대로 전달된다', async () => {
  let seen = 'unset';
  const { deps } = makeDeps({ authorize: async (h) => { seen = h; return { ok: true }; } });
  await handle(post(ARXIV_REQ), deps);
  assert.equal(seen, 'Bearer user-token');
  seen = 'unset';
  await handle(new Request('https://fn.test/', { method: 'POST', headers: { origin: ORIGIN }, body: '{}' }), deps);
  assert.equal(seen, null);
});

test('handler: 잘못된 요청은 400이고 외부로 보내지 않는다', async () => {
  const { deps, calls } = makeDeps();
  for (const body of ['not json', '[]', 'null', { op: 'nope', params: {} }, { op: 'arxiv_search', params: { search_query: 'a&b' } }, 'x'.repeat(100_001)]) {
    const res = await handle(post(body), deps);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await res.json()).error.code, 'bad_request');
  }
  assert.equal(calls.fetch.length, 0);
});

test('handler: arXiv 요청은 대기열을 거친 뒤 보내고, 응답을 그대로 돌려준다', async () => {
  const { deps, calls } = makeDeps();
  const res = await handle(post(ARXIV_REQ), deps);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<feed/>');
  assert.equal(res.headers.get('content-type'), 'application/atom+xml');
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(calls.order, ['gate', 'fetch']);
  assert.match(calls.fetch[0].url, /^https:\/\/export\.arxiv\.org\/api\/query\?/);
});

test('handler: Semantic Scholar 키는 Semantic Scholar 요청에만 붙는다', async () => {
  const { deps, calls } = makeDeps();
  await handle(post(ARXIV_REQ), deps);
  await handle(post({ op: 's2_search', params: { query: 'x' } }), deps);
  await handle(post({ op: 's2_batch', params: { ids: ['ARXIV:1406.5823'] } }), deps);
  const [arxiv, search, batch] = calls.fetch;
  assert.equal(arxiv.init.headers['x-api-key'], undefined);
  assert.equal(search.init.headers['x-api-key'], SECRET);
  assert.equal(batch.init.headers['x-api-key'], SECRET);
  assert.equal(batch.init.method, 'POST');
  assert.equal(batch.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(batch.init.body), { ids: ['ARXIV:1406.5823'] });
  assert.equal(calls.gate, 1, 'arXiv만 대기열을 거친다');
});

test('handler: 키가 없으면 헤더를 붙이지 않는다', async () => {
  const { deps, calls } = makeDeps({ s2ApiKey: undefined });
  await handle(post({ op: 's2_search', params: { query: 'x' } }), deps);
  assert.equal(calls.fetch[0].init.headers['x-api-key'], undefined);
});

test('handler: 응답이나 로그 어디에도 키와 검색어가 나오지 않는다', async () => {
  const { deps, calls } = makeDeps({
    fetch: async () => new Response('{"error":"nope"}', { status: 500 }),
  });
  const responses = [];
  for (const body of [ARXIV_REQ, { op: 's2_search', params: { query: 'secret query words' } }, { op: 'bad' }]) {
    const res = await handle(post(body), deps);
    responses.push(JSON.stringify([...res.headers.entries()]) + (await res.text()));
  }
  const everything = responses.join('\n') + JSON.stringify(calls.log);
  assert.doesNotMatch(everything, new RegExp(SECRET));
  assert.doesNotMatch(everything, /secret query words/);
  assert.ok(calls.log.length >= 3);
  for (const entry of calls.log) assert.deepEqual(Object.keys(entry).sort(), ['ms', 'op', 'status']);
});

test('handler: 업스트림 429는 429(대기 시간 포함)로, 그 밖의 오류는 502로 알린다', async () => {
  let r = makeDeps({ fetch: async () => new Response('', { status: 429, headers: { 'retry-after': '7' } }) });
  let res = await handle(post({ op: 's2_search', params: { query: 'x' } }), r.deps);
  assert.equal(res.status, 429);
  assert.deepEqual((await res.json()).error, { code: 'upstream_rate_limited', message: 'upstream rate limited', retry_after: 7 });

  r = makeDeps({ fetch: async () => new Response('', { status: 429 }) });
  res = await handle(post({ op: 's2_search', params: { query: 'x' } }), r.deps);
  assert.equal((await res.json()).error.retry_after, undefined);

  r = makeDeps({ fetch: async () => new Response('boom', { status: 503 }) });
  res = await handle(post(ARXIV_REQ), r.deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.upstream_status, 503);
});

test('handler: 시간 초과는 504, 연결 실패는 502', async () => {
  let r = makeDeps({ fetch: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
  assert.equal((await handle(post(ARXIV_REQ), r.deps)).status, 504);
  r = makeDeps({ fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await handle(post(ARXIV_REQ), r.deps)).status, 502);
});

test('handler: 업스트림 응답이 너무 크면 거절한다', async () => {
  const { deps } = makeDeps({ fetch: async () => new Response('x'.repeat(3_000_001), { status: 200 }) });
  const res = await handle(post(ARXIV_REQ), deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'upstream_too_large');
});

test('handler: Origin이 없는 요청(서버 간 호출)도 인증을 통과하면 처리한다', async () => {
  const { deps } = makeDeps();
  const req = new Request('https://fn.test/', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(ARXIV_REQ) });
  const res = await handle(req, deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
