// 내 서재의 순수 로직: 저장된 행 → 검색 결과와 같은 논문 형식, 찾기·거르기, 정렬. (DOM과 DB를 쓰지 않는다)
(function (g) {
  var PN = (g.PN = g.PN || {});

  PN.LIBRARY_SORT_OPTIONS = [['manual', '내 순서'], ['saved_desc', '저장일순']].concat(PN.SORT_OPTIONS ? PN.SORT_OPTIONS.filter(function (o) { return o[0] !== 'relevance'; }) : []);

  // pn_papers 행 → 검색 결과와 같은 모양. 이렇게 하면 카드, 상세, 분석 화면을 그대로 쓰고, 논문 열쇠(PN.paperKey)도 같아서
  // 검색 화면에서 만든 분석 결과와 같은 논문으로 이어진다. rank는 저장일 최신순에서의 자리(관련도 대신 동률 정렬에 쓴다).
  PN.rowToPaper = function (row, rank) {
    return {
      source: row.source,
      sourceId: row.source_id,
      sources: [row.source],
      arxivId: row.source === 'arxiv' ? row.source_id : null,
      s2Id: row.source === 'semantic_scholar' ? row.source_id : null,
      doi: row.doi || null,
      title: row.title,
      authors: row.authors || [],
      year: row.year == null ? null : row.year,
      publishedDate: row.published_date || null,
      abstract: row.abstract || null,
      pdfUrl: row.pdf_url || null,
      landingUrl: row.landing_url || null,
      categories: row.categories || [],
      venue: null,
      citationCount: row.citation_count == null ? null : row.citation_count,
      rank: rank,
      savedAt: row.saved_at,
      rowId: row.id,
      memo: row.memo || '',
      presetId: row.preset_id || null,
      pinned: !!row.pinned,
      sortIndex: row.sort_index == null ? null : row.sort_index
    };
  };

  PN.rowsToPapers = function (rows) {
    var sorted = rows.slice().sort(function (a, b) { return a.saved_at < b.saved_at ? 1 : a.saved_at > b.saved_at ? -1 : 0; });
    return sorted.map(function (r, i) { return PN.rowToPaper(r, i); });
  };

  // 제목, 저자, 분류, 메모에서 찾는다. 공백으로 나눈 낱말이 모두 들어 있어야 한다(대소문자 무시).
  // opts: { text, analysis: 'all'|'with'|'without', presetId: ''|'none'|<id> }, analysisIndex: Map(논문 행 id → { abstract, fulltext })
  PN.filterLibrary = function (papers, opts, analysisIndex) {
    var words = String(opts.text || '').toLowerCase().split(/\s+/).filter(Boolean);
    return papers.filter(function (p) {
      if (words.length) {
        var hay = [p.title, (p.authors || []).join(' '), (p.categories || []).join(' '), p.memo].join(' ').toLowerCase();
        if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return false;
      }
      var analyzed = !!analysisIndex && analysisIndex.has(p.rowId);
      if (opts.analysis === 'with' && !analyzed) return false;
      if (opts.analysis === 'without' && analyzed) return false;
      if (opts.presetId === 'none' && p.presetId) return false;
      if (opts.presetId && opts.presetId !== 'none' && p.presetId !== opts.presetId) return false;
      return true;
    });
  };

  function bySavedDesc(a, b) { return a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0; }

  // "내 순서": 직접 정한 자리 번호순. 아직 번호가 없는 논문(새로 저장한 것)은 맨 앞에 두고 새것부터 놓는다.
  function byManual(a, b) {
    if (a.sortIndex == null && b.sortIndex == null) return bySavedDesc(a, b);
    if (a.sortIndex == null) return -1;
    if (b.sortIndex == null) return 1;
    return a.sortIndex - b.sortIndex || bySavedDesc(a, b);
  }

  // 서재 정렬: 내 순서, 저장일순(새것부터), 검색과 같은 기준. 어느 기준이든 "맨 위에 고정"한 논문이 먼저 온다.
  PN.sortLibrary = function (papers, key, now) {
    var sorted = key === 'manual' ? papers.slice().sort(byManual)
      : key === 'saved_desc' ? papers.slice().sort(bySavedDesc)
        : PN.sortPapers(papers.slice(), key, now);
    return sorted.filter(function (p) { return p.pinned; }).concat(sorted.filter(function (p) { return !p.pinned; }));
  };

  // 카드 한 장을 다른 카드 자리로 옮긴다. ordered: "내 순서"로 정렬된 전체 목록(고정한 것이 앞).
  // 고정한 카드와 고정하지 않은 카드는 서로의 구역을 넘나들 수 없다. 옮길 수 없으면 null,
  // 옮겼으면 { order: 새 목록, changes: [{ id, sort_index }] } — 자리 번호가 달라진 논문만 담고, 번호는 0부터 차례로 다시 매긴다.
  PN.moveInLibrary = function (ordered, fromId, toId) {
    var from = ordered.findIndex(function (p) { return p.rowId === fromId; });
    var to = ordered.findIndex(function (p) { return p.rowId === toId; });
    if (from < 0 || to < 0 || from === to || ordered[from].pinned !== ordered[to].pinned) return null;
    var order = ordered.slice();
    order.splice(to, 0, order.splice(from, 1)[0]);
    var changes = [];
    order.forEach(function (p, i) { if (p.sortIndex !== i) changes.push({ id: p.rowId, sort_index: i }); });
    return { order: order, changes: changes };
  };

  // 분석 목록(pn_analyses의 paper_id, stage 행들) → Map(논문 행 id → { abstract: 개수, fulltext: 개수 })
  PN.indexAnalyses = function (rows) {
    var map = new Map();
    (rows || []).forEach(function (r) {
      var entry = map.get(r.paper_id) || { abstract: 0, fulltext: 0 };
      if (r.stage === 'abstract' || r.stage === 'fulltext') entry[r.stage]++;
      map.set(r.paper_id, entry);
    });
    return map;
  };

  // 카드에 붙일 "분석 있음" 문구
  PN.analysisBadge = function (entry) {
    if (!entry) return null;
    var parts = [];
    if (entry.abstract) parts.push('초록');
    if (entry.fulltext) parts.push('본문');
    return parts.length ? '분석 ' + parts.join('·') : null;
  };
})(globalThis);
