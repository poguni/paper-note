import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

for (const f of ['keystore', 'models', 'schema', 'cost', 'openrouter', 'analyze']) await import(`../src/js/ai/${f}.js`);
const PN = globalThis.PN;

const KEY = 'sk-or-v1-TESTKEY0123456789abcdef';

// ---------------------------------------------------------------- 3.1 키 보관
const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};

test('키 보관: 저장하고 읽고 지운다. 앞뒤 공백은 지운다', () => {
  const s = fakeStorage();
  const store = PN.createKeyStore(s);
  assert.equal(store.has(), false);
  assert.equal(store.set(`  ${KEY}\n`), null);
  assert.equal(store.get(), KEY);
  assert.equal(store.has(), true);
  store.clear();
  assert.equal(store.get(), null);
  assert.equal(s._m.size, 0);
});

test('키 보관: 형식이 틀린 값은 저장하지 않고, 오류 문장에 입력값이 들어가지 않는다', () => {
  const s = fakeStorage();
  const store = PN.createKeyStore(s);
  for (const bad of ['', '   ', 'hello', 'sk-ant-abcdefghijklmnop', 'sk-or-', 'sk-or-short']) {
    const msg = store.set(bad);
    assert.ok(msg, `거절되어야 함: "${bad}"`);
    if (bad.length > 6) assert.ok(!msg.includes(bad), '오류 문장에 입력값이 들어 있음'); // 안내문에 쓰는 'sk-or-' 접두사는 제외
  }
  assert.equal(s._m.size, 0);
});

test('키 보관: 저장소 접근이 막혀도 예외 없이 문장으로 알린다', () => {
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const store = PN.createKeyStore(blocked);
  assert.equal(store.get(), null);
  assert.match(store.set(KEY), /보관할 수 없습니다/);
  assert.doesNotThrow(() => store.clear());
});

test('키 보관: 소스는 localStorage를 쓰지 않고, 키를 출력하는 코드가 없다', () => {
  const dir = new URL('../src/js/ai/', import.meta.url);
  const names = readdirSync(dir).filter((n) => n.endsWith('.js'));
  for (const name of names) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(text, /localStorage\s*[.[]/, `${name}: localStorage 사용`);
    assert.doesNotMatch(text, /console\.(log|info|warn|error|debug)/, `${name}: 콘솔 출력`);
  }
  const all = names.map((n) => readFileSync(new URL(n, dir), 'utf8')).join('\n');
  assert.doesNotMatch(all, /supabase\s*\.|\.from\(|createClient/, 'AI 코드가 Supabase에 키를 보낼 수 있음');
});

// ---------------------------------------------------------------- 3.2 모델과 요청 본문
test('모델: ID는 PRD 표 그대로이고 latest 별칭이 없다', () => {
  assert.deepEqual(PN.MODELS.map((m) => m.id), ['anthropic/claude-sonnet-5.5', 'google/gemini-3.8-flash', 'openai/gpt-6-luna']);
  assert.ok(PN.MODELS.every((m) => !/latest/i.test(m.id)));
  assert.equal(PN.DEFAULT_MODEL, 'anthropic/claude-sonnet-5.5');
  assert.deepEqual(PN.MODELS.map((m) => [m.priceIn, m.priceOut]), [[2, 10], [0.75, 3.75], [0.10, 0.50]]);
});

const spec = (over = {}) => ({ modelId: PN.DEFAULT_MODEL, messages: [{ role: 'user', content: 'x' }], schemaName: 's', schema: { type: 'object' }, maxTokens: 100, ...over });

test('요청 본문: 모델별 기본 추론 설정 (Claude·Gemini는 low, Luna는 none)', () => {
  assert.deepEqual(PN.buildRequestBody(spec()).reasoning, { effort: 'low' });
  assert.deepEqual(PN.buildRequestBody(spec({ modelId: 'google/gemini-3.8-flash' })).reasoning, { effort: 'low' });
  assert.deepEqual(PN.buildRequestBody(spec({ modelId: 'openai/gpt-6-luna' })).reasoning, { effort: 'none' });
});

test('요청 본문: strict JSON 스키마, 사용량 포함, 추론 강도 지정', () => {
  const b = PN.buildRequestBody(spec({ effort: 'high', maxTokens: 777 }));
  assert.equal(b.model, 'anthropic/claude-sonnet-5.5');
  assert.deepEqual(b.reasoning, { effort: 'high' });
  assert.equal(b.max_tokens, 777);
  assert.deepEqual(b.response_format, { type: 'json_schema', json_schema: { name: 's', strict: true, schema: { type: 'object' } } });
  assert.deepEqual(b.usage, { include: true });
});

test('요청 본문: 모델이 지원하지 않는 추론 강도와 모르는 모델은 거절', () => {
  assert.throws(() => PN.buildRequestBody(spec({ effort: 'none' })), /쓸 수 없습니다/); // Claude는 끌 수 없다
  assert.throws(() => PN.buildRequestBody(spec({ modelId: 'google/gemini-3.8-flash', effort: 'none' })), /쓸 수 없습니다/);
  assert.doesNotThrow(() => PN.buildRequestBody(spec({ modelId: 'openai/gpt-6-luna', effort: 'none' })));
  assert.throws(() => PN.buildRequestBody(spec({ modelId: 'x/unknown' })), /알 수 없는 모델/);
});

// ---------------------------------------------------------------- 3.5 비용
const cents = (usd) => usd * 100;
const near = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} ≠ ${expected}`);

test('비용: PRD 비용 표와 같다 (본문 3만 토큰, 구조화 요약 출력 2천 토큰)', () => {
  near(cents(PN.computeCost('openai/gpt-6-luna', 30000, 2000)), 0.4, 0.01, 'Luna');
  near(cents(PN.computeCost('google/gemini-3.8-flash', 30000, 2000)), 3, 0.01, 'Gemini');
  near(cents(PN.computeCost('anthropic/claude-sonnet-5.5', 30000, 2000)), 8, 0.01, 'Claude');
});

test('비용: PRD 비용 표의 전문 번역 (출력 3만 토큰)', () => {
  near(cents(PN.computeCost('openai/gpt-6-luna', 30000, 30000)), 1.8, 0.01, 'Luna'); // 약 2센트
  near(cents(PN.computeCost('google/gemini-3.8-flash', 30000, 30000)), 13.5, 0.01, 'Gemini'); // 약 14센트
  near(cents(PN.computeCost('anthropic/claude-sonnet-5.5', 30000, 30000)), 36, 0.01, 'Claude');
});

test('비용: 통계 분석 모드는 출력 1천 토큰만큼 더 든다 (Claude 약 1센트, Gemini 약 0.4센트, Luna 약 0.05센트)', () => {
  const extra = (id) => cents(PN.computeCost(id, 0, PN.STATS_EXTRA_OUTPUT));
  near(extra('anthropic/claude-sonnet-5.5'), 1, 0.001, 'Claude');
  near(extra('google/gemini-3.8-flash'), 0.375, 0.001, 'Gemini');
  near(extra('openai/gpt-6-luna'), 0.05, 0.001, 'Luna');
  const on = PN.estimateAnalysis({ modelId: PN.DEFAULT_MODEL, stage: 'fulltext', inputTokens: 1000, statsMode: true });
  const off = PN.estimateAnalysis({ modelId: PN.DEFAULT_MODEL, stage: 'fulltext', inputTokens: 1000, statsMode: false });
  assert.equal(on.outputTokens - off.outputTokens, 1000);
  const abstractOn = PN.estimateAnalysis({ modelId: PN.DEFAULT_MODEL, stage: 'abstract', inputTokens: 1000, statsMode: true });
  assert.equal(abstractOn.outputTokens, PN.STAGES.abstract.expectedOutput); // 초록 단계에는 통계 상세가 없다
});

test('비용: Luna는 입력이 27만 2천 토큰을 넘으면 입력 단가가 2배', () => {
  const at = PN.computeCost('openai/gpt-6-luna', 272000, 0);
  const over = PN.computeCost('openai/gpt-6-luna', 272001, 0);
  near(at, 0.0272, 1e-9, '경계 이하');
  near(over, 272001 * 0.2 / 1e6, 1e-9, '경계 초과');
  assert.equal(PN.computeCost('anthropic/claude-sonnet-5.5', 272001, 0), 272001 * 2 / 1e6); // 다른 모델은 그대로
});

test('토큰 어림값: 영문은 4글자당 1토큰, 영문이 아닌 글자는 1글자당 1토큰', () => {
  assert.equal(PN.estimateTokens(''), 0);
  assert.equal(PN.estimateTokens('abcd'), 1);
  assert.equal(PN.estimateTokens('abcde'), 2);
  assert.equal(PN.estimateTokens('다층모형'), 4);
  assert.equal(PN.estimateTokens('ab 다층'), 1 + 2);
});

test('확인창 기준: 비용 10센트 이상이거나 입력 6만 토큰 이상이면 확인을 받는다', () => {
  const claude = (n) => PN.estimateAnalysis({ modelId: PN.DEFAULT_MODEL, stage: 'fulltext', inputTokens: n });
  assert.equal(claude(5000).needsConfirm, false);
  assert.equal(claude(30000).needsConfirm, false); // 약 9센트 (출력 3천 토큰 기준): 확인창 기준 10센트 바로 아래
  const big = claude(60000);
  assert.equal(big.needsConfirm, true);
  assert.deepEqual(big.reasons.sort(), ['cost', 'input']);
  const luna = PN.estimateAnalysis({ modelId: 'openai/gpt-6-luna', stage: 'fulltext', inputTokens: 60000 });
  assert.deepEqual(luna.reasons, ['input']); // 싼 모델도 입력이 크면 확인
});

test('비용 표시 문장', () => {
  assert.equal(PN.formatCost(0.00005), '0.1센트 미만');
  assert.equal(PN.formatCost(0.004), '약 0.4센트');
  assert.equal(PN.formatCost(0.0104), '약 1센트');
  assert.equal(PN.formatCost(0.08), '약 8센트');
  assert.equal(PN.formatCost(1.234), '약 $1.2');
});

// ---------------------------------------------------------------- 3.3 JSON 스키마와 검증
const abstractResult = () => ({
  summary_3lines: ['첫째', '둘째', '셋째'],
  abstract_translation: '번역문',
  glossary: [{ term: '혼합효과모형', ko: '혼합효과모형', explanation: '설명' }],
});
const stats = () => ({
  is_statistical: true, model: 'LMM', assumptions: ['정규성'], estimation_method: 'REML', software: ['R'],
  sample: '언급 없음', fit_indices: [{ name: 'AIC', value: '1.0' }], python_skeleton: '# TODO',
});
const fulltextResult = (withStats) => ({
  summary_3lines: ['a', 'b', 'c'],
  structured_summary: { purpose: 'p', method: 'm', results: 'r', limitations: '언급 없음' },
  glossary: [{ term: 'REML', ko: '제한최대우도', explanation: 'e' }],
  section_translations: [{ title: 'Introduction', ko: '서론 번역' }],
  app_ideas: [{ name: 'n', one_liner: 'o', evidence: 'ev', core_features: ['f1', 'f2', 'f3'], difficulty: 'medium', single_html_possible: true, first_prompt: 'fp' }],
  ...(withStats ? { statistics_details: stats() } : {}),
});
const resp = (content, over = {}) => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop', ...over }] });

test('검증: 정상 결과는 통과하고, 정의에 없는 항목은 버린다', () => {
  assert.deepEqual(PN.validateAnalysis('abstract', abstractResult()), { ok: true, value: abstractResult() });
  const extra = { ...abstractResult(), unexpected: 1 };
  assert.deepEqual(PN.validateAnalysis('abstract', extra).value, abstractResult());
});

test('검증: 본문 단계에서 통계 상세는 모드가 켜져 있을 때만 받고, 꺼져 있으면 null', () => {
  const off = PN.validateAnalysis('fulltext', fulltextResult(false), false);
  assert.equal(off.ok, true);
  assert.equal(off.value.statistics_details, null);
  const on = PN.validateAnalysis('fulltext', fulltextResult(true), true);
  assert.equal(on.ok, true);
  assert.equal(on.value.statistics_details.model, 'LMM');
  const missing = PN.validateAnalysis('fulltext', fulltextResult(false), true); // 켰는데 모델이 빼먹음
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes('statistics_details')));
});

test('검증: 비통계 논문은 is_statistical=false에 빈 값으로 두어도 통과', () => {
  const r = fulltextResult(true);
  r.statistics_details = { is_statistical: false, model: '', assumptions: [], estimation_method: '', software: [], sample: '', fit_indices: [], python_skeleton: '' };
  assert.equal(PN.validateAnalysis('fulltext', r, true).ok, true);
});

test('검증: 항목 누락, 잘못된 타입, 허용되지 않는 값, 3줄이 아닌 요약을 거절한다', () => {
  const noTranslation = abstractResult();
  delete noTranslation.abstract_translation;
  let r = PN.validateAnalysis('abstract', noTranslation);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('abstract_translation')));

  r = PN.validateAnalysis('abstract', { ...abstractResult(), glossary: 'none' });
  assert.equal(r.ok, false);

  const badDifficulty = fulltextResult(false);
  badDifficulty.app_ideas[0].difficulty = 'impossible';
  assert.equal(PN.validateAnalysis('fulltext', badDifficulty, false).ok, false);

  assert.equal(PN.validateAnalysis('abstract', { ...abstractResult(), summary_3lines: ['하나', '둘'] }).ok, false);
  assert.equal(PN.validateAnalysis('abstract', { ...abstractResult(), summary_3lines: ['하나', '둘', '  '] }).ok, false);
  assert.equal(PN.validateAnalysis('abstract', null).ok, false);
  assert.equal(PN.validateAnalysis('abstract', []).ok, false);
});

test('검증: 비어 있으면 안 되는 내용이 비면 거절한다 ("언급 없음"으로 적어야 한다)', () => {
  const empty = fulltextResult(false);
  empty.structured_summary.limitations = '';
  const r = PN.validateAnalysis('fulltext', empty, false);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('limitations')));
  const noSections = fulltextResult(false);
  noSections.section_translations = [];
  assert.equal(PN.validateAnalysis('fulltext', noSections, false).ok, false);
});

test('스키마: 모든 항목이 필수이고 추가 항목을 허용하지 않는다 (strict 출력 요건)', () => {
  const walk = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  walk(PN.analysisSchema('abstract').schema);
  walk(PN.analysisSchema('fulltext', true).schema);
  assert.ok(!('statistics_details' in PN.analysisSchema('fulltext', false).schema.properties));
  assert.ok('statistics_details' in PN.analysisSchema('fulltext', true).schema.properties);
  assert.throws(() => PN.analysisSchema('nope'), /알 수 없는 분석 단계/);
});

test('응답 해석 ① 정상', () => {
  const r = PN.parseAnalysisResponse('abstract', resp(abstractResult()));
  assert.equal(r.ok, true);
  assert.equal(r.value.summary_3lines.length, 3);
});

test('응답 해석 ② 일부 누락 → invalid', () => {
  const partial = abstractResult();
  delete partial.glossary;
  const r = PN.parseAnalysisResponse('abstract', resp(partial));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid');
  assert.ok(r.errors.length > 0);
});

test('응답 해석 ③ JSON이 아님 → not_json, 코드 블록으로 감싼 JSON은 통과', () => {
  assert.equal(PN.parseAnalysisResponse('abstract', resp('요약은 다음과 같습니다: ...')).code, 'not_json');
  const fenced = '```json\n' + JSON.stringify(abstractResult()) + '\n```';
  assert.equal(PN.parseAnalysisResponse('abstract', resp(fenced)).ok, true);
});

test('응답 해석 ④ 토큰 부족으로 잘림 → truncated (잘린 JSON을 해석하려 하지 않는다)', () => {
  const cut = resp(JSON.stringify(abstractResult()).slice(0, 40), { finish_reason: 'length' });
  assert.equal(PN.parseAnalysisResponse('abstract', cut).code, 'truncated');
});

test('응답 해석: 거절, 빈 답, 선택지 없음', () => {
  assert.equal(PN.parseAnalysisResponse('abstract', { choices: [{ message: { content: null, refusal: '거절' }, finish_reason: 'stop' }] }).code, 'refused');
  assert.equal(PN.parseAnalysisResponse('abstract', resp('')).code, 'empty');
  assert.equal(PN.parseAnalysisResponse('abstract', { choices: [] }).code, 'empty');
  assert.equal(PN.parseAnalysisResponse('abstract', undefined).code, 'empty');
});

// ---------------------------------------------------------------- 3.3 실행과 재시도
const usageOf = (cost) => ({ prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 10 }, cost });
const fakeClient = (responses) => {
  const bodies = [];
  let i = 0;
  return {
    bodies,
    chat: async (body) => {
      bodies.push(body);
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
};
const run = (client, over = {}) => PN.runAnalysis(client, { modelId: PN.DEFAULT_MODEL, stage: 'abstract', messages: [{ role: 'user', content: '초록' }], statsMode: false, ...over });

test('실행: 첫 시도에 성공하면 한 번만 보내고 사용량을 돌려준다', async () => {
  const c = fakeClient([{ ...resp(abstractResult()), usage: usageOf(0.002) }]);
  const out = await run(c);
  assert.equal(out.attempts, 1);
  assert.equal(c.bodies.length, 1);
  assert.deepEqual(out.usage, { promptTokens: 100, completionTokens: 50, reasoningTokens: 10, costUsd: 0.002 });
  assert.equal(c.bodies[0].max_tokens, PN.STAGES.abstract.maxTokens);
});

test('실행: 형식이 틀리면 규칙을 다시 일러 주고 한 번만 다시 보낸다 (사용량은 합산)', async () => {
  const c = fakeClient([{ ...resp('JSON 아님'), usage: usageOf(0.001) }, { ...resp(abstractResult()), usage: usageOf(0.002) }]);
  const out = await run(c);
  assert.equal(out.attempts, 2);
  assert.equal(c.bodies.length, 2);
  assert.equal(c.bodies[1].messages.length, c.bodies[0].messages.length + 1);
  assert.match(c.bodies[1].messages.at(-1).content, /JSON/);
  assert.equal(out.usage.costUsd, 0.003);
  assert.equal(out.usage.promptTokens, 200);
});

test('실행: 잘리면 출력 한도를 1.5배로 늘려 다시 보낸다', async () => {
  const cut = resp('{"summary_3lines":["a"', { finish_reason: 'length' });
  const c = fakeClient([cut, resp(abstractResult())]);
  const out = await run(c);
  assert.equal(out.attempts, 2);
  assert.equal(c.bodies[1].max_tokens, PN.STAGES.abstract.maxTokens * 1.5);
  assert.equal(c.bodies[1].messages.length, c.bodies[0].messages.length); // 메시지는 그대로
});

test('실행: 두 번 다 틀리면 세 번째는 보내지 않고 AnalysisError (쓴 사용량 포함)', async () => {
  const c = fakeClient([{ ...resp('x'), usage: usageOf(0.001) }]);
  await assert.rejects(run(c), (e) => {
    assert.equal(e.name, 'AnalysisError');
    assert.equal(e.code, 'not_json');
    assert.equal(e.usage.costUsd, 0.002);
    return true;
  });
  assert.equal(c.bodies.length, 2);
});

test('실행: 모델이 거절하면 다시 보내지 않는다', async () => {
  const c = fakeClient([{ choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'stop' }] }]);
  await assert.rejects(run(c), (e) => e.code === 'refused');
  assert.equal(c.bodies.length, 1);
});

test('실행: 통신·키·크레딧 오류는 그대로 던지고 다시 보내지 않는다', async () => {
  const err = Object.assign(new Error('x'), { name: 'OpenRouterError', code: 'insufficient_credit', status: 402 });
  const c = fakeClient([err]);
  await assert.rejects(run(c), (e) => e.code === 'insufficient_credit' && e.usage.costUsd === 0);
  assert.equal(c.bodies.length, 1);
});

test('실행: 본문 단계는 통계 모드에 따라 스키마가 달라지고 출력 한도가 더 크다', async () => {
  const c = fakeClient([resp(fulltextResult(true))]);
  const out = await run(c, { stage: 'fulltext', statsMode: true });
  assert.ok('statistics_details' in c.bodies[0].response_format.json_schema.schema.properties);
  assert.equal(c.bodies[0].max_tokens, PN.STAGES.fulltext.maxTokens);
  assert.equal(out.value.statistics_details.model, 'LMM');
});

test('오류 문장: 분석 오류와 통신 오류 모두 사용자용 문장이고 키를 담지 않는다', () => {
  for (const code of ['truncated', 'refused', 'empty', 'not_json', 'invalid', 'no_key', 'unauthorized', 'insufficient_credit', 'forbidden', 'rate_limited', 'timeout', 'network', 'aborted', 'upstream']) {
    const msg = PN.analysisErrorMessage({ code });
    assert.ok(msg && msg.length > 5, code);
    assert.ok(!msg.includes('sk-or'), code);
  }
});

// ---------------------------------------------------------------- 3.1 OpenRouter 호출
const okResponse = (json) => ({ ok: true, status: 200, json: async () => json });
const failResponse = (status) => ({ ok: false, status, json: async () => ({ error: { message: `${KEY} 문제` } }) });

test('호출: 키는 openrouter.ai 요청의 Authorization 헤더에만 들어간다', async () => {
  const calls = [];
  const client = PN.createOpenRouter({ getKey: () => KEY, fetch: async (url, init) => { calls.push({ url, init }); return okResponse({ choices: [] }); } });
  await client.chat({ model: 'm', messages: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  const others = Object.entries(calls[0].init.headers).filter(([name]) => name !== 'Authorization');
  assert.ok(others.every(([, v]) => !String(v).includes(KEY)), '다른 헤더에 키가 들어 있음');
  assert.ok(!calls[0].init.body.includes(KEY), '본문에 키가 들어 있음');
  assert.ok(!calls[0].url.includes(KEY), '주소에 키가 들어 있음');
});

test('호출: 키가 없으면 요청을 보내지 않는다', async () => {
  let n = 0;
  const client = PN.createOpenRouter({ getKey: () => null, fetch: async () => { n++; } });
  await assert.rejects(client.chat({}), (e) => e.code === 'no_key');
  assert.equal(n, 0);
});

test('호출: HTTP 상태별 오류 종류, 서버가 보낸 문장(키가 섞일 수 있음)은 그대로 노출하지 않는다', async () => {
  const expected = { 401: 'unauthorized', 402: 'insufficient_credit', 403: 'forbidden', 408: 'timeout', 429: 'rate_limited', 504: 'timeout', 500: 'upstream', 502: 'upstream' };
  for (const [status, code] of Object.entries(expected)) {
    const client = PN.createOpenRouter({ getKey: () => KEY, fetch: async () => failResponse(Number(status)) });
    await assert.rejects(client.chat({}), (e) => {
      assert.equal(e.code, code, status);
      assert.ok(!e.message.includes(KEY) && !PN.openrouterErrorMessage(e).includes('sk-or'));
      return true;
    });
  }
});

test('호출: 200 안에 error가 오면 오류, 네트워크 실패와 취소는 따로 구분', async () => {
  let client = PN.createOpenRouter({ getKey: () => KEY, fetch: async () => okResponse({ error: { code: 429, message: 'slow down' } }) });
  await assert.rejects(client.chat({}), (e) => e.code === 'rate_limited');
  client = PN.createOpenRouter({ getKey: () => KEY, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(client.chat({}), (e) => e.code === 'network');
  client = PN.createOpenRouter({ getKey: () => KEY, fetch: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
  await assert.rejects(client.chat({}), (e) => e.code === 'aborted');
  client = PN.createOpenRouter({ getKey: () => KEY, fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }) });
  await assert.rejects(client.chat({}), (e) => e.code === 'bad_response');
});

test('호출: 취소 신호(signal)를 fetch에 넘긴다', async () => {
  let seen;
  const client = PN.createOpenRouter({ getKey: () => KEY, fetch: async (u, init) => { seen = init.signal; return okResponse({}); } });
  const ac = new AbortController();
  await client.chat({}, ac.signal);
  assert.equal(seen, ac.signal);
});

// ---------------------------------------------------------------- 통계 분석 모드 검증
test('검증: 통계 논문인데 모형, 추정 방법, 표본, 코드 뼈대가 비어 있으면 거절한다', () => {
  for (const key of ['model', 'estimation_method', 'sample', 'python_skeleton']) {
    const r = fulltextResult(true);
    r.statistics_details[key] = '  ';
    const v = PN.validateAnalysis('fulltext', r, true);
    assert.equal(v.ok, false, key);
    assert.ok(v.errors.some((e) => e.includes(`statistics_details.${key}`)), key);
  }
});

test('검증: 통계 논문이어도 가정, 소프트웨어, 적합도 지수 목록은 비어 있어도 된다 ("언급 없음"은 화면이 보여 준다)', () => {
  const r = fulltextResult(true);
  Object.assign(r.statistics_details, { assumptions: [], software: [], fit_indices: [] });
  assert.equal(PN.validateAnalysis('fulltext', r, true).ok, true);
});

test('검증: 문자열 항목에 "본문에 언급 없음"을 적은 통계 상세는 통과한다', () => {
  const r = fulltextResult(true);
  Object.assign(r.statistics_details, { sample: '본문에 언급 없음', estimation_method: '본문에 언급 없음' });
  assert.equal(PN.validateAnalysis('fulltext', r, true).ok, true);
});
