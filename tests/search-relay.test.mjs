import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PN } from './helpers/search-env.mjs';

const URL = 'https://x.supabase.co/functions/v1/pn-search-proxy';

function makeRelay({ token = 'user-token', respond }) {
  const calls = [];
  const relay = PN.createRelay({
    url: URL,
    apikey: 'sb_publishable_test',
    getToken: async () => token,
    fetch: async (url, init) => { calls.push({ url, init }); return respond(url, init); },
  });
  return { relay, calls };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('relay: 사용자 토큰과 공개용 키를 헤더에, op와 params를 본문에 담아 보낸다', async () => {
  const { relay, calls } = makeRelay({ respond: () => json([{ citationCount: 1 }]) });
  assert.deepEqual(await relay.call('s2_batch', { ids: ['ARXIV:1406.5823'] }), [{ citationCount: 1 }]);
  assert.equal(calls[0].url, URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
  assert.equal(calls[0].init.headers.apikey, 'sb_publishable_test');
  assert.deepEqual(JSON.parse(calls[0].init.body), { op: 's2_batch', params: { ids: ['ARXIV:1406.5823'] } });
});

test('relay: XML 응답은 문자열로 돌려준다', async () => {
  const { relay } = makeRelay({ respond: () => new Response('<feed/>', { status: 200, headers: { 'content-type': 'application/atom+xml' } }) });
  assert.equal(await relay.call('arxiv_search', { search_query: 'all:x' }), '<feed/>');
});

test('relay: 토큰이 없으면 호출하지 않고 unauthorized', async () => {
  const { relay, calls } = makeRelay({ token: null, respond: () => json({}) });
  await assert.rejects(relay.call('arxiv_search', {}), (e) => e.name === 'RelayError' && e.code === 'unauthorized' && e.status === 401);
  assert.equal(calls.length, 0);
});

test('relay: 오류 응답에서 code, status, 대기 시간을 읽는다', async () => {
  const { relay } = makeRelay({ respond: () => json({ error: { code: 'upstream_rate_limited', message: 'm', retry_after: 7 } }, 429) });
  await assert.rejects(relay.call('s2_search', {}), (e) => e.code === 'upstream_rate_limited' && e.status === 429 && e.retryAfter === 7);
});

test('relay: 본문이 JSON이 아닌 오류와 연결 실패', async () => {
  let r = makeRelay({ respond: () => new Response('<html>Bad Gateway</html>', { status: 502 }) });
  await assert.rejects(r.relay.call('x', {}), (e) => e.code === 'upstream_error' && e.status === 502);
  r = makeRelay({ respond: () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(r.relay.call('x', {}), (e) => e.code === 'network' && e.status === 0);
});

test('relayErrorMessage: 오류 종류별 안내 문장', () => {
  const m = (code, extra = {}) => PN.relayErrorMessage({ code, ...extra });
  assert.match(m('unauthorized'), /로그인/);
  assert.match(m('not_approved'), /승인/);
  assert.match(m('network'), /네트워크/);
  assert.match(m('upstream_rate_limited', { retryAfter: 7 }), /7초/);
  assert.match(m('upstream_rate_limited'), /잠시/);
  assert.match(m('upstream_timeout'), /늦습니다/);
  assert.match(m('bad_request'), /조건/);
  assert.match(m('whatever'), /문제/);
  assert.match(PN.relayErrorMessage(null), /문제/);
});
