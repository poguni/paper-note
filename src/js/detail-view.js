// 논문 상세(분석 없이): 메타데이터, 초록 원문, 원문 링크, 메모. 외부에서 온 글은 textContent로만 넣는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var MAX_MEMO = 5000;
  var ARROW = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"></path></svg>';

  PN.MAX_MEMO = MAX_MEMO;

  // DOI 문자열 → 열 수 있는 주소. DOI 모양(10.…)이 아니면 null
  PN.doiUrl = function (doi) {
    var d = String(doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    return /^10\.\d{4,9}\/\S+$/.test(d) ? 'https://doi.org/' + encodeURI(d) : null;
  };

  // ['A. Kim', 'B. Lee'] · 2014 · JSS 처럼 있는 정보만 이어 붙인다
  PN.metaLine = function (paper) {
    var parts = [];
    if (paper.authors && paper.authors.length) parts.push(paper.authors.join(', '));
    if (paper.year) parts.push(String(paper.year));
    if (paper.venue) parts.push(paper.venue);
    return parts.join(' · ') || '저자 정보 없음';
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function linkButton(label, url) {
    var safe = PN.safeUrl(url);
    if (!safe) return null;
    var a = el('a', 'btn btn-sm btn-secondary btn-link');
    a.href = safe;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.appendChild(document.createTextNode(label));
    a.insertAdjacentHTML('beforeend', ARROW);
    return a;
  }

  // handlers: { onToggleSave(paper, button), onSaveMemo(text) → Promise }
  // 돌려주는 값: { node, analysisBox와 pdfBox(AI 분석·PDF 구역, 호출한 쪽이 채운다), memo: { show(text), fail(message) } } — 메모는 저장된 논문일 때만 쓰고, 내용은 나중에 채운다.
  PN.renderDetail = function (paper, saved, handlers) {
    var root = el('div', 'detail-body');

    var head = el('div', 'detail-head');
    head.appendChild(el('div', 'detail-kicker', '논문 상세'));
    head.appendChild(el('h2', 'detail-title', paper.title));
    head.appendChild(el('div', 'detail-meta', PN.metaLine(paper)));

    var chips = el('div', 'detail-chips');
    (paper.sources && paper.sources.length ? paper.sources : [paper.source]).forEach(function (s) {
      chips.appendChild(el('span', 'chip chip-src-' + s, PN.sourceLabel(s)));
    });
    if (saved) chips.appendChild(el('span', 'chip chip-saved', '저장됨'));
    chips.appendChild(el('span', 'chip chip-cite', PN.citationLabel(paper.citationCount)));
    head.appendChild(chips);

    var actions = el('div', 'detail-actions');
    var save = el('button', 'btn btn-sm ' + (saved ? 'btn-saved' : 'btn-secondary'), saved ? '저장됨 ✓' : '저장');
    save.type = 'button';
    save.setAttribute('aria-pressed', saved ? 'true' : 'false');
    save.addEventListener('click', function () { handlers.onToggleSave(paper, save); });
    actions.appendChild(save);
    [linkButton('초록 페이지', paper.landingUrl), linkButton('원문 PDF 열기', paper.pdfUrl), linkButton('DOI', PN.doiUrl(paper.doi))]
      .forEach(function (b) { if (b) actions.appendChild(b); });
    head.appendChild(actions);
    root.appendChild(head);

    var analysisBox = el('section', 'detail-section analysis');
    root.appendChild(analysisBox);

    var pdfBox = el('section', 'detail-section pdf');
    root.appendChild(pdfBox);

    var abs = el('section', 'detail-section');
    abs.appendChild(el('h3', null, '초록 (원문)'));
    abs.appendChild(el('p', 'detail-abstract', paper.abstract || '이 논문은 초록 정보가 없습니다. 초록 페이지에서 확인하세요.'));
    if (paper.categories && paper.categories.length) abs.appendChild(el('div', 'detail-cats', '분류: ' + paper.categories.join(', ')));
    root.appendChild(abs);

    var memoBox = el('section', 'detail-section');
    memoBox.appendChild(el('h3', null, '메모'));
    root.appendChild(memoBox);

    var memo = { show: function () {}, fail: function () {} };
    if (!saved) {
      memoBox.appendChild(el('p', 'detail-hint', '논문을 저장하면 메모를 남길 수 있습니다.'));
    } else {
      var status = el('p', 'detail-hint', '메모를 불러오는 중…');
      status.setAttribute('role', 'status');
      var area = el('textarea', 'memo-input');
      area.setAttribute('aria-label', '메모');
      area.maxLength = MAX_MEMO;
      area.rows = 5;
      area.hidden = true;
      var button = el('button', 'btn btn-sm btn-secondary', '메모 저장');
      button.type = 'button';
      button.hidden = true;
      button.addEventListener('click', async function () {
        button.disabled = true;
        status.textContent = '저장하는 중…';
        try {
          await handlers.onSaveMemo(area.value);
          status.textContent = '메모를 저장했습니다.';
        } catch (e) {
          status.textContent = PN.dbErrorMessage(e, '메모 저장');
        }
        button.disabled = false;
      });
      memoBox.appendChild(area);
      memoBox.appendChild(button);
      memoBox.appendChild(status);
      memo = {
        show: function (text) { area.value = text; area.hidden = false; button.hidden = false; status.textContent = ''; },
        fail: function (message) { status.textContent = message; }
      };
    }
    return { node: root, analysisBox: analysisBox, pdfBox: pdfBox, memo: memo };
  };
})(globalThis);
