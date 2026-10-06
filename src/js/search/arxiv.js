// arXiv 검색: 검색식 만들기와 Atom 응답(XML) 해석. 브라우저와 Node 모두에서 돌도록 DOM을 쓰지 않는다.
// 만드는 논문 형식(모든 소스 공통):
//   { source, sourceId, sources[], arxivId, s2Id, doi, title, authors[], year, publishedDate,
//     abstract, pdfUrl, landingUrl, categories[], venue, citationCount, rank }
(function (g) {
  var PN = (g.PN = g.PN || {});
  var arxiv = (PN.arxiv = {});
  var MAX_QUERY = 600; // 중계 함수가 받는 길이 상한
  var CATEGORY_RE = /^[a-z-]+(\.[A-Za-z]{2}|\.\*)?$/;
  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  // 검색식에 넣어도 되는 분류 이름인가 (stat.ME, math.*, q-bio.*). 프리셋 입력 검사에서도 같은 규칙을 쓴다.
  arxiv.isCategory = function (c) { return CATEGORY_RE.test(c); };

  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (match, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (err) { return match; }
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : match;
    });
  }

  function clean(s) {
    return decode(s).replace(/\s+/g, ' ').trim();
  }

  function tag(block, name) {
    var m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>'));
    return m ? clean(m[1]) : null;
  }

  // <link .../>, <category .../> 같은 속성만 있는 태그들의 속성 모음
  function attrList(block, name) {
    var out = [];
    var re = new RegExp('<' + name + '\\s+([^>]*?)/?>', 'g');
    var m;
    while ((m = re.exec(block))) {
      var attrs = {};
      var ar = /([\w:-]+)="([^"]*)"/g;
      var a;
      while ((a = ar.exec(m[1]))) attrs[a[1]] = decode(a[2]);
      out.push(attrs);
    }
    return out;
  }

  function parseEntry(block) {
    var idUrl = tag(block, 'id') || '';
    var idMatch = idUrl.match(/\/abs\/(.+)$/);
    if (!idMatch) return null;
    var arxivId = idMatch[1].replace(/v\d+$/, ''); // 'math/0211159v1' → 'math/0211159'
    var published = tag(block, 'published');
    var pdf = attrList(block, 'link').filter(function (l) { return l.title === 'pdf'; })[0];
    var authors = [];
    var ar = /<author>([\s\S]*?)<\/author>/g;
    var a;
    while ((a = ar.exec(block))) {
      var name = tag(a[1], 'name');
      if (name) authors.push(name);
    }
    return {
      source: 'arxiv',
      sourceId: arxivId,
      sources: ['arxiv'],
      arxivId: arxivId,
      s2Id: null,
      doi: tag(block, 'arxiv:doi'),
      title: tag(block, 'title') || '',
      authors: authors,
      year: published ? Number(published.slice(0, 4)) : null,
      publishedDate: published ? published.slice(0, 10) : null,
      abstract: tag(block, 'summary'),
      pdfUrl: pdf ? pdf.href.replace(/^http:/, 'https:') : 'https://arxiv.org/pdf/' + arxivId,
      landingUrl: 'https://arxiv.org/abs/' + arxivId,
      categories: attrList(block, 'category').map(function (c) { return c.term; }).filter(Boolean),
      venue: tag(block, 'arxiv:journal_ref'),
      citationCount: null, // arXiv는 인용수를 주지 않는다 (Semantic Scholar로 보강)
      rank: null
    };
  }

  // Atom XML 문자열 → { papers, total }. 오류 응답은 SearchError로 던진다.
  arxiv.parseFeed = function (xml) {
    if (typeof xml !== 'string' || xml.indexOf('<feed') < 0) {
      throw PN.searchError('arxiv_bad_response', 'arXiv 응답을 해석하지 못했습니다.');
    }
    var entries = [];
    var re = /<entry>([\s\S]*?)<\/entry>/g;
    var m;
    while ((m = re.exec(xml))) entries.push(m[1]);

    if (entries.length && /<id>[^<]*\/api\/errors<\/id>/.test(entries[0])) {
      throw PN.searchError('arxiv_error', 'arXiv가 검색식을 받아들이지 않았습니다: ' + (tag(entries[0], 'summary') || ''));
    }
    var total = xml.match(/<opensearch:totalResults>(\d+)</);
    var papers = entries.map(parseEntry).filter(Boolean);
    return { papers: papers, total: total ? Number(total[1]) : papers.length };
  };

  // opts: { terms[], categories[], dateRange, now } → arXiv search_query 문자열
  arxiv.buildSearchQuery = function (opts) {
    var parts = [];
    var terms = opts.terms.map(function (t) { return 'all:"' + t + '"'; });
    parts.push(terms.length > 1 ? '(' + terms.join(' OR ') + ')' : terms[0]);

    var cats = (opts.categories || []).map(function (c) {
      if (!CATEGORY_RE.test(c)) throw PN.searchError('invalid_category', 'arXiv 분류 형식이 올바르지 않습니다: ' + c);
      return 'cat:' + c;
    });
    if (cats.length) parts.push(cats.length > 1 ? '(' + cats.join(' OR ') + ')' : cats[0]);

    var since = PN.sinceDate(opts.dateRange, opts.now);
    if (since) {
      parts.push('submittedDate:[' + since.replace(/-/g, '') + '0000 TO ' + PN.ymd(opts.now).replace(/-/g, '') + '2359]');
    }

    var query = parts.join(' AND ');
    if (query.length > MAX_QUERY) throw PN.searchError('query_too_long', '검색어가 너무 깁니다. 줄여서 다시 검색하세요.');
    return query;
  };
})(globalThis);
