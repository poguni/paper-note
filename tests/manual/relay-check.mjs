// 수동 확인용 (자동 테스트에 포함되지 않음). 배포된 검색 중계 함수(pn-search-proxy)를 실제로 호출해 본다.
// 사용: PN_EMAIL=... PN_PASSWORD=... node tests/manual/relay-check.mjs
// 비밀번호는 환경변수로만 받고 출력하지 않는다. arXiv 호출이 1건 포함되며, 3초 간격 규칙을 지키려고 느릴 수 있다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = readFileSync(join(root, 'src', 'js', 'config.js'), 'utf8');
const url = config.match(/supabaseUrl:\s*'([^']+)'/)[1];
const key = config.match(/supabaseKey:\s*'([^']+)'/)[1];
const fn = `${url}/functions/v1/pn-search-proxy`;

const { PN_EMAIL: email, PN_PASSWORD: password } = process.env;
if (!email || !password) {
  console.error('PN_EMAIL, PN_PASSWORD 환경변수가 필요합니다.');
  process.exit(1);
}

let failed = 0;
let warned = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// ok: 통과 여부, warn: 통과는 아니지만 중계 자체의 오류는 아닌 경우(△)
const report = (ok, name, detail = '', warn = false) => {
  if (!ok && !warn) failed += 1;
  if (!ok && warn) warned += 1;
  console.log(`${ok ? '✔' : warn ? '△' : '✖'} ${name}${detail ? '  ' + detail : ''}`);
};

const call = async (headers, body) => {
  const res = await fetch(fn, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* XML 등 */ }
  return { status: res.status, text, json };
};

// ---- 로그인 (Supabase Auth REST)
const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error(`로그인 실패 (HTTP ${login.status}). 이메일과 비밀번호를 확인하세요.`);
  process.exit(1);
}
const { access_token: token } = await login.json();
const authed = { apikey: key, Authorization: `Bearer ${token}` };

// ---- 인증 없이 / 공개용 키만으로는 거절되어야 한다
let r = await call({ apikey: key }, { op: 'arxiv_search', params: { search_query: 'all:test' } });
report(r.status === 401, '인증 헤더 없이 호출하면 401', `(HTTP ${r.status})`);
r = await call({ apikey: key, Authorization: `Bearer ${key}` }, { op: 'arxiv_search', params: { search_query: 'all:test' } });
report(r.status === 401, '공개용 키만으로 호출하면 401', `(HTTP ${r.status})`);

// ---- 허용되지 않은 출처
r = await call({ ...authed, Origin: 'https://evil.example' }, { op: 'arxiv_search', params: { search_query: 'all:test' } });
report(r.status === 403, '허용되지 않은 출처는 403', `(HTTP ${r.status}; 이 환경이 Origin 헤더를 보내지 않으면 건너뜀)`);

// ---- 잘못된 요청은 400
r = await call(authed, { op: 'fetch_any_url', params: { url: 'https://example.com' } });
report(r.status === 400, '허용되지 않은 호출 종류는 400', `(HTTP ${r.status})`);
r = await call(authed, { op: 'arxiv_search', params: { search_query: 'x&max_results=5000' } });
report(r.status === 400, '파라미터 끼워 넣기는 400', `(HTTP ${r.status})`);

// ---- 정상 호출
r = await call(authed, { op: 'arxiv_search', params: { search_query: 'all:"linear mixed-effects" AND cat:stat.CO', max_results: 2 } });
report(r.status === 200 && r.text.includes('<feed'), 'arXiv 검색 (XML 응답)', `(HTTP ${r.status}, ${r.text.length} bytes)`);

// Semantic Scholar는 키가 있어도 초당 1회 한도라서 호출 사이를 띄운다.
// 429(△)는 중계의 오류가 아니라 Semantic Scholar의 호출 한도다. 키가 함수에 반영되지 않았을 때도 나온다.
const s2Detail = (r, ok, okText) =>
  ok ? okText
    : r.status === 429 ? `(HTTP 429, 대기 ${r.json?.error?.retry_after ?? '?'}초: Semantic Scholar 호출 한도. S2_API_KEY가 함수에 반영되지 않았거나 한도 초과)`
    : `(HTTP ${r.status}, ${r.json?.error?.code ?? r.text.slice(0, 80)})`;

await sleep(1500);
r = await call(authed, { op: 's2_batch', params: { ids: ['ARXIV:1406.5823'] } });
const s2ok = r.status === 200 && Array.isArray(r.json) && typeof r.json[0]?.citationCount === 'number';
report(s2ok, 'Semantic Scholar 일괄 조회(인용수)', s2Detail(r, s2ok, `(HTTP 200, 인용수 ${r.json?.[0]?.citationCount})`), r.status === 429);

await sleep(1500);
r = await call(authed, { op: 's2_search', params: { query: 'multilevel model', limit: 2 } });
const s2s = r.status === 200 && Array.isArray(r.json?.data);
report(s2s, 'Semantic Scholar 검색', s2Detail(r, s2s, `(HTTP 200, ${r.json?.data?.length}건)`), r.status === 429);

// PN_SAVE_FIXTURES=1 이면 실제 Semantic Scholar 응답을 tests/fixtures/ 에 저장한다.
// 공개된 논문 메타데이터뿐이며 키나 토큰은 들어 있지 않다. 직접 쓴 예시 데이터가 실제 형식과 같은지 비교하는 데 쓴다.
if (process.env.PN_SAVE_FIXTURES === '1') {
  const outDir = join(root, 'tests', 'fixtures');
  await sleep(1500);
  r = await call(authed, { op: 's2_search', params: { query: 'multilevel model', limit: 5 } });
  if (r.status === 200) writeFileSync(join(outDir, 's2-live-search.json'), JSON.stringify(r.json, null, 2));
  console.log(`저장: s2-live-search.json (HTTP ${r.status})`);
  await sleep(1500);
  const ids = ['ARXIV:1406.5823', 'ARXIV:1002.3784', 'ARXIV:2207.12455', 'ARXIV:0000.00000', 'DOI:10.18637/jss.v067.i01'];
  r = await call(authed, { op: 's2_batch', params: { ids } });
  if (r.status === 200) writeFileSync(join(outDir, 's2-live-batch.json'), JSON.stringify({ ids, response: r.json }, null, 2));
  console.log(`저장: s2-live-batch.json (HTTP ${r.status})`);
}

console.log(failed ? `\n실패 ${failed}건` : warned ? `\n중계는 정상, 경고 ${warned}건 (Semantic Scholar 호출 한도)` : '\n모든 확인 통과');
process.exit(failed === 0 ? 0 : 1);
