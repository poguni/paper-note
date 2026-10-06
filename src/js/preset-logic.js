// 프리셋 관리의 순수 로직: 입력 검사, 새 프리셋 기본값, 순서 바꾸기. DOM과 DB를 쓰지 않는다. (PRD F11)
// 값의 범위는 DB(pn_presets)의 check 제약과 같다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  PN.MAX_PRESETS = 12; // 사이드바에 다 보이는 개수
  var NAME_MAX = 20;
  var SOURCES = ['arxiv', 'semantic_scholar'];

  // 새 프리셋의 시작값 (PRD: 필터는 제한 없음, 개수 20, 정렬은 관련도)
  PN.presetDefaults = function () {
    return { name: '', query: '', sources: SOURCES.slice(), arxivCategories: '', sort: 'relevance', dateRange: 'all', minCitations: 0, resultLimit: 20, statsMode: false };
  };

  // 폼에서 쓰는 모양(camelCase) ↔ DB 행(snake_case)
  PN.presetToForm = function (row) {
    return {
      name: row.name, query: row.query, sources: row.sources.slice(), arxivCategories: row.arxiv_categories.join(', '),
      sort: row.sort, dateRange: row.date_range, minCitations: row.min_citations, resultLimit: row.result_limit, statsMode: !!row.stats_mode
    };
  };

  // "stat.ME, stat.AP" → ['stat.ME', 'stat.AP'] (공백·쉼표·세미콜론으로 나누고 중복 제거)
  PN.parseCategories = function (text) {
    var seen = {};
    return String(text || '').split(/[\s,;]+/).filter(Boolean).filter(function (c) { return seen[c] ? false : (seen[c] = true); });
  };

  // 폼 값 → { ok: true, value: DB 행의 일부 } 또는 { ok: false, errors: { 칸 이름: 문장 } }
  PN.validatePreset = function (form) {
    var errors = {};
    var name = String(form.name || '').trim();
    if (!name) errors.name = '이름을 입력하세요.';
    else if (name.length > NAME_MAX) errors.name = '이름은 ' + NAME_MAX + '자 이하로 쓰세요.';

    var terms = PN.parseTerms(form.query);
    if (!terms.length) errors.query = '영문 검색어를 입력하세요. (쉼표로 최대 ' + PN.MAX_TERMS + '개)';

    var sources = SOURCES.filter(function (s) { return (form.sources || []).indexOf(s) >= 0; });
    if (!sources.length) errors.sources = '소스를 하나 이상 고르세요.';

    var categories = PN.parseCategories(form.arxivCategories);
    var bad = categories.filter(function (c) { return !PN.arxiv.isCategory(c); });
    if (bad.length) errors.arxivCategories = 'arXiv 분류 형식이 올바르지 않습니다: ' + bad.join(', ') + ' (예: stat.ME)';
    else if (categories.length > 10) errors.arxivCategories = '분류는 10개까지 쓸 수 있습니다.';

    if (PN.SORT_KEYS.indexOf(form.sort) < 0) errors.sort = '정렬 기준이 올바르지 않습니다.';
    if (PN.DATE_RANGES.indexOf(form.dateRange) < 0) errors.dateRange = '기간이 올바르지 않습니다.';
    var min = Number(form.minCitations);
    if (!PN.CITATION_OPTIONS.some(function (o) { return o[0] === min; })) errors.minCitations = '최소 인용수가 올바르지 않습니다.';
    var limit = Number(form.resultLimit);
    if (!PN.LIMIT_OPTIONS.some(function (o) { return o[0] === limit; })) errors.resultLimit = '검색 개수가 올바르지 않습니다.';

    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return {
      ok: true,
      value: {
        name: name,
        // 앱이 실제로 쓰는 정리된 검색어를 저장한다 (한글·특수문자는 검색에서 어차피 무시된다)
        query: terms.join(', '),
        sources: sources,
        arxiv_categories: categories,
        sort: form.sort,
        date_range: form.dateRange,
        min_citations: min,
        result_limit: limit,
        stats_mode: !!form.statsMode
      }
    };
  };

  // 목록에서 index번째 항목을 delta(-1 위, +1 아래)만큼 옮긴 새 배열. 범위를 벗어나면 그대로.
  PN.moveItem = function (list, index, delta) {
    var to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list.slice();
    var copy = list.slice();
    var item = copy.splice(index, 1)[0];
    copy.splice(to, 0, item);
    return copy;
  };

  // 순서가 정해진 프리셋 목록 → 번호(position)를 1부터 다시 매기고, 바뀐 것만 [{ id, position }]으로
  PN.positionChanges = function (ordered) {
    var out = [];
    ordered.forEach(function (p, i) {
      if (p.position !== i + 1) out.push({ id: p.id, position: i + 1 });
    });
    return out;
  };

  // 목록의 한 줄 요약: "multilevel model · arXiv + Semantic Scholar · 최신순"
  var SOURCE_LABEL = { arxiv: 'arXiv', semantic_scholar: 'Semantic Scholar' };
  PN.presetSummary = function (p) {
    var sortLabel = '';
    PN.SORT_OPTIONS.forEach(function (o) { if (o[0] === p.sort) sortLabel = o[1]; });
    return p.query + ' · ' + p.sources.map(function (s) { return SOURCE_LABEL[s] || s; }).join(' + ') + ' · ' + sortLabel;
  };
})(globalThis);
