// Semantic Scholar: 요청 파라미터 만들기와 응답 해석 (검색, 인용수 일괄 조회).
(function (g) {
  var PN = (g.PN = g.PN || {});
  var s2 = (PN.s2 = {});
  // 중계 함수가 받는 ID 형식과 같은 규칙 (requests.ts)
  var ID_RE = /^(ARXIV:(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Za-z]{2})?\/\d{7})(v\d+)?|DOI:10\.\S{1,150}|[0-9a-f]{40})$/i;

  // 검색어 하나와 쪽 번호 → 중계 함수의 s2_search 파라미터
  // opts: { limit, dateRange, minCitations, now }  (limit이 한 쪽의 크기)
  s2.buildSearchParams = function (term, opts, page) {
    var params = { query: term, limit: opts.limit, offset: page * opts.limit };
    var since = PN.sinceDate(opts.dateRange, opts.now);
    if (since) params.year = since.slice(0, 4) + '-'; // Semantic Scholar는 연 단위만 지원. 정확한 날짜는 가져온 뒤 다시 거른다.
    if (opts.minCitations > 0) params.minCitationCount = opts.minCitations;
    return params;
  };

  // 다음 쪽을 요청할 수 있는가 (offset + limit ≤ 1000)
  s2.canFetchPage = function (limit, page) {
    return page * limit + limit <= 1000;
  };

  function normalizeArxivId(id) {
    return typeof id === 'string' && id ? id.replace(/v\d+$/, '') : null;
  }

  function parsePaper(item) {
    if (!item || !item.paperId || !item.title) return null;
    var ext = item.externalIds || {};
    var arxivId = normalizeArxivId(ext.ArXiv);
    var doi = ext.DOI || null;
    var date = /^\d{4}-\d{2}-\d{2}$/.test(item.publicationDate || '') ? item.publicationDate : null;
    return {
      source: 'semantic_scholar',
      sourceId: item.paperId,
      sources: ['semantic_scholar'],
      arxivId: arxivId,
      s2Id: item.paperId,
      doi: doi,
      title: String(item.title).replace(/\s+/g, ' ').trim(),
      authors: (item.authors || []).map(function (a) { return a && a.name; }).filter(Boolean),
      year: typeof item.year === 'number' ? item.year : (date ? Number(date.slice(0, 4)) : null),
      publishedDate: date,
      abstract: item.abstract ? String(item.abstract).replace(/\s+/g, ' ').trim() : null,
      pdfUrl: (item.openAccessPdf && item.openAccessPdf.url) || (arxivId ? 'https://arxiv.org/pdf/' + arxivId : null),
      landingUrl: item.url || (doi ? 'https://doi.org/' + doi : null),
      categories: [],
      venue: item.venue || null,
      citationCount: typeof item.citationCount === 'number' ? item.citationCount : null,
      rank: null
    };
  }

  // s2_search 응답(JSON) → { papers, total }
  s2.parseSearch = function (json) {
    if (!json || !Array.isArray(json.data)) {
      // 결과가 없을 때 data가 빠진 응답을 줄 수 있다
      if (json && typeof json.total === 'number' && json.total === 0) return { papers: [], total: 0 };
      throw PN.searchError('s2_bad_response', 'Semantic Scholar 응답을 해석하지 못했습니다.');
    }
    var papers = json.data.map(parsePaper).filter(Boolean);
    return { papers: papers, total: typeof json.total === 'number' ? json.total : papers.length };
  };

  // 인용수를 조회할 때 쓰는 ID. 알 수 없거나 형식이 맞지 않으면 null.
  s2.lookupId = function (paper) {
    var id = paper.arxivId ? 'ARXIV:' + paper.arxivId : paper.doi ? 'DOI:' + paper.doi : null;
    return id && ID_RE.test(id) ? id : null;
  };

  // s2_batch 응답(요청한 ids와 같은 순서의 배열, 못 찾은 항목은 null) → Map(id → 인용수)
  s2.parseBatch = function (json, ids) {
    if (!Array.isArray(json)) throw PN.searchError('s2_bad_response', 'Semantic Scholar 응답을 해석하지 못했습니다.');
    var counts = new Map();
    ids.forEach(function (id, i) {
      var item = json[i];
      if (item && typeof item.citationCount === 'number') counts.set(id, item.citationCount);
    });
    return counts;
  };
})(globalThis);
