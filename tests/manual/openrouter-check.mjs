// 수동 확인용 (자동 테스트에 포함되지 않음, 파일 이름이 *.test.mjs가 아님).
// OpenRouter 모델 3종에 같은 짧은 요청을 보내 JSON 출력과 추론 설정이 받아들여지는지 본다.
// 사용: OPENROUTER_API_KEY=sk-or-... node tests/manual/openrouter-check.mjs
// 키는 환경변수로만 읽고 출력하지 않는다. 호출 비용은 모델당 1센트 미만이다.

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY 환경변수가 없습니다.');
  process.exit(1);
}

const abstract =
  'The lme4 package for R provides functions to fit and analyze linear mixed models, generalized linear mixed models and nonlinear mixed models. ' +
  'This paper describes the formula syntax, the profiled deviance criterion, and the class structure used to represent fitted models.';

const schema = {
  type: 'object',
  properties: { summary_3lines: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } },
  required: ['summary_3lines'],
  additionalProperties: false,
};

// PRD: Claude·Gemini는 추론이 항상 켜져 있고 강도로 조절, Luna는 끌 수 있음(none)
const models = [
  { id: 'anthropic/claude-sonnet-5.5', reasoning: { effort: 'low' } },
  { id: 'google/gemini-3.8-flash', reasoning: { effort: 'low' } },
  { id: 'openai/gpt-6-luna', reasoning: { effort: 'none' } },
];

for (const m of models) {
  const body = {
    model: m.id,
    messages: [
      { role: 'system', content: '한국어로만 답하고, 지정한 JSON 외의 문장은 출력하지 않는다.' },
      { role: 'user', content: `다음 초록을 3줄로 요약해 줘.\n\n${abstract}` },
    ],
    reasoning: m.reasoning,
    max_tokens: 2000,
    response_format: { type: 'json_schema', json_schema: { name: 'summary', strict: true, schema } },
    usage: { include: true },
  };
  const t0 = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      console.log(`✖ ${m.id}  HTTP ${res.status}  ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
      continue;
    }
    const text = json.choices?.[0]?.message?.content ?? '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 아래에서 실패로 표시 */ }
    const ok = Array.isArray(parsed?.summary_3lines) && parsed.summary_3lines.length === 3;
    const u = json.usage ?? {};
    console.log(
      `${ok ? '✔' : '✖'} ${m.id}  JSON ${ok ? '통과' : '실패'}  ` +
      `입력 ${u.prompt_tokens} / 출력 ${u.completion_tokens} (추론 ${u.completion_tokens_details?.reasoning_tokens ?? 0})  ` +
      `비용 $${u.cost ?? '?'}  ${Date.now() - t0}ms`
    );
    if (!ok) console.log('   응답:', text.slice(0, 300));
  } catch (e) {
    console.log(`✖ ${m.id}  요청 실패: ${e.message}`);
  }
}
