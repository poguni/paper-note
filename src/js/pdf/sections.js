// 추출한 쪽 텍스트를 AI에 보낼 본문으로 다듬는다: 머리말·쪽 번호 제거, 참고문헌 제거, 제목 기준 섹션 분할(실패하면 쪽 단위).
// 입력은 PN.extractPdfText의 pages([{ n, lines: [{ text, size }] }])이고, DOM이나 pdf.js를 쓰지 않는다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  var NUM = '(?:\\d{1,2}(?:\\.\\d{1,2}){0,2}\\.?|[IVX]{1,5}\\.|[A-Z]\\.)?\\s*'; // 1, 2.1, 2.1.3, II., A.
  var SAFE = 'abstract|introduction|conclusions?|concluding remarks|discussion|results|results and discussion|methods?|methodology|materials and methods|methods and materials|data and methods|related work|related literature|literature review|limitations|future work|acknowledge?ments?|declarations?|preliminaries';
  var AMBIGUOUS = 'data|models?|summary|background|notation|funding|experiments?|simulations?|simulation study|theory|analysis'; // 본문 줄과 헷갈리기 쉬워 번호가 있거나 글자가 클 때만
  var SAFE_RE = new RegExp('^' + NUM + '(?:' + SAFE + ')\\s*[:.]?$', 'i');
  var AMBIG_RE = new RegExp('^(' + NUM + ')(?:' + AMBIGUOUS + ')\\s*[:.]?$', 'i');
  var REFS_RE = new RegExp('^' + NUM + '(?:references|bibliography|literature cited|works cited|reference list)\\s*:?$', 'i');
  // 참고문헌 뒤에 이어지는 별도 섹션(참고문헌 제거를 여기서 멈춘다)
  var AFTER_REFS_RE = /^(?:[A-Z]\.?\s*)?(?:appendix|appendices|supplementary|supporting information|online supplement|acknowledge?ments?)\b.{0,50}$/i;
  var NUMBERED_RE = /^(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+(\S.{1,70})$/;

  var MAX_HEADING_CHARS = 70;

  function medianSize(lines) {
    // 글자 수로 가중해서 본문 글자 크기를 구한다 (제목은 짧아서 영향이 적다)
    var counts = {};
    var total = 0;
    lines.forEach(function (l) {
      if (!l.size) return;
      var k = Math.round(l.size * 2) / 2;
      counts[k] = (counts[k] || 0) + l.text.length;
      total += l.text.length;
    });
    if (!total) return 0;
    var keys = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    var acc = 0;
    for (var i = 0; i < keys.length; i++) {
      acc += counts[keys[i]];
      if (acc >= total / 2) return keys[i];
    }
    return 0;
  }

  // 쪽마다 반복되는 머리글·바닥글과 쪽 번호를 뺀다
  function stripRunning(pages) {
    var norm = function (t) { return t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase(); };
    var seen = {};
    pages.forEach(function (p) {
      var uniq = {};
      p.lines.forEach(function (l) { if (l.text.length <= 80) uniq[norm(l.text)] = true; });
      Object.keys(uniq).forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });
    });
    var threshold = Math.max(3, Math.ceil(pages.length * 0.4));
    var removed = 0;
    var kept = pages.map(function (p) {
      var lines = p.lines.filter(function (l, i) {
        var repeated = l.text.length <= 80 && seen[norm(l.text)] >= threshold;
        var pageNo = /^\d{1,4}$/.test(l.text) && (i === 0 || i === p.lines.length - 1);
        if (repeated || pageNo) { removed++; return false; }
        return true;
      });
      return { n: p.n, lines: lines };
    });
    return { pages: kept, removed: removed };
  }

  function isHeading(line, median) {
    var t = line.text;
    if (t.length > MAX_HEADING_CHARS) return false;
    var bigger = median > 0 && line.size >= median * 1.04;
    if (SAFE_RE.test(t)) return true;
    var m = AMBIG_RE.exec(t);
    if (m) return m[1].trim() !== '' || bigger;
    var n = NUMBERED_RE.exec(t);
    if (n) {
      var rest = n[2];
      if (!/^[A-Z]/.test(rest) || /[.,;:]$/.test(rest) || rest.split(/\s+/).length > 10) return false;
      if (median > 0) return bigger || (rest.split(/\s+/).length <= 6 && line.size >= median);
      return true;
    }
    return false;
  }

  function cleanTitle(t) {
    return t.replace(/\s*[:.]$/, '').trim();
  }

  function joinLines(lines) {
    return lines.map(function (l) { return l.text; }).join('\n').replace(/([A-Za-z])-\n(?=[a-z])/g, '$1-'); // 줄 끝에서 잘린 단어를 이어 붙인다
  }

  // pages → {
  //   sections: [{ title, text, startPage }], mode: 'headings' | 'pages',
  //   referencesFound, referencesRemoved: { lines, chars }, runningRemoved,
  //   text (AI에 보낼 전체 본문), charCount, tokens
  // }
  PN.prepareFullText = function (pages) {
    var stripped = stripRunning(pages);
    var flat = [];
    stripped.pages.forEach(function (p) { p.lines.forEach(function (l) { flat.push({ text: l.text, size: l.size || 0, page: p.n }); }); });

    // 1) 참고문헌 제거: 제목 줄부터 다음 별도 섹션(부록 등) 앞까지
    var refStart = -1;
    for (var i = flat.length - 1; i >= 0; i--) { // 본문 속 같은 단어보다 뒤쪽의 제목을 쓰기 위해 끝에서부터 찾는다
      if (REFS_RE.test(flat[i].text)) { refStart = i; break; }
    }
    var body = flat;
    var removed = { lines: 0, chars: 0 };
    if (refStart >= 0) {
      var refEnd = flat.length;
      for (var j = refStart + 1; j < flat.length; j++) {
        if (AFTER_REFS_RE.test(flat[j].text)) { refEnd = j; break; }
      }
      var gone = flat.slice(refStart, refEnd);
      removed = { lines: gone.length, chars: gone.reduce(function (s, l) { return s + l.text.length; }, 0) };
      body = flat.slice(0, refStart).concat(flat.slice(refEnd));
    }

    // 2) 섹션 나누기
    var median = medianSize(body);
    var sections = [];
    var current = null;
    body.forEach(function (l) {
      if (isHeading(l, median)) {
        current = { title: cleanTitle(l.text), lines: [], startPage: l.page };
        sections.push(current);
      } else {
        if (!current) { current = { title: '', lines: [], startPage: l.page }; sections.push(current); } // 첫 제목 앞의 제목·저자 부분
        current.lines.push(l);
      }
    });
    var named = sections.filter(function (s) { return s.title; }).length;
    var mode = 'headings';
    if (named < 3) { // 제목을 거의 못 찾았으면 쪽 단위로
      mode = 'pages';
      var byPage = {};
      sections = [];
      body.forEach(function (l) {
        if (!byPage[l.page]) { byPage[l.page] = { title: l.page + '쪽', lines: [], startPage: l.page }; sections.push(byPage[l.page]); }
        byPage[l.page].lines.push(l);
      });
    }

    var out = sections
      .map(function (s) { return { title: s.title, text: joinLines(s.lines), startPage: s.startPage }; })
      .filter(function (s) { return s.text.trim() || s.title; });
    var text = out.map(function (s) { return (s.title ? '## ' + s.title + '\n' : '') + s.text; }).join('\n\n');
    return {
      sections: out,
      mode: mode,
      referencesFound: refStart >= 0,
      referencesRemoved: removed,
      runningRemoved: stripped.removed,
      text: text,
      charCount: text.length,
      tokens: PN.estimateTokens ? PN.estimateTokens(text) : Math.ceil(text.length / 4)
    };
  };
})(globalThis);
