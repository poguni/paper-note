import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/search/filter.js');
await import('../src/js/search/sort.js');
await import('../src/js/filters-view.js');
const PN = globalThis.PN;

test('선택지의 값이 검색 모듈·DB가 쓰는 값과 같다', () => {
  assert.deepEqual(PN.DATE_OPTIONS.map((o) => o[0]).sort(), [...PN.DATE_RANGES].sort());
  assert.deepEqual(PN.SORT_OPTIONS.map((o) => o[0]), PN.SORT_KEYS);
  assert.deepEqual(PN.LIMIT_OPTIONS.map((o) => o[0]), [10, 20, 30, 50, 100]);
  assert.deepEqual(PN.CITATION_OPTIONS.map((o) => o[0]), [0, 10, 50, 100, 500]);
});

test('기본값이면 적용 중인 필터가 없다', () => {
  assert.deepEqual(PN.activeFilterNames(PN.FILTER_DEFAULTS), []);
});

test('기본값과 다른 컨트롤만 센다', () => {
  assert.deepEqual(PN.activeFilterNames({ dateRange: '3y', minCitations: 10, includeUnknown: true, limit: 50 }),
    ['dateRange', 'minCitations', 'includeUnknown', 'limit']);
  assert.deepEqual(PN.activeFilterNames({ ...PN.FILTER_DEFAULTS, limit: 10 }), ['limit']);
});

test('최소 인용수가 없으면 "미확인 포함"은 꺼진 것으로 본다', () => {
  assert.equal(PN.normalizeFilters({ ...PN.FILTER_DEFAULTS, includeUnknown: true }).includeUnknown, false);
  assert.deepEqual(PN.activeFilterNames({ ...PN.FILTER_DEFAULTS, includeUnknown: true }), []);
});

test('filtersEqual: 같은 내용이면 같고, 하나라도 다르면 다르다', () => {
  const a = { dateRange: '1y', minCitations: 50, includeUnknown: false, limit: 20 };
  assert.ok(PN.filtersEqual(a, { ...a }));
  assert.ok(!PN.filtersEqual(a, { ...a, limit: 30 }));
  assert.ok(!PN.filtersEqual(a, { ...a, includeUnknown: true }));
  // 최소 인용수 0에서의 includeUnknown 차이는 무시
  assert.ok(PN.filtersEqual(PN.FILTER_DEFAULTS, { ...PN.FILTER_DEFAULTS, includeUnknown: true }));
});

test('filtersFromPreset과 filtersToSearchOpts', () => {
  const f = PN.filtersFromPreset({ date_range: '5y', min_citations: 100, result_limit: 30 });
  assert.deepEqual(f, { dateRange: '5y', minCitations: 100, includeUnknown: false, limit: 30 });
  assert.deepEqual(PN.filtersToSearchOpts({ ...f, includeUnknown: true }),
    { dateRange: '5y', minCitations: 100, includeUnknownCitations: true, limit: 30 });
});
