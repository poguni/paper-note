// 기간과 인용수 필터. 날짜는 모두 UTC 기준 'YYYY-MM-DD' 문자열로 비교한다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var MONTHS = { '6m': 6, '1y': 12, '3y': 36, '5y': 60, '10y': 120 };

  PN.DATE_RANGES = ['6m', '1y', '3y', '5y', '10y', 'all'];

  PN.ymd = function (date) {
    return date.toISOString().slice(0, 10);
  };

  // 기간 선택값 → 이 날짜 이후에 나온 논문만. 'all'이면 null.
  PN.sinceDate = function (range, now) {
    if (!Object.prototype.hasOwnProperty.call(MONTHS, range)) return null;
    var y = now.getUTCFullYear();
    var m = now.getUTCMonth() - MONTHS[range];
    var lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // 31일에서 6개월을 빼도 달을 넘기지 않게
    return PN.ymd(new Date(Date.UTC(y, m, Math.min(now.getUTCDate(), lastDay))));
  };

  // opts: { dateRange, minCitations, includeUnknownCitations, now }
  PN.filterPapers = function (papers, opts) {
    var since = PN.sinceDate(opts.dateRange, opts.now);
    var min = opts.minCitations || 0;
    return papers.filter(function (p) {
      if (since) {
        if (p.publishedDate) {
          if (p.publishedDate < since) return false;
        } else if (p.year != null && p.year < Number(since.slice(0, 4))) {
          return false; // 연도만 아는 논문은 연도가 기간보다 이전일 때만 뺀다
        }
      }
      if (min > 0) {
        if (p.citationCount == null) return !!opts.includeUnknownCitations;
        if (p.citationCount < min) return false;
      }
      return true;
    });
  };
})(globalThis);
