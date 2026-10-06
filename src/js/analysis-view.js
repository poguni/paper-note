// 분석 결과 카드 (DESIGN.md 5.4, 5.5). 모델이 쓴 글도 textContent로만 넣는다.
//   초록 단계: 3줄 요약, 초록 번역, 핵심 용어
//   본문 단계: 3줄 요약, 구조화 요약, 용어 사전, 섹션별 번역, 바이브 코딩 앱 아이디어
(function (g) {
  var PN = (g.PN = g.PN || {});

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function card(title) {
    var c = el('section', 'result-card');
    if (title) c.appendChild(el('h3', null, title));
    return c;
  }

  function summaryCard(lines) {
    var sum = card('3줄 요약');
    var ol = el('ol', 'summary-list');
    lines.forEach(function (line, i) {
      var li = el('li');
      li.appendChild(el('span', 'summary-no', String(i + 1)));
      li.appendChild(el('span', null, line));
      ol.appendChild(li);
    });
    sum.appendChild(ol);
    return sum;
  }

  function glossaryCard(title, glossary) {
    var gl = card(title);
    if (!glossary.length) {
      gl.appendChild(el('p', 'detail-hint', '뽑은 용어가 없습니다.'));
      return gl;
    }
    var list = el('div', 'glossary');
    glossary.forEach(function (t) {
      var item = el('div', 'glossary-item');
      var head = el('div');
      head.appendChild(el('b', null, t.ko));
      head.appendChild(document.createTextNode(' '));
      head.appendChild(el('span', 'glossary-en', t.term));
      item.appendChild(head);
      item.appendChild(el('div', 'glossary-note', t.explanation));
      list.appendChild(item);
    });
    gl.appendChild(list);
    return gl;
  }

  function footNode(footer) {
    var parts = [footer.modelLabel];
    if (footer.costText) parts.push('실제 비용 ' + footer.costText);
    if (footer.dateText) parts.push(footer.dateText + ' 분석');
    if (footer.statsText) parts.push(footer.statsText);
    if (footer.storageText) parts.push(footer.storageText);
    if (footer.attempts > 1) parts.push('형식 오류로 한 번 다시 요청함');
    return el('p', 'result-foot', parts.join(' · '));
  }

  // 결과는 두 덩어리로 돌려준다 (시안 1의 열 배치): main은 논문 상세 안(3줄 요약 등), side는 오른쪽 열(번역, 용어, 통계, 아이디어).
  // footer: { modelLabel, costText, dateText, statsText, storageText, attempts }
  PN.renderAbstractAnalysis = function (result, footer) {
    var main = el('div', 'result');
    main.appendChild(summaryCard(result.summary_3lines));
    if (footer) main.appendChild(footNode(footer));

    var side = el('div', 'result');
    var tr = card('초록 번역');
    tr.appendChild(el('p', 'result-text', result.abstract_translation));
    side.appendChild(tr);
    side.appendChild(glossaryCard('용어 사전', result.glossary));
    return { main: main, side: side };
  };

  // ---- 본문 단계 ----
  var DIFFICULTY = { easy: '난이도 쉬움', medium: '난이도 보통', hard: '난이도 어려움' };
  var EMPTY = /언급 없음/;

  // 클립보드에 복사한다. 권한이 없거나 막힌 환경이면 false
  async function copyText(text) {
    try {
      await g.navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function ideaCard(idea) {
    var c = el('section', 'result-card idea');
    c.appendChild(el('div', 'detail-kicker', '바이브 코딩 앱 아이디어'));
    c.appendChild(el('h3', 'idea-name', idea.name));
    c.appendChild(el('p', 'result-text', idea.one_liner));
    c.appendChild(el('div', 'idea-evidence', '근거: ' + idea.evidence));
    var ul = el('ul', 'idea-features');
    idea.core_features.forEach(function (f) { ul.appendChild(el('li', null, f)); });
    c.appendChild(ul);
    var chips = el('div', 'idea-chips');
    chips.appendChild(el('span', 'chip chip-src-semantic_scholar', DIFFICULTY[idea.difficulty] || idea.difficulty)); // 금색 계열 (DESIGN 5.5)
    if (idea.single_html_possible) chips.appendChild(el('span', 'chip chip-saved', '단일 HTML 가능'));
    c.appendChild(chips);

    var box = el('div', 'idea-prompt');
    box.appendChild(el('div', 'idea-prompt-text', idea.first_prompt));
    var copy = el('button', 'btn btn-sm btn-secondary', '프롬프트 복사');
    copy.type = 'button';
    var status = el('span', 'idea-copy-status');
    status.setAttribute('role', 'status');
    copy.addEventListener('click', async function () {
      status.textContent = (await copyText(idea.first_prompt)) ? '복사했습니다.' : '복사하지 못했습니다. 글을 직접 선택해 복사하세요.';
    });
    box.appendChild(copy);
    box.appendChild(status);
    c.appendChild(box);
    return c;
  }

  // 통계 상세 (DESIGN.md 5.11): 통계 논문일 때만 카드를 그린다. 아니면 이유만 한 줄로 알린다.
  // 용어 사전과 통계 상세를 한 묶음으로. education에서는 탭 두 개로 하나씩 보이고, academic에서는 탭이 숨겨져 두 카드가 모두 보인다. (DESIGN.md 4.2)
  function tabbedCards(glossary, stats) {
    var wrap = el('div', 'side-tabs');
    wrap.dataset.tab = 'glossary';
    var list = el('div', 'side-tablist');
    var buttons = [];
    function select(id) {
      wrap.dataset.tab = id;
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tab === id ? 'true' : 'false'); });
    }
    [['glossary', '용어 사전'], ['stats', '통계 상세']].forEach(function (t) {
      var b = el('button', 'side-tab', t[1]);
      b.type = 'button';
      b.dataset.tab = t[0];
      b.addEventListener('click', function () { select(t[0]); });
      buttons.push(b);
      list.appendChild(b);
    });
    glossary.dataset.panel = 'glossary';
    stats.dataset.panel = 'stats';
    wrap.appendChild(list);
    wrap.appendChild(glossary);
    wrap.appendChild(stats);
    select('glossary');
    return wrap;
  }

  function statsCard(sd) {
    if (!sd.is_statistical) {
      var none = card('통계 상세');
      none.appendChild(el('p', 'detail-hint', '이 논문은 통계 논문이 아니라고 판단되어 통계 상세를 만들지 않았습니다.'));
      return none;
    }
    var c = card('통계 상세');
    var grid = el('div', 'tiles');
    function tile(label, value) {
      var t = el('div', 'tile');
      t.appendChild(el('div', 'tile-label', label));
      var text = (Array.isArray(value) ? value.join(', ') : String(value)).trim();
      var empty = !text || EMPTY.test(text);
      t.appendChild(el('div', empty ? 'tile-text tile-empty' : 'tile-text', text || '본문에 언급 없음'));
      grid.appendChild(t);
    }
    tile('모형', sd.model);
    tile('가정', sd.assumptions);
    tile('추정 방법', sd.estimation_method);
    tile('사용 소프트웨어', sd.software);
    tile('표본·자료', sd.sample);
    tile('적합도 지수', sd.fit_indices.map(function (f) { return f.name + ' ' + f.value; }));
    c.appendChild(grid);

    // 코드 뼈대: "AI 생성 초안" 칩은 항상 붙고 숨길 수 없다
    var head = el('div', 'code-head');
    head.appendChild(el('span', 'chip chip-src-semantic_scholar', 'AI 생성 초안 · 논문의 코드가 아닙니다'));
    var copy = el('button', 'btn btn-sm btn-secondary', '코드 복사');
    copy.type = 'button';
    var status = el('span', 'idea-copy-status');
    status.setAttribute('role', 'status');
    copy.addEventListener('click', async function () {
      status.textContent = (await copyText(sd.python_skeleton)) ? '복사했습니다.' : '복사하지 못했습니다. 코드를 직접 선택해 복사하세요.';
    });
    head.appendChild(copy);
    c.appendChild(head);
    var pre = el('pre', 'code-box');
    pre.appendChild(el('code', null, sd.python_skeleton));
    c.appendChild(pre);
    c.appendChild(status);
    return c;
  }

  // 섹션별 번역 카드의 한 항목: 요약 번역(기본)과 전체 번역(요청했을 때)
  // hooks(선택): 전체 번역 기능에 필요한 것들. analysis-screen이 만들어 준다.
  function sectionItem(item, hooks) {
    var d = el('details', 'pdf-section');
    var tr = hooks ? hooks.translationFor(item.title) : null;
    d.appendChild(el('summary', null, item.title + (tr ? ' · 전체 번역 있음' : '')));
    if (hooks) {
      d.open = hooks.isOpen(item.title); // 다시 그려져도 열어 둔 섹션은 그대로 둔다
      d.addEventListener('toggle', function () { hooks.setOpen(item.title, d.open); });
    }
    if (item.summary) {
      d.appendChild(el('div', 'tr-label', '요약 번역'));
      d.appendChild(el('p', 'result-text section-ko', item.summary));
    }
    if (!hooks) return d;

    var box = el('div', 'tr-block');
    if (tr) {
      box.appendChild(el('div', 'tr-label', '전체 번역 · ' + [tr.modelLabel, tr.dateText, tr.storageText].filter(Boolean).join(' · ')));
      box.appendChild(el('div', 'result-text translation-text', tr.ko));
      if (tr.saveError) {
        var fail = el('p', 'form-error', tr.saveError);
        fail.setAttribute('role', 'alert');
        box.appendChild(fail);
        var retry = el('button', 'btn btn-sm btn-secondary', '번역 저장 다시 시도');
        retry.type = 'button';
        retry.addEventListener('click', tr.retry);
        box.appendChild(retry);
      }
    }
    // "내용 복사": 이 칸에 보이는 번역을 복사한다. 전체 번역이 있으면 그것을, 없으면 요약 번역을. 복사할 글이 없으면 버튼도 없다.
    var copyBtn = null;
    var copyStatus = null;
    var copyTarget = tr ? tr.ko : item.summary;
    if (copyTarget) {
      copyBtn = el('button', 'btn btn-sm btn-secondary', '내용 복사');
      copyBtn.type = 'button';
      copyStatus = el('span', 'idea-copy-status');
      copyStatus.setAttribute('role', 'status');
      copyBtn.addEventListener('click', async function () {
        copyStatus.textContent = (await copyText(copyTarget)) ? '복사했습니다.' : '복사하지 못했습니다. 글을 직접 선택해 복사하세요.';
      });
    }

    var busyHere = hooks.busy && hooks.busy.current === item.title;
    if (busyHere) {
      var wait = el('p', 'analysis-running', '이 섹션을 번역하는 중입니다…');
      wait.setAttribute('role', 'status');
      box.appendChild(wait);
    } else if (hooks.canTranslate(item.title)) {
      if (copyBtn) box.appendChild(copyBtn); // 번역 버튼의 왼쪽
      var go = el('button', 'btn btn-sm btn-secondary', tr ? '다시 전체 번역' : '이 섹션 전체 번역');
      go.type = 'button';
      go.disabled = hooks.disabled;
      go.addEventListener('click', function () { hooks.onTranslate(item.title); });
      box.appendChild(go);
      box.appendChild(el('span', 'analysis-est tr-cost', '예상 비용 ' + hooks.costText(item.title)));
    } else {
      if (copyBtn) { // PDF가 없어 번역 버튼이 없을 때도 복사는 할 수 있다
        box.appendChild(copyBtn);
        box.appendChild(copyStatus);
      }
      if (!tr) box.appendChild(el('p', 'detail-hint', 'PDF를 끌어다 놓으면 이 섹션의 전체 번역을 볼 수 있습니다.'));
    }
    if (copyStatus && !copyStatus.parentNode && !busyHere) box.appendChild(copyStatus);
    d.appendChild(box);
    return d;
  }

  // 카드 아래의 "본문 전체 번역" 줄: 아직 번역하지 않은 섹션을 모두 차례로 번역한다
  function translateAllControls(hooks) {
    var info = hooks.allInfo();
    var row = el('div', 'tr-all');
    if (hooks.busy) {
      var prog = el('span', 'analysis-running', '번역하는 중입니다… ' + hooks.busy.done + '/' + hooks.busy.total + ' 섹션 (' + hooks.busy.current + ')');
      prog.setAttribute('role', 'status');
      row.appendChild(prog);
      var cancel = el('button', 'btn btn-sm btn-secondary', '취소');
      cancel.type = 'button';
      cancel.addEventListener('click', hooks.onCancel);
      row.appendChild(cancel);
      return row;
    }
    if (!info.total) return null; // PDF가 없어 번역할 원문이 없다
    if (!info.pending) {
      row.appendChild(el('span', 'detail-hint', '모든 섹션을 전체 번역했습니다.'));
      return row;
    }
    var all = el('button', 'btn btn-sm btn-secondary', info.pending === info.total ? '본문 전체 번역' : '남은 ' + info.pending + '개 섹션 전체 번역');
    all.type = 'button';
    all.disabled = hooks.disabled;
    all.addEventListener('click', hooks.onTranslateAll);
    row.appendChild(all);
    row.appendChild(el('span', 'analysis-est tr-cost', '예상 비용 ' + info.costText + ' (' + info.pending + '개 섹션)'));
    return row;
  }

  PN.renderFulltextAnalysis = function (result, footer, hooks) {
    var root = el('div', 'result');
    var side = el('div', 'result');
    root.appendChild(summaryCard(result.summary_3lines));

    var ss = card('구조화 요약');
    var grid = el('div', 'tiles');
    [['연구 목적', result.structured_summary.purpose], ['방법', result.structured_summary.method], ['결과', result.structured_summary.results], ['한계', result.structured_summary.limitations]]
      .forEach(function (pair) {
        var tile = el('div', 'tile');
        tile.appendChild(el('div', 'tile-label', pair[0]));
        tile.appendChild(el('div', EMPTY.test(pair[1]) ? 'tile-text tile-empty' : 'tile-text', pair[1]));
        grid.appendChild(tile);
      });
    ss.appendChild(grid);
    root.appendChild(ss);
    if (footer) root.appendChild(footNode(footer));

    var st = card('섹션별 번역');
    st.appendChild(el('p', 'detail-hint', '기본은 섹션마다 핵심 내용을 옮긴 요약 번역입니다. 필요한 섹션은 "이 섹션 전체 번역"으로 빠짐없이 번역할 수 있습니다.'));
    var items = result.section_translations.map(function (s) { return { title: s.title, summary: s.ko }; });
    if (hooks) { // 요약 번역에 없는 섹션을 전체 번역했다면 그 섹션도 목록에 넣는다
      var known = {};
      items.forEach(function (it) { known[PN.normalizeTitle(it.title)] = true; });
      hooks.translatedTitles().forEach(function (t) {
        if (!known[PN.normalizeTitle(t)]) { known[PN.normalizeTitle(t)] = true; items.push({ title: t, summary: null }); }
      });
    }
    items.forEach(function (it) { st.appendChild(sectionItem(it, hooks)); });
    if (hooks) {
      var all = translateAllControls(hooks);
      if (all) st.appendChild(all);
    }
    side.appendChild(st);
    if (result.statistics_details) side.appendChild(tabbedCards(glossaryCard('용어 사전', result.glossary), statsCard(result.statistics_details)));
    else side.appendChild(glossaryCard('용어 사전', result.glossary));

    if (!result.app_ideas.length) {
      var none = card('바이브 코딩 앱 아이디어');
      none.appendChild(el('p', 'detail-hint', '이 논문에서 뽑은 아이디어가 없습니다.'));
      side.appendChild(none);
    }
    result.app_ideas.forEach(function (idea) { side.appendChild(ideaCard(idea)); });
    return { main: root, side: side };
  };
})(globalThis);
