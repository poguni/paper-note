// 검색 결과 카드의 표시 규칙. 문자열 가공은 순수 함수로 두고(Node에서 시험), DOM을 만드는 함수는 document를 함수 안에서만 쓴다.
// 논문 제목·저자 등은 외부에서 온 글이므로 innerHTML을 쓰지 않고 textContent로만 넣는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var MAX_AUTHORS = 4;

  // ['Douglas M. Bates', 'Martin Mächler'] → 'Bates, Mächler'. 4명을 넘으면 '외 N명'.
  PN.authorsShort = function (authors) {
    var list = (authors || []).filter(Boolean);
    if (!list.length) return '저자 정보 없음';
    var shown = list.slice(0, MAX_AUTHORS).map(function (name) {
      var parts = String(name).trim().split(/\s+/);
      return parts[parts.length - 1];
    }).join(', ');
    return list.length > MAX_AUTHORS ? shown + ' 외 ' + (list.length - MAX_AUTHORS) + '명' : shown;
  };

  PN.citationLabel = function (count) {
    return count == null ? '인용수 미확인' : '인용 ' + Number(count).toLocaleString('ko-KR');
  };

  var SOURCE_LABEL = { arxiv: 'arXiv', semantic_scholar: 'Semantic Scholar' };
  // 검색 결과에서 논문 하나를 가리키는 열쇠
  PN.paperKey = function (paper) { return paper.source + ':' + paper.sourceId; };

  PN.sourceLabel = function (source) { return SOURCE_LABEL[source] || String(source); };

  // 링크로 열어도 되는 주소만 통과시킨다 (javascript: 같은 주소가 href에 들어가는 것을 막는다)
  PN.safeUrl = function (url) {
    return /^https?:\/\//i.test(String(url || '')) ? String(url) : null;
  };

  // ---- DOM ----
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var ARROW = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"></path></svg>';

  // paper: 검색 결과의 공통 형식, saved: 저장 여부, selected: 상세에 열려 있는지
  // handlers: { onToggleSave(paper, button), onSelect(paper) }
  // extras(선택): { badges: ['분석 초록·본문'], note: '메모 첫 줄' } — 서재에서 분석 여부와 메모를 보여 줄 때
  PN.renderCard = function (paper, saved, selected, handlers, extras) {
    var card = el('article', 'card');
    card.dataset.key = PN.paperKey(paper);
    if (selected) card.setAttribute('aria-current', 'true');
    // 카드의 빈 곳을 눌러도 선택된다. 버튼과 링크는 제 기능만 한다.
    card.addEventListener('click', function (e) {
      if (!e.target.closest('a, button')) handlers.onSelect(paper);
    });

    var main = el('div', 'card-main');
    var title = el('h3', 'card-title');
    var open = el('button', 'card-open', paper.title); // 키보드로도 고를 수 있게 제목을 버튼으로 둔다
    open.type = 'button';
    open.addEventListener('click', function () { handlers.onSelect(paper); });
    title.appendChild(open);
    main.appendChild(title);

    var meta = el('div', 'card-meta');
    var by = PN.authorsShort(paper.authors) + (paper.year ? ' · ' + paper.year : '');
    meta.appendChild(el('span', 'card-by', by));
    (paper.sources && paper.sources.length ? paper.sources : [paper.source]).forEach(function (s) {
      meta.appendChild(el('span', 'chip chip-src-' + s, PN.sourceLabel(s)));
    });
    meta.appendChild(el('span', 'chip chip-cite', PN.citationLabel(paper.citationCount)));
    ((extras && extras.badges) || []).forEach(function (b) { meta.appendChild(el('span', 'chip chip-pdf', b)); });
    main.appendChild(meta);
    if (extras && extras.note) main.appendChild(el('div', 'card-note', extras.note));
    card.appendChild(main);

    var actions = el('div', 'card-actions');
    var save = el('button', 'btn btn-sm ' + (saved ? 'btn-saved' : 'btn-secondary'), saved ? '저장됨 ✓' : '저장');
    save.type = 'button';
    save.setAttribute('aria-pressed', saved ? 'true' : 'false');
    save.addEventListener('click', function () { handlers.onToggleSave(paper, save); });
    actions.appendChild(save);

    var pdf = PN.safeUrl(paper.pdfUrl);
    if (pdf) {
      var a = el('a', 'btn btn-sm btn-secondary btn-link');
      a.href = pdf;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(document.createTextNode('원문 PDF 열기'));
      a.insertAdjacentHTML('beforeend', ARROW); // 고정된 아이콘 문자열이라 외부 입력이 섞이지 않는다
      actions.appendChild(a);
    }
    card.appendChild(actions);
    return card;
  };
})(globalThis);
