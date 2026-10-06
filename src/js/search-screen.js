// 검색 화면: 프리셋 사이드바, 검색창, 결과 목록. 계정이 승인된 상태일 때만 동작한다.
//   ctx: { auth: PN.createAuth() 결과, store: PN.createStore() 결과 }
(function (g) {
  var PN = (g.PN = g.PN || {});
  var $ = function (sel) { return document.querySelector(sel); };

  PN.initSearchScreen = function (ctx) {
    var client = ctx.auth && ctx.auth.client;
    var els = {
      form: $('#search-form'), query: $('#search-query'), arxiv: $('#src-arxiv'), s2: $('#src-s2'),
      submit: $('#search-submit'), gate: $('#search-gate'), gateText: $('#search-gate-text'),
      sub: $('#results-sub'), banner: $('#results-banner'), list: $('#results-list'),
      presets: $('#preset-list'), presetsBox: $('#presets'), note: $('#results-note'), detail: $('#detail'),
      date: $('#f-date'), min: $('#f-min'), unknown: $('#f-unknown'), limit: $('#f-limit'),
      reset: $('#filter-reset'), toggle: $('#filter-toggle'), fields: $('#filter-fields'),
      count: $('#filter-count'), dirty: $('#filter-dirty'), sort: $('#sort-select')
    };

    function fillSelect(select, options) {
      options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = String(o[0]);
        opt.textContent = o[1];
        select.appendChild(opt);
      });
    }
    fillSelect(els.date, PN.DATE_OPTIONS);
    fillSelect(els.min, PN.CITATION_OPTIONS);
    fillSelect(els.limit, PN.LIMIT_OPTIONS);
    fillSelect(els.sort, PN.SORT_OPTIONS);

    var relay = client && PN.createRelay({
      url: PN.config.supabaseUrl + '/functions/v1/pn-search-proxy',
      apikey: PN.config.supabaseKey,
      fetch: function (url, init) { return globalThis.fetch(url, init); },
      getToken: async function () {
        var s = await client.auth.getSession();
        return s.data && s.data.session ? s.data.session.access_token : null;
      }
    });
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var searcher = relay && PN.createSearcher({
      relay: relay,
      queues: { arxiv: PN.createQueue(3000, Date.now, sleep), s2: PN.createQueue(1500, Date.now, sleep) },
      cache: PN.createCache({ ttlMs: 30 * 60 * 1000, max: 50 })
    });
    var papersApi = client && PN.createPapersApi(client);
    var presetsApi = client && PN.createPresetsApi(client);

    var presets = [];
    var activePreset = null; // 검색창에서 바꾼 검색어·소스 말고는 이 프리셋의 조건을 쓴다
    var saved = PN.createSavedIndex([]);
    var filters = Object.assign({}, PN.FILTER_DEFAULTS); // 필터 줄에 보이는 값
    var applied = Object.assign({}, PN.FILTER_DEFAULTS); // 마지막 검색에 쓴 값. 둘이 다르면 "필터 변경됨"
    var sort = 'relevance';
    var selected = null; // 상세에 열려 있는 논문 (검색 결과의 공통 형식)
    var last = null; // 마지막 검색 결과 { papers, warnings, meta, filters, presetName }
    var requestNo = 0; // 늦게 도착한 이전 검색 결과가 새 결과를 덮지 않게 한다
    var accountKey = '';
    var detailPanel = PN.createDetailPanel({
      container: els.detail, side: $('#side'), papersApi: papersApi, analysis: ctx.analysis, pdf: ctx.pdf,
      getRow: function (paper) { return saved.find(paper); },
      onToggleSave: function (paper, button) { return toggleSave(paper, button); }
    });

    // ---- 로그인 상태에 따른 화면 ----
    var GATE_TEXT = {
      'signed-out': '로그인하면 검색할 수 있습니다. 설정에서 로그인하세요.',
      pending: '관리자가 가입을 승인하면 검색할 수 있습니다.',
      rejected: '가입이 승인되지 않아 검색할 수 없습니다. 관리자에게 문의하세요.',
      error: '계정 정보를 불러오지 못해 검색할 수 없습니다. 설정에서 다시 시도하세요.'
    };

    function setEnabled(on) {
      [els.query, els.arxiv, els.s2, els.submit, els.date, els.min, els.limit, els.reset, els.sort].forEach(function (c) { c.disabled = !on; });
      renderFilters();
    }

    // ---- 필터 줄 ----
    var FILTER_CONTROL = { dateRange: els.date, minCitations: els.min, includeUnknown: els.unknown, limit: els.limit };

    function renderFilters() {
      var f = PN.normalizeFilters(filters);
      els.date.value = f.dateRange;
      els.min.value = String(f.minCitations);
      els.limit.value = String(f.limit);
      els.unknown.checked = f.includeUnknown;
      els.unknown.disabled = els.query.disabled || f.minCitations === 0; // 최소 인용수가 없으면 뜻이 없다
      els.sort.value = sort;
      var active = PN.activeFilterNames(f);
      Object.keys(FILTER_CONTROL).forEach(function (name) {
        FILTER_CONTROL[name].dataset.active = active.indexOf(name) >= 0 ? 'true' : 'false';
      });
      els.count.textContent = active.length ? '필터 ' + active.length + '개 적용 중' : '';
      els.reset.hidden = !active.length;
      els.dirty.hidden = PN.filtersEqual(f, applied);
    }

    function readFilters() {
      filters = PN.normalizeFilters({
        dateRange: els.date.value, minCitations: els.min.value, includeUnknown: els.unknown.checked, limit: els.limit.value
      });
      renderFilters();
    }
    [els.date, els.min, els.unknown, els.limit].forEach(function (c) { c.addEventListener('change', readFilters); });

    els.reset.addEventListener('click', function () {
      filters = Object.assign({}, PN.FILTER_DEFAULTS);
      renderFilters();
    });

    els.toggle.addEventListener('click', function () {
      var open = els.toggle.getAttribute('aria-expanded') !== 'true';
      els.toggle.setAttribute('aria-expanded', String(open));
      els.toggle.textContent = open ? '필터 ▾' : '필터 ▸';
      els.fields.hidden = !open;
    });

    // 정렬은 이미 가져온 결과를 다시 늘어놓을 뿐이라 검색을 다시 하지 않는다
    els.sort.addEventListener('change', function () {
      sort = els.sort.value;
      renderResults();
    });

    function onAuth(auth) {
      var key = auth.state === 'approved' ? 'approved:' + auth.email : auth.state;
      if (key === accountKey) return;
      accountKey = key;
      requestNo++; // 진행 중이던 검색 결과는 버린다
      last = null;
      activePreset = null;
      presets = [];
      saved = PN.createSavedIndex([]);
      filters = Object.assign({}, PN.FILTER_DEFAULTS);
      applied = Object.assign({}, PN.FILTER_DEFAULTS);
      sort = 'relevance';
      selected = null;
      renderFilters();
      renderDetail();

      var ok = auth.state === 'approved';
      setEnabled(ok);
      els.gate.hidden = ok || auth.state === 'loading';
      els.gateText.textContent = GATE_TEXT[auth.state] || '';
      els.presetsBox.hidden = !ok;
      renderPresets();
      renderResults();
      if (ok) loadAccountData();
    }

    async function loadAccountData() {
      var no = accountKey;
      els.presets.textContent = '';
      els.presets.appendChild(note('프리셋을 불러오는 중…'));
      try {
        var rows = await Promise.all([presetsApi.list(), papersApi.listSaved()]);
        if (no !== accountKey) return;
        presets = rows[0];
        saved = PN.createSavedIndex(rows[1]);
        renderPresets();
        renderResults();
      } catch (e) {
        if (no !== accountKey) return;
        els.presets.textContent = '';
        els.presets.appendChild(note(PN.dbErrorMessage(e, '프리셋 불러오기')));
      }
    }

    function note(text) {
      var p = document.createElement('p');
      p.className = 'side-note';
      p.textContent = text;
      return p;
    }

    // ---- 프리셋 ----
    function renderPresets() {
      els.presets.textContent = '';
      if (!presets.length) { els.presets.appendChild(note('프리셋이 없습니다. 아래 버튼으로 만들 수 있습니다.')); return; }
      presets.forEach(function (p, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'preset';
        if (activePreset && activePreset.id === p.id) b.setAttribute('aria-current', 'true');
        var n = document.createElement('span');
        n.className = 'preset-no';
        n.textContent = String(i + 1); // 화면 순서대로 1부터 (DB의 position 값은 정렬에만 쓴다)
        b.appendChild(n);
        b.appendChild(document.createTextNode(p.name));
        b.addEventListener('click', function () { choosePreset(p); });
        els.presets.appendChild(b);
      });
    }

    function choosePreset(p) {
      activePreset = p;
      els.query.value = p.query;
      els.arxiv.checked = p.sources.indexOf('arxiv') >= 0;
      els.s2.checked = p.sources.indexOf('semantic_scholar') >= 0;
      filters = PN.filtersFromPreset(p);
      sort = p.sort;
      ctx.analysis.setStatsDefault(p.stats_mode);
      if (g.location.hash !== '#search') g.location.hash = '#search'; // 서재 화면에서 눌러도 검색 화면으로 간다
      renderFilters();
      renderPresets();
      renderResults(); // 정렬 선택이 바뀐 만큼 지금 보이는 결과의 순서도 맞춘다. 검색은 검색 버튼을 눌렀을 때만 한다.
      els.query.focus();
    }

    // ---- 검색 ----
    function currentOpts() {
      var sources = [];
      if (els.arxiv.checked) sources.push('arxiv');
      if (els.s2.checked) sources.push('semantic_scholar');
      // 분류는 프리셋에서, 검색어·소스·필터·정렬은 화면에 보이는 값에서 가져온다
      return Object.assign({ categories: activePreset ? activePreset.arxiv_categories.slice() : [] },
        PN.filtersToSearchOpts(filters), { query: els.query.value, sources: sources, sort: sort });
    }

    async function runSearch() {
      if (!searcher || accountKey.indexOf('approved') !== 0) return;
      var opts = currentOpts();
      if (!opts.sources.length) { clearHead(); showStatus('error', '검색할 소스를 하나 이상 고르세요.'); return; }
      var no = ++requestNo;
      selected = null;
      renderDetail();
      var used = PN.normalizeFilters(filters);
      applied = used;
      renderFilters();
      els.submit.disabled = true;
      clearHead();
      showStatus('loading', '검색하는 중입니다. arXiv는 호출 간격 때문에 몇 초 걸릴 수 있습니다.');
      var result, failure;
      try { result = await searcher.search(opts); } catch (e) { failure = e; }
      if (no !== requestNo) return; // 그 사이 계정이 바뀌었거나 새 검색이 시작됨
      els.submit.disabled = false;
      if (failure) {
        last = null;
        var msg = failure.name === 'RelayError' ? PN.relayErrorMessage(failure) : failure.name === 'SearchError' ? failure.message : '검색하지 못했습니다. 잠시 뒤에 다시 시도하세요.';
        // 검색어 문제는 다시 눌러도 같으므로 재시도 버튼은 서버·네트워크 오류에만 둔다
        showStatus('error', msg, failure.name === 'RelayError' ? { label: '다시 시도', onClick: runSearch } : null);
        return;
      }
      last = { papers: result.papers, warnings: result.warnings, meta: result.meta, limit: opts.limit, filters: used, presetName: activePreset && activePreset.name, presetId: activePreset ? activePreset.id : null };
      renderResults();
    }

    // 결과 열에 상태 상자 하나를 보여 준다. action: { label, onClick } (선택)
    function showStatus(kind, text, action) {
      els.list.textContent = '';
      els.list.setAttribute('aria-busy', kind === 'loading' ? 'true' : 'false');
      var box = document.createElement('div');
      box.className = 'state state-' + kind;
      box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      var p = document.createElement('p');
      p.textContent = text;
      box.appendChild(p);
      if (action) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary';
        b.textContent = action.label;
        b.addEventListener('click', action.onClick);
        box.appendChild(b);
      }
      els.list.appendChild(box);
    }

    // 검색 상태(로딩, 오류)를 보여 줄 때는 이전 결과의 머리글 정보도 치운다
    function clearHead() {
      els.banner.hidden = true;
      els.note.hidden = true;
      els.sub.textContent = '';
    }

    // 필터를 모두 기본값으로 돌리고 다시 검색한다 (0건 안내의 "필터 해제")
    function clearFiltersAndSearch() {
      filters = Object.assign({}, PN.FILTER_DEFAULTS);
      renderFilters();
      runSearch();
    }

    function renderResults() {
      clearHead();
      els.list.textContent = '';
      els.list.setAttribute('aria-busy', 'false');
      if (!last) {
        if (accountKey.indexOf('approved') === 0) showStatus('idle', '프리셋을 고르거나 영문 검색어를 입력한 뒤 검색 버튼을 누르세요.');
        return;
      }
      els.sub.textContent = (last.presetName ? last.presetName + ' · ' : '') + last.papers.length + '건';
      if (last.warnings.length) {
        els.banner.hidden = false;
        els.banner.textContent = '일부 소스의 결과를 가져오지 못했습니다. ' + last.warnings.map(function (w) { return w.message; }).join(' ');
      }
      if (!last.papers.length) {
        if (PN.activeFilterNames(last.filters).length) {
          showStatus('empty', '조건에 맞는 논문이 없습니다. 기간이나 최소 인용수 조건을 완화해 보세요.', { label: '필터 해제', onClick: clearFiltersAndSearch });
        } else {
          showStatus('empty', '검색 결과가 없습니다. 검색어를 바꿔 보세요.');
        }
        return;
      }
      if (last.meta.shortfall) {
        els.note.hidden = false;
        els.note.textContent = '조건에 맞는 논문이 ' + last.papers.length + '건입니다. (요청한 개수: ' + last.limit + '개)';
      }
      PN.sortPapers(last.papers.slice(), sort, new Date()).forEach(function (paper) {
        var isOpen = !!selected && PN.paperKey(selected) === PN.paperKey(paper);
        els.list.appendChild(PN.renderCard(paper, saved.has(paper), isOpen, { onToggleSave: toggleSave, onSelect: select }));
      });
    }

    // ---- 저장 / 저장 취소 ----
    async function toggleSave(paper, button) {
      var row = saved.find(paper);
      if (row && !g.confirm('저장을 취소하면 이 논문의 분석 결과와 메모도 함께 지워집니다. 저장을 취소할까요?')) return;
      button.disabled = true;
      try {
        if (row) {
          await papersApi.remove(row.id);
          saved.removeById(row.id);
        } else {
          saved.add((await papersApi.save(paper, last && last.presetId)).row); // 이 논문이 나온 검색의 프리셋을 함께 기록
        }
        ctx.analysis.onSavedChange(paper, saved.find(paper));
      } catch (e) {
        button.disabled = false;
        els.banner.hidden = false;
        els.banner.textContent = PN.dbErrorMessage(e, row ? '저장 취소' : '저장');
        return;
      }
      renderResults();
      renderDetail();
    }

    // ---- 논문 상세 ----
    function select(paper) {
      selected = paper;
      renderResults();
      renderDetail();
    }

    function renderDetail() {
      detailPanel.render(selected);
    }

    // 설정에서 프리셋을 추가·수정·삭제·정렬한 뒤 사이드바 목록을 다시 읽는다. 지워진 프리셋을 쓰던 중이면 선택을 푼다.
    async function reloadPresets() {
      if (accountKey.indexOf('approved') !== 0) return;
      try {
        presets = await presetsApi.list();
      } catch (e) { return; }
      if (activePreset) activePreset = presets.filter(function (p) { return p.id === activePreset.id; })[0] || null;
      renderPresets();
    }

    // 서재에서 저장을 취소했거나 다른 화면에서 저장이 바뀐 뒤 검색 화면으로 돌아오면 저장 표시를 다시 읽는다
    async function refreshSaved() {
      if (accountKey.indexOf('approved') !== 0) return;
      try {
        saved = PN.createSavedIndex(await papersApi.listSaved());
      } catch (e) { return; } // 읽지 못하면 기존 표시를 유지한다
      renderResults();
      renderDetail();
    }

    els.form.addEventListener('submit', function (e) { e.preventDefault(); runSearch(); });
    setEnabled(false);
    return { onAuth: onAuth, refreshSaved: refreshSaved, reloadPresets: reloadPresets };
  };
})(globalThis);
