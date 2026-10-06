import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/ai/models.js');
await import('../src/js/ai/cost.js');
await import('../src/js/ai/compare.js');
const PN = globalThis.PN;

const res = (modelId, over = {}) => ({ id: 'x', stage: 'abstract', modelId, modelLabel: modelId, createdAt: '2026-10-01T00:00:00Z', usage: null, attempts: 1, value: abstractValue(), ...over });
function abstractValue(over = {}) {
  return {
    summary_3lines: ['하나', '둘', '셋'],
    abstract_translation: '번역',
    glossary: [{ term: 'REML', ko: '제한 최대우도', explanation: 'a' }, { term: 'Random Effect', ko: '임의효과', explanation: 'b' }],
    ...over
  };
}
function fulltextValue(over = {}) {
  return {
    ...abstractValue(),
    structured_summary: { purpose: 'P', method: 'M', results: 'R', limitations: 'L' },
    section_translations: [{ title: 'Introduction', ko: '가' }, { title: 'Methods', ko: '나' }],
    statistics_details: null,
    app_ideas: [{ name: '앱 하나' }, { name: '앱 둘' }],
    ...over
  };
}

test('defaultComparePair: 결과가 2건 미만이면 null', () => {
  assert.equal(PN.defaultComparePair([]), null);
  assert.equal(PN.defaultComparePair([res('a')]), null);
  assert.equal(PN.defaultComparePair(undefined), null);
});

test('defaultComparePair: 가장 새 결과와, 다른 모델이 만든 가장 새 결과', () => {
  assert.deepEqual(PN.defaultComparePair([res('a'), res('a'), res('b'), res('c')]), [0, 2]);
  assert.deepEqual(PN.defaultComparePair([res('a'), res('b')]), [0, 1]);
});

test('defaultComparePair: 모두 같은 모델이면 그다음 결과', () => {
  assert.deepEqual(PN.defaultComparePair([res('a'), res('a'), res('a')]), [0, 1]);
});

test('compareMeta: 이번에 만든 결과는 비용을, 저장된 결과는 기록 없음을 보인다', () => {
  const fresh = PN.compareMeta(res('a', { id: null, usage: { costUsd: 0.0123 }, modelLabel: 'Claude Sonnet 5.5' }));
  assert.equal(fresh.model, 'Claude Sonnet 5.5');
  assert.equal(fresh.cost, PN.formatCost(0.0123));
  assert.equal(fresh.saved, false);
  const stored = PN.compareMeta(res('a'));
  assert.match(stored.cost, /기록 없음/);
  assert.equal(stored.saved, true);
  assert.equal(PN.compareMeta(res('a', { usage: { costUsd: 0 } })).cost, '확인되지 않음'); // 비용을 못 읽은 경우
});

test('termOverlap: 영어 용어를 대소문자 구분 없이 비교해 공통, 한쪽에만 있는 개수를 센다', () => {
  const a = [{ term: 'REML' }, { term: 'Random Effect' }, { term: 'AIC' }];
  const b = [{ term: 'reml' }, { term: 'random effect ' }, { term: 'BIC' }, { term: 'ICC' }];
  assert.deepEqual(PN.termOverlap(a, b), { both: 2, onlyA: 1, onlyB: 2 });
  assert.deepEqual(PN.termOverlap([], []), { both: 0, onlyA: 0, onlyB: 0 });
});

test('compareRows(abstract): 요약, 번역, 용어, 용어 겹침', () => {
  const a = res('a');
  const b = res('b', { value: abstractValue({ abstract_translation: '다른 번역', glossary: [{ term: 'reml', ko: '제한 최대우도', explanation: '' }] }) });
  const rows = PN.compareRows('abstract', a, b);
  assert.deepEqual(rows.map((r) => r.label), ['3줄 요약', '초록 번역', '용어 사전', '용어 겹침']);
  assert.deepEqual(rows[0].a, ['하나', '둘', '셋']);
  assert.equal(rows[1].a, '번역');
  assert.equal(rows[1].b, '다른 번역');
  assert.deepEqual(rows[2].a, ['제한 최대우도 (REML)', '임의효과 (Random Effect)']);
  assert.equal(rows[3].kind, 'note');
  assert.match(rows[3].a, /모두 뽑은 용어 1개 · 왼쪽에만 1개 · 오른쪽에만 0개/);
  assert.equal(rows[3].b, null);
});

test('compareRows(fulltext): 구조화 요약 4항목, 섹션, 통계 상세, 앱 아이디어까지', () => {
  const a = res('a', { stage: 'fulltext', value: fulltextValue({ statistics_details: { is_statistical: true, model: 'LMM', estimation_method: 'REML', software: ['R', 'lme4'] } }) });
  const b = res('b', { stage: 'fulltext', value: fulltextValue({ statistics_details: { is_statistical: false } }) });
  const rows = PN.compareRows('fulltext', a, b);
  assert.deepEqual(rows.map((r) => r.label), ['3줄 요약', '연구 목적', '방법', '결과', '한계', '섹션별 번역', '용어 사전', '용어 겹침', '통계 상세', '앱 아이디어']);
  const stats = rows.find((r) => r.label === '통계 상세');
  assert.equal(stats.a, '모형: LMM · 추정: REML · 소프트웨어: R, lme4');
  assert.match(stats.b, /통계 논문이 아니라고/);
  assert.deepEqual(rows.find((r) => r.label === '섹션별 번역').a, ['Introduction', 'Methods']);
  assert.deepEqual(rows.find((r) => r.label === '앱 아이디어').b, ['앱 하나', '앱 둘']);
});

test('compareRows(fulltext): 통계 상세가 없으면 만들지 않았다고 알린다', () => {
  const a = res('a', { stage: 'fulltext', value: fulltextValue() });
  const rows = PN.compareRows('fulltext', a, a);
  assert.match(rows.find((r) => r.label === '통계 상세').a, /만들지 않음/);
});

test('compareRows: 입력 결과를 바꾸지 않는다', () => {
  const a = res('a');
  const b = res('b');
  const before = JSON.stringify([a, b]);
  PN.compareRows('abstract', a, b);
  assert.equal(JSON.stringify([a, b]), before);
});
