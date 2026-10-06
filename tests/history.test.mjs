import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const f of ['models', 'schema', 'cost', 'translate', 'history']) await import(`../src/js/ai/${f}.js`);
const PN = globalThis.PN;

const value = (n = '가') => ({ summary_3lines: [`${n}1`, `${n}2`, `${n}3`], abstract_translation: `${n}번역`, glossary: [{ term: 'REML', ko: '제한최대우도', explanation: '설명' }] });
const row = (id, model, createdAt, json = value(id)) => ({ id, stage: 'abstract', model, result_json: json, created_at: createdAt });

test('rowsToResults: 저장된 행을 화면용 결과로 바꾼다 (모델 이름, 시각, 검증된 값)', () => {
  const [r] = PN.rowsToResults([row('a1', 'anthropic/claude-sonnet-5.5', '2026-10-05T10:00:00Z')]);
  assert.equal(r.id, 'a1');
  assert.equal(r.modelLabel, 'Claude Sonnet 5.5');
  assert.equal(r.createdAt, '2026-10-05T10:00:00Z');
  assert.deepEqual(r.value, value('a1'));
  assert.equal(r.usage, null);
});

test('rowsToResults: 손상된 행, 옛 형식, 본문 단계 행은 건너뛰고 나머지는 살린다', () => {
  const rows = [
    row('ok', 'openai/gpt-6-luna', 't1'),
    row('bad', 'openai/gpt-6-luna', 't2', { summary_3lines: ['하나'] }),
    row('null', 'openai/gpt-6-luna', 't3', null),
    { ...row('full', 'openai/gpt-6-luna', 't4'), stage: 'fulltext' }, // 초록 단계 모양의 값이 본문 단계로 저장돼 있으면 형식이 맞지 않아 건너뛴다
  ];
  assert.deepEqual(PN.rowsToResults(rows).map((r) => r.id), ['ok']);
});

test('rowsToResults: 목록에 없는 모델 ID도 그 ID를 이름으로 보여 준다', () => {
  assert.equal(PN.rowsToResults([row('x', 'vendor/future-model', 't')])[0].modelLabel, 'vendor/future-model');
});

test('mergeResults: 같은 id는 화면에 있는 쪽을 쓰고, 새것부터 늘어놓는다', () => {
  const fresh = { id: null, modelLabel: 'fresh', createdAt: '2026-10-05T12:00:00Z' };
  const onScreen = { id: 'a1', modelLabel: '화면', createdAt: '2026-10-05T10:00:00Z' };
  const loaded = [
    { id: 'a1', modelLabel: 'DB', createdAt: '2026-10-05T10:00:00Z' },
    { id: 'a0', modelLabel: '옛것', createdAt: '2026-10-04T09:00:00Z' },
  ];
  const merged = PN.mergeResults([fresh, onScreen], loaded);
  assert.deepEqual(merged.map((r) => r.modelLabel), ['fresh', '화면', '옛것']);
});

test('mergeResults: 저장 전 결과(id 없음) 여러 개는 서로 중복으로 보지 않는다', () => {
  const a = { id: null, createdAt: '2' };
  const b = { id: null, createdAt: '1' };
  assert.equal(PN.mergeResults([a, b], [{ id: 'x', createdAt: '0' }]).length, 3);
});

// ---------------------------------------------------------------- 본문 단계 행
const fulltext = (withStats) => ({
  summary_3lines: ['a', 'b', 'c'],
  structured_summary: { purpose: 'p', method: 'm', results: 'r', limitations: '본문에 언급 없음' },
  glossary: [{ term: 'REML', ko: '제한최대우도', explanation: 'e' }],
  section_translations: [{ title: 'Introduction', ko: '서론' }],
  app_ideas: [{ name: 'n', one_liner: 'o', evidence: 'ev', core_features: ['1', '2', '3'], difficulty: 'easy', single_html_possible: true, first_prompt: 'fp' }],
  statistics_details: withStats ? { is_statistical: true, model: 'LMM', assumptions: [], estimation_method: 'REML', software: ['R'], sample: 's', fit_indices: [], python_skeleton: '# TODO' } : null,
});
const frow = (id, json) => ({ id, stage: 'fulltext', model: 'anthropic/claude-sonnet-5.5', result_json: json, created_at: 't' });

test('rowsToResults: 본문 단계 행도 읽고, 통계 상세가 저장돼 있으면 그대로 살린다', () => {
  const [plain, stats] = PN.rowsToResults([frow('f1', fulltext(false)), frow('f2', fulltext(true))]);
  assert.equal(plain.stage, 'fulltext');
  assert.equal(plain.value.statistics_details, null);
  assert.equal(stats.value.statistics_details.model, 'LMM');
});

test('rowsToResults: 손상된 본문 단계 행은 건너뛴다', () => {
  const broken = fulltext(false);
  delete broken.app_ideas;
  assert.deepEqual(PN.rowsToResults([frow('bad', broken), frow('ok', fulltext(false))]).map((r) => r.id), ['ok']);
});

// ---------------------------------------------------------------- 전문 번역 행
const trow = (id, json, over = {}) => ({ id, stage: 'translation', model: 'openai/gpt-6-luna', result_json: json, created_at: 't', ...over });

test('rowsToTranslations: 번역 행만 골라 화면용으로 바꾸고, 손상된 행은 건너뛴다', () => {
  const rows = [
    trow('t1', { title: '1 Introduction', ko: '서론 번역' }),
    trow('bad1', { title: '', ko: '번역' }),
    trow('bad2', null),
    row('a1', 'openai/gpt-6-luna', 't'),
    { ...frow('f1', fulltext(false)) },
  ];
  const out = PN.rowsToTranslations(rows);
  assert.deepEqual(out.map((t) => t.id), ['t1']);
  assert.equal(out[0].stage, 'translation');
  assert.equal(out[0].modelLabel, 'GPT-6 Luna');
  assert.deepEqual(out[0].value, { title: '1 Introduction', ko: '서론 번역' });
});

test('rowsToResults는 번역 행을 분석 결과로 읽지 않는다', () => {
  assert.deepEqual(PN.rowsToResults([trow('t1', { title: 'x', ko: 'y' })]), []);
});
