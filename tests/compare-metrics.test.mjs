import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectStrings, extractNumbers, unsupportedNumbers, sectionTitles, sectionCoverage, koreanRatio, countMatches, measure } from './manual/compare-metrics.mjs';

test('extractNumbers: 소수점이 있거나 두 자리 이상인 수만, 쉼표는 없앤다', () => {
  assert.deepEqual(extractNumbers('n = 1,250, p = 0.05, 3개, 2 groups, 95% CI, 0.95'), ['1250', '0.05', '95', '0.95']);
  assert.deepEqual(extractNumbers('항목 1, 2, 3'), []);
});

test('unsupportedNumbers: 입력에 없는 수치만 돌려준다 (중복 제거, 쉼표 무시)', () => {
  const source = 'We sampled 1,250 students; CFI = 0.95, RMSEA = 0.04.';
  const value = { summary: ['표본은 1250명이다', 'CFI 0.95, RMSEA 0.04'], extra: '효과크기 0.31이고 또 0.31' };
  assert.deepEqual(unsupportedNumbers(value, source), ['0.31']);
});

test('unsupportedNumbers: 코드 뼈대(python_skeleton)의 수치는 검사에서 뺀다', () => {
  const value = { statistics_details: { model: 'x', python_skeleton: 'seed = 12345\nalpha = 0.001' }, summary: ['표본 200'] };
  assert.deepEqual(unsupportedNumbers(value, 'sample 200'), []);
});

test('collectStrings: 중첩된 모든 문자열을 모은다', () => {
  assert.deepEqual(collectStrings({ a: 'x', b: ['y', { c: 'z' }], d: 3, e: null }).sort(), ['x', 'y', 'z']);
});

test('sectionTitles와 sectionCoverage: 입력 섹션 중 번역에 나온 비율, 빠진 제목, 대소문자 무시', () => {
  const source = '앞부분\n\n## Abstract\ntext\n\n## 1 Introduction\ntext\n\n## 2 Methods\ntext';
  assert.deepEqual(sectionTitles(source), ['Abstract', '1 Introduction', '2 Methods']);
  const cov = sectionCoverage(source, [{ title: 'abstract', ko: 'a' }, { title: '2  Methods', ko: 'b' }, { title: '엉뚱한 제목', ko: 'c' }]);
  assert.deepEqual(cov, { total: 3, covered: 2, missing: ['1 Introduction'] });
  assert.deepEqual(sectionCoverage('제목 없는 본문', []), { total: 0, covered: 0, missing: [] });
});

test('koreanRatio: 한글 / (한글 + 영문)', () => {
  assert.equal(koreanRatio(['가나다라', 'ab']).toFixed(3), (4 / 6).toFixed(3));
  assert.equal(koreanRatio(['123 !!']), 0);
  assert.equal(koreanRatio([]), 0);
});

test('countMatches: "언급 없음" 개수', () => {
  assert.equal(countMatches(['본문에 언급 없음', '결과는 초록에 언급 없음', '있음'], /언급 없음/g), 2);
});

test('measure: 본문 단계 결과의 지표를 한 번에 낸다', () => {
  const source = '## Abstract\nWe used 200 students and 0.95.\n\n## Methods\nx';
  const value = {
    summary_3lines: ['학생 200명', '방법', '결과 0.95'],
    structured_summary: { purpose: '목적', method: '방법', results: '본문에 언급 없음', limitations: '효과 0.7' },
    glossary: [{ term: 'REML', ko: '제한최대우도', explanation: '설명' }],
    section_translations: [{ title: 'Abstract', ko: '초록' }],
    app_ideas: [],
  };
  const m = measure(value, source);
  assert.deepEqual(m.unsupportedNumbers, ['0.7']);
  assert.deepEqual(m.sectionCoverage, { total: 2, covered: 1, missing: ['Methods'] });
  assert.equal(m.noMentionCount, 1);
  assert.equal(m.glossaryCount, 1);
  assert.equal(m.appIdeaCount, 0);
  assert.ok(m.koreanRatio > 0.5);
});

test('measure: 초록 단계 결과(섹션 없음)도 오류 없이 지표를 낸다', () => {
  const m = measure({ summary_3lines: ['a', 'b', 'c'], abstract_translation: '번역', glossary: [] }, 'abstract text');
  assert.equal(m.sectionCoverage, null);
  assert.equal(m.appIdeaCount, null);
});
