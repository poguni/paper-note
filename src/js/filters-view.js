// 검색 필터와 정렬 선택지, 그리고 "적용 중인 필터 수" 같은 화면용 판단. DOM을 쓰지 않는 순수 로직이다.
// 선택지의 값은 DB(pn_presets)와 검색 모듈이 쓰는 값과 같다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  PN.FILTER_DEFAULTS = Object.freeze({ dateRange: 'all', minCitations: 0, includeUnknown: false, limit: 20 });

  PN.DATE_OPTIONS = [
    ['all', '제한 없음'], ['6m', '최근 6개월'], ['1y', '최근 1년'], ['3y', '최근 3년'], ['5y', '최근 5년'], ['10y', '최근 10년']
  ];
  PN.CITATION_OPTIONS = [[0, '제한 없음'], [10, '10 이상'], [50, '50 이상'], [100, '100 이상'], [500, '500 이상']];
  PN.LIMIT_OPTIONS = [[10, '10개'], [20, '20개'], [30, '30개'], [50, '50개'], [100, '100개']];
  PN.SORT_OPTIONS = [
    ['relevance', '관련도'], ['date_desc', '최신순'], ['date_asc', '오래된 순'], ['citations_desc', '인용수 많은 순'],
    ['citations_per_year_desc', '연평균 인용수 순'], ['author_asc', '저자 이름순'], ['title_asc', '제목순'], ['has_pdf_first', 'PDF 있는 것 먼저']
  ];

  // "인용수 미확인 포함"은 최소 인용수가 걸려 있을 때만 뜻이 있다
  PN.normalizeFilters = function (f) {
    var out = {
      dateRange: f.dateRange,
      minCitations: Number(f.minCitations) || 0,
      includeUnknown: !!f.includeUnknown,
      limit: Number(f.limit) || PN.FILTER_DEFAULTS.limit
    };
    if (out.minCitations === 0) out.includeUnknown = false;
    return out;
  };

  PN.filtersFromPreset = function (preset) {
    return PN.normalizeFilters({
      dateRange: preset.date_range, minCitations: preset.min_citations, includeUnknown: false, limit: preset.result_limit
    });
  };

  PN.filtersEqual = function (a, b) {
    a = PN.normalizeFilters(a);
    b = PN.normalizeFilters(b);
    return a.dateRange === b.dateRange && a.minCitations === b.minCitations && a.includeUnknown === b.includeUnknown && a.limit === b.limit;
  };

  // 기본값과 다른 컨트롤 수. 검색 개수도 기본(20)과 다르면 센다.
  PN.activeFilterNames = function (f) {
    f = PN.normalizeFilters(f);
    var d = PN.FILTER_DEFAULTS;
    var names = [];
    if (f.dateRange !== d.dateRange) names.push('dateRange');
    if (f.minCitations !== d.minCitations) names.push('minCitations');
    if (f.includeUnknown) names.push('includeUnknown');
    if (f.limit !== d.limit) names.push('limit');
    return names;
  };

  // 검색 조건으로 넘길 값 (PN.createSearcher().search()의 opts 일부)
  PN.filtersToSearchOpts = function (f) {
    f = PN.normalizeFilters(f);
    return { dateRange: f.dateRange, minCitations: f.minCitations, includeUnknownCitations: f.includeUnknown, limit: f.limit };
  };
})(globalThis);
