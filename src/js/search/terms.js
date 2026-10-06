// 검색어 해석과 검색 오류. 여러 소스가 함께 쓰는 공통 부분.
(function (g) {
  var PN = (g.PN = g.PN || {});

  PN.MAX_TERMS = 3;

  PN.searchError = function (code, message) {
    var e = new Error(message);
    e.name = 'SearchError';
    e.code = code;
    return e;
  };

  // "structural equation modeling, multilevel model" → ['structural equation modeling', 'multilevel model']
  // 쉼표, 세미콜론, 줄바꿈으로 나누고, 영문 검색어에 쓰이는 글자만 남긴다. 최대 PN.MAX_TERMS개.
  PN.parseTerms = function (query) {
    var seen = {};
    var terms = [];
    String(query || '').split(/[,;\n]/).forEach(function (raw) {
      var term = raw.replace(/[^A-Za-z0-9 _.+-]/g, ' ').replace(/\s+/g, ' ').trim();
      var key = term.toLowerCase();
      if (term && !seen[key] && terms.length < PN.MAX_TERMS) {
        seen[key] = true;
        terms.push(term);
      }
    });
    return terms;
  };
})(globalThis);
