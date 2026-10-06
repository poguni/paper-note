// 검색 결과 정렬 8가지. 이미 가져온 목록을 브라우저에서 다시 늘어놓을 뿐 추가 호출은 없다.
// 키 이름은 pn_presets.sort 의 허용 값과 같다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var YEAR_MS = 365.25 * 24 * 3600 * 1000;

  PN.SORT_KEYS = ['relevance', 'date_desc', 'date_asc', 'citations_desc', 'citations_per_year_desc', 'author_asc', 'title_asc', 'has_pdf_first'];

  function dateOf(p) {
    if (p.publishedDate) return p.publishedDate;
    return p.year != null ? p.year + '-07-01' : null; // 연도만 아는 논문은 그 해의 중간으로
  }

  // 발음 부호를 떼고 소문자로: 'Mächler' → 'machler'
  function plain(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function lastName(name) {
    var tokens = plain(name).replace(/[^a-z0-9 -]/g, ' ').split(/\s+/).filter(Boolean);
    return tokens.length ? tokens[tokens.length - 1] : '';
  }

  function citationsPerYear(p, now) {
    var d = dateOf(p);
    if (p.citationCount == null || !d) return null;
    var years = Math.max((now.getTime() - new Date(d + (d.length === 10 ? 'T00:00:00Z' : '')).getTime()) / YEAR_MS, 1);
    return p.citationCount / years;
  }

  // 값이 없는 논문은 방향과 관계없이 항상 맨 뒤로
  function byValue(get, dir) {
    return function (a, b) {
      var x = get(a), y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x < y ? -dir : x > y ? dir : 0;
    };
  }

  PN.sortPapers = function (papers, key, now) {
    var cmp;
    switch (key) {
      case 'date_desc': cmp = byValue(dateOf, -1); break;
      case 'date_asc': cmp = byValue(dateOf, 1); break;
      case 'citations_desc': cmp = byValue(function (p) { return p.citationCount; }, -1); break;
      case 'citations_per_year_desc': cmp = byValue(function (p) { return citationsPerYear(p, now); }, -1); break;
      case 'author_asc':
        cmp = function (a, b) {
          var r = byValue(function (p) { return p.authors.length ? lastName(p.authors[0]) : null; }, 1)(a, b);
          return r || byValue(function (p) { return p.authors.length ? plain(p.authors[0]) : null; }, 1)(a, b);
        };
        break;
      case 'title_asc': cmp = byValue(function (p) { return plain(p.title).replace(/^[^a-z0-9]+/, ''); }, 1); break;
      case 'has_pdf_first': cmp = byValue(function (p) { return p.pdfUrl ? 0 : 1; }, 1); break;
      default: cmp = function () { return 0; }; // relevance: 아래 rank 순서 그대로
    }
    // 같은 값은 관련도(rank) 순서를 유지한다
    return papers.slice().sort(function (a, b) { return cmp(a, b) || a.rank - b.rank; });
  };
})(globalThis);
