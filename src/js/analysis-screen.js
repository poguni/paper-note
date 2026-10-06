// 논문 상세 안의 "AI 분석" 구역: 단계(초록 / 본문) 선택, 모델에 따른 예상 비용, 분석 실행과 취소, 결과 카드, 결과 저장.
// 결과는 논문이 저장되어 있으면 바로 pn_analyses에 저장하고, 저장 전이면 화면에 두었다가 논문을 저장할 때 함께 저장한다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var MODEL_PREF = 'pn_model'; // 비밀이 아닌 화면 설정이라 localStorage에 둔다
  var STAGE_LABEL = { abstract: '초록 단계', fulltext: '본문 단계' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // deps: { client: PN.createOpenRouter() 결과, keyStore, openKeyBox(), select: <select>,
  //         api: PN.createAnalysesApi() 결과(없을 수 있음), pdf: { getPrepared(paper) }, onProgress(info): 4단계 표시용(선택) }
  PN.initAnalysis = function (deps) {
    var papers = new Map(); // 논문 열쇠 → { results[], stage, active, running, error, loadedRowId, loading }
    var rows = new Map(); // 논문 열쇠 → 저장된 논문 행({ id, … }) 또는 null
    var aborts = new Map();
    var shown = { box: null, paper: null, side: null }; // 지금 화면에 있는 구역(box), 논문, 오른쪽 열(side)
    var statsDefault = false; // 통계 분석 모드의 시작값: 검색에 쓴 프리셋의 설정 (프리셋 "통계"와 "데이터분석"은 켜짐)

    function slot(key) {
      if (!papers.has(key)) papers.set(key, { results: [], translations: [], translating: null, openSections: {}, stage: 'abstract', statsMode: null, active: 0, running: false, error: null, loadedRowId: null, loading: false });
      return papers.get(key);
    }

    // 모델 선택
    PN.MODELS.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label + (m.id === PN.DEFAULT_MODEL ? ' (기본)' : '');
      deps.select.appendChild(opt);
    });
    try {
      var saved = g.localStorage.getItem(MODEL_PREF);
      if (saved && PN.getModel(saved)) deps.select.value = saved;
    } catch (e) { /* 저장소 접근 불가: 기본값 */ }
    deps.select.addEventListener('change', function () {
      try { g.localStorage.setItem(MODEL_PREF, deps.select.value); } catch (e) { /* 저장 못 해도 이번 화면에는 적용 */ }
      refresh();
    });

    function refresh() {
      if (shown.box) render(shown.box, shown.paper);
    }

    // 단계별 입력(messages). 만들 수 없으면 null: 초록 단계는 초록이, 본문 단계는 PDF에서 읽은 본문이 있어야 한다.
    function messagesFor(stage, paper, statsMode) {
      return stage === 'fulltext' ? PN.buildFulltextMessages(paper, deps.pdf.getPrepared(paper), { statsMode: statsMode }) : PN.buildAbstractMessages(paper);
    }

    function estimateFor(stage, modelId, messages, statsMode) {
      return PN.estimateAnalysis({ modelId: modelId, stage: stage, statsMode: statsMode, inputText: messages.map(function (m) { return m.content; }).join('\n') });
    }

    // 통계 분석 모드는 본문 단계에서만 뜻이 있다. 논문마다 사용자가 바꾼 값이 있으면 그 값, 없으면 프리셋의 설정
    function statsOn(p) {
      return p.stage === 'fulltext' && (p.statsMode == null ? statsDefault : p.statsMode);
    }

    // ---- 저장 ----
    async function persist(key, result) {
      var row = rows.get(key);
      if (!row || !deps.api || result.id || result.saving) return;
      result.saving = true;
      result.saveError = null;
      refresh();
      try {
        var out = await deps.api.save(row.id, result.stage, result.modelId, result.value);
        result.id = out.id;
        result.createdAt = out.created_at || result.createdAt;
      } catch (e) {
        result.saveError = PN.dbErrorMessage(e, '분석 결과 저장');
      }
      result.saving = false;
      refresh();
    }

    // 저장된 논문을 열면 그 논문의 저장된 결과를 읽어 온다 (논문마다 한 번)
    async function loadSaved(key, row) {
      var p = slot(key);
      if (!deps.api || p.loading || p.loadedRowId === row.id) return;
      p.loading = true;
      try {
        var saved = await deps.api.listForPaper(row.id);
        p.results = PN.mergeResults(p.results, PN.rowsToResults(saved));
        p.translations = PN.mergeResults(p.translations, PN.rowsToTranslations(saved));
        p.loadedRowId = row.id;
        p.loadError = null;
      } catch (e) {
        p.loadError = PN.dbErrorMessage(e, '저장된 분석 결과 불러오기');
        p.loadedRowId = row.id; // 실패해도 계속 다시 부르지 않는다
      }
      p.loading = false;
      refresh();
    }

    // ---- 분석 실행 ----
    async function run(paper) {
      var key = PN.paperKey(paper);
      var p = slot(key);
      var stage = p.stage;
      var statsMode = statsOn(p);
      var messages = messagesFor(stage, paper, statsMode);
      if (!messages) return;
      if (!deps.keyStore.has()) {
        p.error = { message: PN.openrouterErrorMessage({ code: 'no_key' }), noKey: true };
        refresh();
        deps.openKeyBox();
        return;
      }
      var modelId = deps.select.value;
      var model = PN.getModel(modelId);
      var est = estimateFor(stage, modelId, messages, statsMode);
      if (est.needsConfirm && !g.confirm(model.label + '로 ' + STAGE_LABEL[stage] + '을 분석합니다. 입력 약 ' + est.inputTokens.toLocaleString('ko-KR') + '토큰, 예상 비용 ' + PN.formatCost(est.costUsd) + '입니다. 계속할까요?')) return;

      var ac = new AbortController();
      aborts.set(key, ac);
      p.running = true;
      p.error = null;
      refresh();
      try {
        var out = await PN.runAnalysis(deps.client, { modelId: modelId, stage: stage, messages: messages, statsMode: statsMode, signal: ac.signal });
        var result = { id: null, stage: stage, modelId: modelId, modelLabel: model.label, value: out.value, createdAt: new Date().toISOString(), usage: out.usage, attempts: out.attempts };
        p.results.unshift(result);
        p.active = 0;
        p.running = false;
        aborts.delete(key);
        persist(key, result); // 논문이 저장되어 있을 때만 실제로 저장한다
      } catch (e) {
        p.running = false;
        aborts.delete(key);
        if (!(e && e.code === 'aborted')) p.error = { message: PN.analysisErrorMessage(e) }; // 취소는 오류로 보이지 않는다
      }
      refresh();
    }

    // ---- 전문 번역 (섹션 단위) ----
    var tAborts = new Map();

    // PDF에서 읽은 섹션 중 제목과 본문이 있는 것 (앞의 제목·저자 부분은 뺀다)
    function sourceSections(paper) {
      var prepared = deps.pdf.getPrepared(paper);
      return prepared ? prepared.sections.filter(function (s) { return s.title && s.text.trim(); }) : [];
    }

    function findSource(paper, title) {
      var n = PN.normalizeTitle(title);
      return sourceSections(paper).filter(function (s) { return PN.normalizeTitle(s.title) === n; })[0] || null;
    }

    // 같은 섹션을 여러 번 번역했으면 가장 최근 것
    function latestTranslation(p, title) {
      var n = PN.normalizeTitle(title);
      var best = null;
      p.translations.forEach(function (t) {
        if (PN.normalizeTitle(t.value.title) === n && (!best || t.createdAt > best.createdAt)) best = t;
      });
      return best;
    }

    function sumEstimates(modelId, sections) {
      var total = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      sections.forEach(function (s) {
        var e = PN.estimateTranslation(modelId, s.text);
        total.inputTokens += e.inputTokens;
        total.outputTokens += e.outputTokens;
        total.costUsd += e.costUsd;
      });
      return total;
    }

    // sections: [{ title, text }]를 차례로 번역한다. 끝난 섹션은 바로 남기므로 중간에 취소하거나 실패해도 앞의 번역은 유지된다.
    async function translateSections(paper, sections) {
      var key = PN.paperKey(paper);
      var p = slot(key);
      if (!sections.length || p.translating || p.running) return;
      if (!deps.keyStore.has()) {
        p.error = { message: PN.openrouterErrorMessage({ code: 'no_key' }), noKey: true };
        refresh();
        deps.openKeyBox();
        return;
      }
      var modelId = deps.select.value;
      var model = PN.getModel(modelId);
      var est = sumEstimates(modelId, sections);
      var what = sections.length === 1 ? '"' + sections[0].title + '" 섹션' : sections.length + '개 섹션';
      // 전문 번역은 비용이 커서 크기와 상관없이 항상 확인을 받는다 (PRD F15)
      if (!g.confirm(model.label + '로 ' + what + '을 전체 번역합니다.\n입력 약 ' + est.inputTokens.toLocaleString('ko-KR') + '토큰, 출력 약 ' + est.outputTokens.toLocaleString('ko-KR') + '토큰, 예상 비용 ' + PN.formatCost(est.costUsd) + '입니다. 계속할까요?')) return;

      var ac = new AbortController();
      tAborts.set(key, ac);
      p.error = null;
      p.translating = { done: 0, total: sections.length, current: sections[0].title };
      refresh();
      for (var i = 0; i < sections.length; i++) {
        p.translating.current = sections[i].title;
        refresh();
        try {
          var out = await PN.runTranslation(deps.client, { modelId: modelId, title: sections[i].title, text: sections[i].text, signal: ac.signal });
          var t = { id: null, stage: 'translation', modelId: modelId, modelLabel: model.label, value: { title: sections[i].title, ko: out.ko }, createdAt: new Date().toISOString(), usage: out.usage };
          p.translations.unshift(t);
          p.translating.done++;
          persist(key, t);
        } catch (e) {
          if (!(e && e.code === 'aborted')) {
            p.error = { message: PN.translationErrorMessage(e) + (p.translating.done ? ' (앞의 ' + p.translating.done + '개 섹션은 번역을 마쳤습니다.)' : '') };
          }
          break;
        }
      }
      p.translating = null;
      tAborts.delete(key);
      refresh();
    }

    // 섹션별 번역 카드가 쓰는 것들 (analysis-view의 renderFulltextAnalysis에 넘긴다)
    function translationHooks(paper, p) {
      var key = PN.paperKey(paper);
      var row = rows.get(key);
      var model = PN.getModel(deps.select.value);
      var pending = function () { return sourceSections(paper).filter(function (s) { return !latestTranslation(p, s.title); }); };
      return {
        busy: p.translating,
        disabled: !!p.translating || p.running,
        isOpen: function (title) { return !!p.openSections[PN.normalizeTitle(title)]; },
        setOpen: function (title, open) { p.openSections[PN.normalizeTitle(title)] = open; },
        // 번역한 섹션의 제목. PDF의 섹션 순서대로 늘어놓는다 (PDF가 없으면 번역한 순서의 반대)
        translatedTitles: function () {
          var order = sourceSections(paper).map(function (s) { return PN.normalizeTitle(s.title); });
          var rank = function (t) { var i = order.indexOf(PN.normalizeTitle(t)); return i < 0 ? order.length : i; };
          var seen = {};
          return p.translations.map(function (t) { return t.value.title; })
            .filter(function (t) { var n = PN.normalizeTitle(t); return seen[n] ? false : (seen[n] = true); })
            .map(function (t, i) { return { t: t, i: i }; })
            .sort(function (x, y) { return rank(x.t) - rank(y.t) || x.i - y.i; })
            .map(function (x) { return x.t; });
        },
        translationFor: function (title) {
          var t = latestTranslation(p, title);
          if (!t) return null;
          return { ko: t.value.ko, modelLabel: t.modelLabel, dateText: when(t.createdAt), storageText: storageText(t, !!row), saveError: t.saveError, retry: function () { persist(key, t); } };
        },
        canTranslate: function (title) { return !!findSource(paper, title); },
        costText: function (title) { var s = findSource(paper, title); return s ? PN.formatCost(PN.estimateTranslation(model.id, s.text).costUsd) : ''; },
        onTranslate: function (title) { var s = findSource(paper, title); if (s) translateSections(paper, [s]); },
        allInfo: function () {
          var todo = pending();
          return { total: sourceSections(paper).length, pending: todo.length, costText: PN.formatCost(sumEstimates(model.id, todo).costUsd) };
        },
        onTranslateAll: function () { translateSections(paper, pending()); },
        onCancel: function () { var ac = tAborts.get(key); if (ac) ac.abort(); }
      };
    }

    // ---- 그리기 ----
    function storageText(result, hasRow) {
      if (result.id) return '저장됨';
      if (result.saving) return '저장하는 중…';
      if (result.saveError) return '저장하지 못함';
      return hasRow ? '' : '논문을 저장하면 이 결과도 함께 보관됩니다';
    }

    function stageTabs(p, hasAbstract, hasFulltext, paper) {
      var tabs = el('div', 'stage-tabs');
      tabs.setAttribute('role', 'group');
      tabs.setAttribute('aria-label', '분석 단계');
      [['abstract', '초록 단계', hasAbstract], ['fulltext', hasFulltext ? '본문 단계' : '본문 단계 · PDF 필요', hasFulltext]].forEach(function (t) {
        var b = el('button', 'stage-tab', t[1]);
        b.type = 'button';
        b.disabled = !t[2] || p.running;
        b.setAttribute('aria-pressed', p.stage === t[0] ? 'true' : 'false');
        b.addEventListener('click', function () { p.stage = t[0]; p.active = 0; refresh(); });
        tabs.appendChild(b);
      });
      return tabs;
    }

    // 통계 분석 모드 체크박스 (DESIGN.md 5.3: 스위치가 아니라 글씨가 있는 체크박스)
    function statsToggle(p) {
      var label = el('label', 'stats-toggle');
      var check = el('input');
      check.type = 'checkbox';
      check.checked = statsOn(p);
      check.disabled = p.running;
      check.addEventListener('change', function () { p.statsMode = check.checked; refresh(); });
      label.appendChild(check);
      label.appendChild(document.createTextNode('통계 분석 모드'));
      return label;
    }

    // 오른쪽 열(번역, 용어, 통계, 아이디어): 내용이 있을 때만 열을 만든다
    function showSide(node) {
      var side = shown && shown.side;
      if (!side) { if (node) shown.box.appendChild(node); return; } // 오른쪽 열이 없는 화면에서는 상세 안에 이어 붙인다
      side.textContent = '';
      if (node) side.appendChild(node);
      side.hidden = !node;
      if (side.parentElement) side.parentElement.classList.toggle('has-side', !!node);
    }

    // 4단계 표시가 쓰는 정보: 지금 상세에 열린 논문의 저장 여부와 분석 결과 유무. box는 어느 화면의 상세인지 구별하는 데 쓴다.
    function progress() {
      if (!shown.box || !shown.paper) return { box: null, hasPaper: false, saved: false, analyzed: false };
      var key = PN.paperKey(shown.paper);
      return { box: shown.box, hasPaper: true, saved: !!rows.get(key), analyzed: slot(key).results.length > 0 };
    }

    function render(box, paper) {
      renderBody(box, paper);
      if (deps.onProgress) deps.onProgress(progress());
    }

    function renderBody(box, paper) {
      shown.box = box;
      shown.paper = paper;
      box.textContent = '';
      showSide(null);
      var key = PN.paperKey(paper);
      var p = slot(key);
      var row = rows.get(key);
      box.appendChild(el('h3', null, 'AI 분석'));

      if (row) loadSaved(key, row);

      var hasAbstract = !!String(paper.abstract || '').trim();
      var hasFulltext = !!deps.pdf.getPrepared(paper);
      // 고른 단계를 쓸 수 없게 되면(PDF를 바꿈 등) 쓸 수 있는 단계로 옮긴다
      if (p.stage === 'fulltext' && !hasFulltext) p.stage = 'abstract';
      var stage = p.stage;
      var staged = p.results.filter(function (r) { return r.stage === stage; });

      if (!hasAbstract && !hasFulltext && !p.results.length) {
        box.appendChild(el('p', 'detail-hint', '이 논문은 초록 정보가 없어 분석할 수 없습니다. 초록 페이지에서 확인하거나 PDF를 끌어다 놓으세요.'));
        return;
      }

      box.appendChild(stageTabs(p, hasAbstract, hasFulltext, paper));
      if (stage === 'fulltext') box.appendChild(statsToggle(p));

      var canRun = stage === 'fulltext' ? hasFulltext : hasAbstract;
      var bar = el('div', 'analysis-bar');
      if (p.running) {
        var spin = el('span', 'analysis-running', STAGE_LABEL[stage] + ' 분석하는 중입니다…');
        spin.setAttribute('role', 'status');
        bar.appendChild(spin);
        var cancel = el('button', 'btn btn-sm btn-secondary', '취소');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { var ac = aborts.get(key); if (ac) ac.abort(); });
        bar.appendChild(cancel);
      } else if (canRun) {
        var go = el('button', 'btn btn-sm btn-primary', (staged.length ? '다시 분석' : stage === 'fulltext' ? '본문 분석' : '초록 분석'));
        go.type = 'button';
        go.disabled = !!p.translating;
        go.addEventListener('click', function () { run(paper); });
        bar.appendChild(go);
        var model = PN.getModel(deps.select.value);
        var est = estimateFor(stage, model.id, messagesFor(stage, paper, statsOn(p)), statsOn(p));
        var tokenNote = stage === 'fulltext' ? ' · 입력 약 ' + est.inputTokens.toLocaleString('ko-KR') + '토큰' : '';
        bar.appendChild(el('span', 'analysis-est', model.label + ' · 예상 비용 ' + PN.formatCost(est.costUsd) + tokenNote));
      }
      box.appendChild(bar);

      if (p.error) {
        var err = el('p', 'form-error', p.error.message);
        err.setAttribute('role', 'alert');
        box.appendChild(err);
      }
      if (p.loadError) box.appendChild(el('p', 'form-error', p.loadError));
      if (p.loading && !p.results.length) box.appendChild(el('p', 'detail-hint', '저장된 분석 결과를 불러오는 중…'));

      if (!staged.length) return;
      if (p.active >= staged.length) p.active = 0;

      if (staged.length > 1) { // 같은 논문을 여러 번·여러 모델로 분석한 경우
        var pick = el('label', 'result-pick', '저장된 결과');
        var sel = el('select', 'select');
        sel.setAttribute('aria-label', '분석 결과 선택');
        staged.forEach(function (r, i) {
          var o = document.createElement('option');
          o.value = String(i);
          o.textContent = (staged.length - i) + '. ' + r.modelLabel + ' · ' + when(r.createdAt) + (r.id ? '' : ' (저장 전)'); // 같은 모델·같은 시각이어도 구분되게 번호를 붙인다
          sel.appendChild(o);
        });
        sel.value = String(p.active);
        sel.addEventListener('change', function () { p.active = Number(sel.value); refresh(); });
        pick.appendChild(sel);
        var pickRow = el('div', 'result-pickrow');
        pickRow.appendChild(pick);
        var cmp = el('button', 'btn btn-sm btn-secondary', '결과 비교');
        cmp.type = 'button';
        cmp.addEventListener('click', function () { PN.openCompare({ stage: stage, results: staged, title: paper.title, opener: cmp }); });
        pickRow.appendChild(cmp);
        box.appendChild(pickRow);
      }

      var r = staged[p.active];
      var footer = {
        modelLabel: r.modelLabel,
        costText: r.usage ? (r.usage.costUsd > 0 ? PN.formatCost(r.usage.costUsd) : '확인되지 않음') : null,
        dateText: r.usage ? null : when(r.createdAt),
        storageText: storageText(r, !!row),
        statsText: r.value.statistics_details ? '통계 상세 포함' : null,
        attempts: r.attempts
      };
      var parts = r.stage === 'fulltext' ? PN.renderFulltextAnalysis(r.value, footer, translationHooks(paper, p)) : PN.renderAbstractAnalysis(r.value, footer);
      box.appendChild(parts.main);
      showSide(parts.side);
      if (r.saveError) {
        var fail = el('p', 'form-error', r.saveError);
        fail.setAttribute('role', 'alert');
        box.appendChild(fail);
        var retry = el('button', 'btn btn-sm btn-secondary', '결과 저장 다시 시도');
        retry.type = 'button';
        retry.addEventListener('click', function () { persist(key, r); });
        box.appendChild(retry);
      }
    }

    return {
      // 상세 패널이 다시 그려질 때마다 새 구역(box)과 그 논문의 저장 행(없으면 undefined)을 넘겨 받아 채운다
      renderInto: function (box, paper, row, side) {
        rows.set(PN.paperKey(paper), row || null);
        shown.side = side || null;
        render(box, paper);
      },
      setStatsDefault: function (on) { statsDefault = !!on; refresh(); }, // 프리셋을 고르면 통계 분석 모드의 시작값이 그 프리셋의 설정으로 바뀐다
      detach: function () { // 상세가 닫혔을 때
        shown.box = null; shown.paper = null; shown.side = null;
        if (deps.onProgress) deps.onProgress(progress());
      },
      progress: progress,
      refresh: refresh, // PDF 본문이 준비되거나 바뀌었을 때 단계 선택을 다시 그린다
      // 논문을 저장했거나(row) 저장을 취소했을 때(row 없음)
      onSavedChange: function (paper, row) {
        var key = PN.paperKey(paper);
        var p = slot(key);
        rows.set(key, row || null);
        if (row) {
          p.loadedRowId = row.id; // 방금 저장된 논문이라 DB에는 아직 결과가 없다
          p.results.concat(p.translations).forEach(function (r) { persist(key, r); }); // 저장 전에 만든 결과와 번역을 함께 저장
        } else {
          p.loadedRowId = null;
          p.results.concat(p.translations).forEach(function (r) { r.id = null; r.saveError = null; }); // 논문과 함께 DB의 결과도 지워졌다
        }
        refresh();
      },
      // 키가 들어오거나 지워지면 "키 없음" 오류를 치운다
      onKeyChange: function () {
        papers.forEach(function (p) { if (p.error && p.error.noKey) p.error = null; });
        refresh();
      }
    };
  };
})(globalThis);
