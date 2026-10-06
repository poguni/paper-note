// 여러 소스의 결과를 하나의 목록으로: 소스별 순위를 번갈아 섞고, 같은 논문(arXiv ID 또는 DOI)은 하나로 합친다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  // [[a1, a2, ...], [b1, b2, ...]] → a1, b1, a2, b2, ... 순서로 펴고 rank(0부터)를 매긴다. 원본은 바꾸지 않는다.
  PN.interleave = function (lists) {
    var out = [];
    var longest = Math.max.apply(null, [0].concat(lists.map(function (l) { return l.length; })));
    for (var i = 0; i < longest; i++) {
      lists.forEach(function (list) {
        if (i < list.length) out.push(Object.assign({}, list[i], { rank: out.length }));
      });
    }
    return out;
  };

  function first(a, b) { return a != null ? a : b; }
  function longer(a, b) { return (b || '').length > (a || '').length ? b : a; }
  function union(a, b) { return a.concat(b.filter(function (x) { return a.indexOf(x) < 0; })); }

  // 같은 논문의 두 기록을 하나로. 앞쪽(a)의 값을 우선하되, 더 풍부한 값이 있으면 그것을 쓴다.
  function combine(a, b) {
    var arxivSide = b.sources.indexOf('arxiv') >= 0 && a.sources.indexOf('arxiv') < 0 ? b : a;
    var otherSide = arxivSide === a ? b : a;
    var counts = [a.citationCount, b.citationCount].filter(function (n) { return n != null; });
    var arxivId = first(a.arxivId, b.arxivId);
    var s2Id = first(a.s2Id, b.s2Id);
    return {
      source: arxivId ? 'arxiv' : 'semantic_scholar', // 저장 기준: arXiv ID가 있으면 arXiv
      sourceId: arxivId || s2Id,
      sources: union(a.sources, b.sources),
      arxivId: arxivId,
      s2Id: s2Id,
      doi: first(a.doi, b.doi),
      title: a.title || b.title,
      authors: b.authors.length > a.authors.length ? b.authors : a.authors,
      abstract: longer(a.abstract, b.abstract) || null,
      // 날짜는 arXiv 쪽(최초 제출일)을 우선: 기간 필터가 arXiv 제출일 기준이라 같은 기준을 유지한다
      year: first(arxivSide.year, otherSide.year),
      publishedDate: first(arxivSide.publishedDate, otherSide.publishedDate),
      pdfUrl: first(arxivSide.pdfUrl, otherSide.pdfUrl),
      landingUrl: arxivId ? 'https://arxiv.org/abs/' + arxivId : first(a.landingUrl, b.landingUrl),
      categories: union(a.categories, b.categories),
      venue: first(a.venue, b.venue),
      citationCount: counts.length ? Math.max.apply(null, counts) : null,
      rank: Math.min(a.rank, b.rank)
    };
  }

  // rank가 매겨진 논문 목록 → 중복을 합친 목록(rank 순). 원본은 바꾸지 않는다.
  // 한 논문이 arXiv ID로는 한 묶음과, DOI로는 다른 묶음과 이어지면 두 묶음도 하나로 합친다.
  PN.mergePapers = function (papers) {
    var groups = [];
    var byArxiv = new Map();
    var byDoi = new Map();

    papers.forEach(function (p) {
      var g1 = p.arxivId ? byArxiv.get(p.arxivId) : undefined;
      var g2 = p.doi ? byDoi.get(p.doi.toLowerCase()) : undefined;

      var acc = combine(p, p); // 복사본
      var old = [];
      if (g1) { acc = combine(g1, acc); old.push(g1); }
      if (g2 && g2 !== g1) { acc = combine(g2, acc); old.push(g2); }

      groups = groups.filter(function (x) { return old.indexOf(x) < 0; });
      groups.push(acc);
      [byArxiv, byDoi].forEach(function (map) {
        map.forEach(function (v, k) { if (old.indexOf(v) >= 0) map.set(k, acc); });
      });
      if (acc.arxivId) byArxiv.set(acc.arxivId, acc);
      if (acc.doi) byDoi.set(acc.doi.toLowerCase(), acc);
    });

    return groups.sort(function (a, b) { return a.rank - b.rank; });
  };
})(globalThis);
