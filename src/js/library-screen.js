// 내 서재 화면: 저장한 논문 목록, 찾기, 분석 여부 거르기, 정렬, 상세(분석 결과와 메모 포함)를 다시 연다.
//   ctx: { auth, analysis, pdf, onUnsaved?: 서재에서 저장을 취소했을 때 알림 }
// 화면에 들어올 때마다 목록을 새로 읽어, 검색 화면에서 저장한 논문이 바로 보이게 한다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var $ = function (sel) { return document.querySelector(sel); };

  PN.initLibraryScreen = function (ctx) {
    var client = ctx.auth && ctx.auth.client;
    var els = {
      query: $('#lib-query'), analysis: $('#lib-analysis'), preset: $('#lib-preset'), sort: $('#lib-sort'), list: $('#lib-list'), sub: $('#lib-sub'),
      banner: $('#lib-banner'), hint: $('#lib-hint'), gate: $('#lib-gate'), gateText: $('#lib-gate-text'), detail: $('#lib-detail'), form: $('#lib-form')
    };
    var papersApi = client && PN.createPapersApi(client);
    var analysesApi = client && PN.createAnalysesApi(client);
    var presetsApi = client && PN.createPresetsApi(client);
    var presetNames = new Map(); // 프리셋 id → 이름 (카드 표시와 필터 선택지)

    PN.LIBRARY_SORT_OPTIONS.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      els.sort.appendChild(opt);
    });

    var items = []; // 저장한 논문 전체 (검색 결과와 같은 모양)
    var index = new Map(); // 논문 행 id → { abstract, fulltext } 분석 개수
    var selected = null;
    var status = 'idle'; // idle | loading | ready | error
    var loadNo = 0;
    var approved = false;
    var accountKey = '';
    var dragId = null; // 지금 끌고 있는 카드의 논문 행 id
    var orderQueue = Promise.resolve(); // 순서 저장을 한 줄로 세워 서로 덮어쓰지 않게 한다

    var detailPanel = PN.createDetailPanel({
      container: els.detail, side: $('#lib-side'), papersApi: papersApi, analysis: ctx.analysis, pdf: ctx.pdf,
      getRow: function (paper) { return paper.rowId ? { id: paper.rowId } : undefined; },
      onToggleSave: function (paper, button) { return unsave(paper, button); }
    });

    function setEnabled(on) {
      [els.query, els.analysis, els.preset, els.sort].forEach(function (c) { c.disabled = !on; });
    }

    // 프리셋 필터 선택지: 전체 / 프리셋 이름들 / 프리셋 없음. 고른 값이 아직 있으면 유지한다.
    function fillPresetSelect(presets) {
      var keep = els.preset.value;
      els.preset.textContent = '';
      [['', '전체']].concat(presets.map(function (p) { return [p.id, p.name]; })).concat([['none', '프리셋 없음']]).forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        els.preset.appendChild(opt);
      });
      els.preset.value = Array.prototype.some.call(els.preset.options, function (o) { return o.value === keep; }) ? keep : '';
    }

    // ---- 읽기 ----
    async function load() {
      var no = ++loadNo;
      status = 'loading';
      render();
      try {
        var both = await Promise.all([papersApi.listAll(), analysesApi.listIndex(), presetsApi.list().catch(function () { return []; })]); // 프리셋을 못 읽어도 서재는 보인다
        if (no !== loadNo) return;
        items = PN.rowsToPapers(both[0]);
        index = PN.indexAnalyses(both[1]);
        presetNames = new Map(both[2].map(function (p) { return [p.id, p.name]; }));
        fillPresetSelect(both[2]);
        // 열려 있던 논문이 아직 저장되어 있으면 최신 정보로 다시 연다
        if (selected) selected = items.filter(function (p) { return p.rowId === selected.rowId; })[0] || null;
        status = 'ready';
      } catch (e) {
        if (no !== loadNo) return;
        status = 'error';
        els.banner.hidden = false;
        els.banner.textContent = PN.dbErrorMessage(e, '서재 불러오기');
      }
      render();
      detailPanel.render(selected);
    }

    function visible() {
      var filtered = PN.filterLibrary(items, { text: els.query.value, analysis: els.analysis.value, presetId: els.preset.value }, index);
      return PN.sortLibrary(filtered, els.sort.value, new Date());
    }

    // 카드를 끌어 순서를 바꿀 수 있는 때: "내 순서" 정렬이고, 찾기·거르기가 없어 전체 목록이 보일 때
    function isFiltered() { return !!els.query.value.trim() || els.analysis.value !== 'all' || !!els.preset.value; }
    function canReorder() { return els.sort.value === 'manual' && !isFiltered(); }

    function showHint(shownCount) {
      var text = '';
      if (approved && status === 'ready' && items.length > 1 && shownCount > 0) {
        if (els.sort.value !== 'manual') text = '정렬을 "내 순서"로 바꾸면 카드를 끌어서 읽을 순서를 정할 수 있습니다. ★을 누르면 어떤 정렬에서도 맨 위에 고정됩니다.';
        else if (isFiltered()) text = '찾기·거르기를 해제하면 카드를 끌어서 순서를 바꿀 수 있습니다.';
        else text = '카드를 끌어서 읽을 순서를 바꿀 수 있습니다(키보드는 ⠿ 버튼에서 위·아래 화살표 키를 누르세요). ★을 누르면 맨 위에 고정됩니다.';
      }
      els.hint.textContent = text;
      els.hint.hidden = !text;
    }

    // ---- 그리기 ----
    function stateBox(text, action) {
      var box = document.createElement('div');
      box.className = 'state';
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
      return box;
    }

    function render() {
      els.list.textContent = '';
      els.list.setAttribute('aria-busy', status === 'loading' ? 'true' : 'false');
      if (status !== 'error') els.banner.hidden = true;
      showHint(0);
      if (!approved) { els.sub.textContent = ''; return; }
      if (status === 'loading') { els.sub.textContent = ''; els.list.appendChild(stateBox('서재를 불러오는 중입니다…')); return; }
      if (status === 'error') { els.sub.textContent = ''; els.list.appendChild(stateBox('서재를 불러오지 못했습니다.', { label: '다시 시도', onClick: load })); return; }
      if (!items.length) {
        els.sub.textContent = '0건';
        els.list.appendChild(stateBox('아직 저장한 논문이 없습니다. 검색 화면에서 논문을 저장하면 여기에 모입니다.', { label: '검색하러 가기', onClick: function () { g.location.hash = '#search'; } }));
        return;
      }
      var shown = visible();
      els.sub.textContent = shown.length === items.length ? items.length + '건' : shown.length + ' / ' + items.length + '건';
      if (!shown.length) {
        els.list.appendChild(stateBox('조건에 맞는 논문이 없습니다.', { label: '조건 해제', onClick: function () { els.query.value = ''; els.analysis.value = 'all'; els.preset.value = ''; render(); } }));
        return;
      }
      showHint(shown.length);
      var reorder = canReorder() && shown.length > 1;
      shown.forEach(function (paper) {
        var isOpen = !!selected && selected.rowId === paper.rowId;
        var badge = PN.analysisBadge(index.get(paper.rowId));
        var badges = badge ? [badge] : [];
        if (paper.presetId && presetNames.has(paper.presetId)) badges.push(presetNames.get(paper.presetId));
        var memoLine = paper.memo ? paper.memo.split('\n')[0].slice(0, 80) : '';
        var cardNode = PN.renderCard(paper, true, isOpen, { onToggleSave: unsave, onSelect: select }, {
          badges: badges, note: memoLine ? '메모: ' + memoLine : '',
          tools: { pinned: paper.pinned, onTogglePin: togglePin, onRemove: unsave, onMove: reorder ? moveBy : null }
        });
        if (reorder) enableDrag(cardNode, paper);
        els.list.appendChild(cardNode);
      });
    }

    // 다시 그린 뒤에도 키보드 위치를 잃지 않도록, 같은 카드의 같은 도구로 포커스를 돌려 놓는다
    function refocus(paper, selector) {
      var node = Array.prototype.filter.call(els.list.children, function (c) { return c.dataset.key === PN.paperKey(paper); })[0];
      var target = node && node.querySelector(selector);
      if (target) target.focus();
    }

    function fail(e, what) {
      els.banner.hidden = false;
      els.banner.textContent = PN.dbErrorMessage(e, what);
    }

    // ---- 맨 위에 고정 ----
    async function togglePin(paper, button) {
      button.disabled = true;
      try {
        await papersApi.setPinned(paper.rowId, !paper.pinned);
      } catch (e) {
        button.disabled = false;
        fail(e, paper.pinned ? '고정 해제' : '고정');
        return;
      }
      paper.pinned = !paper.pinned;
      render();
      refocus(paper, '.card-pin');
    }

    // ---- 순서 바꾸기 (끌어서 놓기, 또는 손잡이 버튼의 ↑↓ 키) ----
    // 화면은 바로 바꾸고 저장은 뒤에서 한다. 저장이 실패하면 DB의 순서로 다시 읽어 화면과 맞춘다.
    function applyMove(fromId, toId) {
      var result = PN.moveInLibrary(PN.sortLibrary(items, 'manual', new Date()), fromId, toId);
      if (!result) return false;
      result.order.forEach(function (p, i) { p.sortIndex = i; }); // items의 논문 객체와 같은 것
      render();
      orderQueue = orderQueue.then(function () { return papersApi.setOrder(result.changes); }).catch(async function (e) {
        await load();
        fail(e, '순서 저장');
      });
      return true;
    }

    function moveBy(paper, delta) {
      var ordered = PN.sortLibrary(items, 'manual', new Date());
      var at = ordered.findIndex(function (p) { return p.rowId === paper.rowId; });
      var other = ordered[at + delta];
      if (other && applyMove(paper.rowId, other.rowId)) refocus(paper, '.card-grip');
    }

    function clearDropMarks() {
      Array.prototype.forEach.call(els.list.querySelectorAll('.card[data-drop]'), function (c) { c.removeAttribute('data-drop'); });
    }

    function enableDrag(cardNode, paper) {
      cardNode.draggable = true;
      cardNode.dataset.reorder = 'true';
      cardNode.addEventListener('dragstart', function (e) {
        dragId = paper.rowId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', paper.rowId); // 일부 브라우저는 데이터가 있어야 끌기를 시작한다
        cardNode.dataset.dragging = 'true';
      });
      cardNode.addEventListener('dragend', function () {
        dragId = null;
        cardNode.removeAttribute('data-dragging');
        clearDropMarks();
      });
      cardNode.addEventListener('dragover', function (e) {
        var from = dragId && items.filter(function (p) { return p.rowId === dragId; })[0];
        if (!from || from.rowId === paper.rowId || from.pinned !== paper.pinned) return; // 고정한 카드와 아닌 카드는 구역이 다르다
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // 위로 끌면 이 카드 앞으로, 아래로 끌면 이 카드 뒤로 들어간다 (PN.moveInLibrary와 같은 규칙)
        var ordered = PN.sortLibrary(items, 'manual', new Date());
        var side = ordered.indexOf(from) < ordered.indexOf(paper) ? 'after' : 'before';
        if (cardNode.dataset.drop !== side) { clearDropMarks(); cardNode.dataset.drop = side; }
      });
      cardNode.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = dragId;
        dragId = null;
        clearDropMarks();
        if (from) applyMove(from, paper.rowId);
      });
    }

    function select(paper) {
      selected = paper;
      render();
      detailPanel.render(selected);
    }

    // 카드의 휴지통과 상세의 "저장됨" 버튼이 함께 쓴다. 서재에서 지우는 것이 곧 저장 취소다 (분석 결과와 메모도 함께 지워진다)
    async function unsave(paper, button) {
      if (!g.confirm('이 논문을 서재에서 삭제할까요? 분석 결과와 메모도 함께 지워지며 되돌릴 수 없습니다.')) return;
      button.disabled = true;
      try {
        await papersApi.remove(paper.rowId);
      } catch (e) {
        button.disabled = false;
        fail(e, '삭제');
        return;
      }
      ctx.analysis.onSavedChange(paper, null);
      items = items.filter(function (p) { return p.rowId !== paper.rowId; });
      index.delete(paper.rowId);
      if (selected && selected.rowId === paper.rowId) selected = null;
      render();
      detailPanel.render(selected);
    }

    [els.query, els.analysis, els.preset, els.sort].forEach(function (c) { c.addEventListener('input', render); });
    els.form.addEventListener('submit', function (e) { e.preventDefault(); });
    setEnabled(false);

    var GATE_TEXT = {
      'signed-out': '로그인하면 서재를 볼 수 있습니다. 설정에서 로그인하세요.',
      pending: '관리자가 가입을 승인하면 서재를 쓸 수 있습니다.',
      rejected: '가입이 승인되지 않아 서재를 쓸 수 없습니다. 관리자에게 문의하세요.',
      error: '계정 정보를 불러오지 못해 서재를 볼 수 없습니다. 설정에서 다시 시도하세요.'
    };

    return {
      // 앱 상태가 바뀔 때마다 부른다. 승인된 계정이 서재 화면에 들어올 때 목록을 새로 읽는다.
      onState: function (state) {
        var auth = state.auth;
        var key = auth.state === 'approved' ? 'approved:' + auth.email : auth.state;
        if (key !== accountKey) { // 계정이 바뀌면 이전 계정의 목록을 지운다
          accountKey = key;
          loadNo++;
          items = [];
          index = new Map();
          selected = null;
          status = 'idle';
        }
        approved = auth.state === 'approved';
        setEnabled(approved);
        els.gate.hidden = approved || auth.state === 'loading';
        els.gateText.textContent = GATE_TEXT[auth.state] || '';
        if (!approved) { render(); detailPanel.render(null); return; }
        if (state.screen === 'library' && status !== 'loading' && !this.entered) {
          this.entered = true;
          load();
        } else if (state.screen !== 'library') {
          this.entered = false; // 다른 화면으로 나가면, 다음에 들어올 때 다시 읽는다
        } else {
          render();
        }
      },
      entered: false
    };
  };
})(globalThis);
