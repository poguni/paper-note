// 설정 화면의 "검색 프리셋" 구역: 추가, 수정, 삭제, 순서 변경 (PRD F11). 바꿀 때마다 DB에 저장하고 사이드바의 프리셋 목록을 다시 읽게 한다.
//   ctx: { auth, onChange(): 프리셋 목록이 바뀌었을 때 }
(function (g) {
  var PN = (g.PN = g.PN || {});
  var $ = function (sel) { return document.querySelector(sel); };

  PN.initPresetManager = function (ctx) {
    var client = ctx.auth && ctx.auth.client;
    var api = client && PN.createPresetsApi(client);
    var els = {
      panel: $('#pm-panel'), list: $('#pm-list'), add: $('#pm-add'), note: $('#pm-note'), banner: $('#pm-banner'),
      form: $('#pm-form'), formTitle: $('#pm-form-title'), name: $('#pm-name'), query: $('#pm-query'),
      arxiv: $('#pm-src-arxiv'), s2: $('#pm-src-s2'), cats: $('#pm-cats'), sort: $('#pm-sort'), date: $('#pm-date'),
      min: $('#pm-min'), limit: $('#pm-limit'), stats: $('#pm-stats'), errors: $('#pm-errors'), cancel: $('#pm-cancel'), save: $('#pm-save')
    };

    function fill(select, options) {
      options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = String(o[0]);
        opt.textContent = o[1];
        select.appendChild(opt);
      });
    }
    fill(els.sort, PN.SORT_OPTIONS);
    fill(els.date, PN.DATE_OPTIONS);
    fill(els.min, PN.CITATION_OPTIONS);
    fill(els.limit, PN.LIMIT_OPTIONS);

    var presets = [];
    var editingId = null; // null이면 새 프리셋
    var busy = false;
    var approved = false;
    var loaded = false;
    var loadFailed = false; // 마지막으로 목록을 읽으려던 시도가 실패했음 (읽는 중과 구별한다)
    var accountKey = '';

    function showBanner(text) {
      els.banner.hidden = !text;
      els.banner.textContent = text || '';
    }

    // ---- 목록 ----
    function renderList() {
      els.list.textContent = '';
      presets.forEach(function (p, i) {
        var li = document.createElement('li');
        li.className = 'pm-item';
        var no = document.createElement('span');
        no.className = 'pm-no';
        no.textContent = String(i + 1);
        li.appendChild(no);

        var info = document.createElement('div');
        info.className = 'pm-info';
        var name = document.createElement('div');
        name.className = 'pm-name';
        name.textContent = p.name + (p.stats_mode ? ' · 통계 분석 모드' : '');
        info.appendChild(name);
        var sum = document.createElement('div');
        sum.className = 'pm-sum';
        sum.textContent = PN.presetSummary(p);
        info.appendChild(sum);
        li.appendChild(info);

        var actions = document.createElement('div');
        actions.className = 'pm-actions';
        [['위로', '▲', i === 0, function () { move(i, -1); }], ['아래로', '▼', i === presets.length - 1, function () { move(i, 1); }]].forEach(function (a) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-sm btn-secondary pm-move';
          b.textContent = a[1];
          b.setAttribute('aria-label', p.name + ' ' + a[0] + ' 옮기기');
          b.disabled = a[2] || busy;
          b.addEventListener('click', a[3]);
          actions.appendChild(b);
        });
        [['수정', function () { openForm(p); }], ['삭제', function () { remove(p); }]].forEach(function (a) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-sm btn-secondary';
          b.textContent = a[0];
          b.setAttribute('aria-label', p.name + ' ' + a[0]);
          b.disabled = busy;
          b.addEventListener('click', a[1]);
          actions.appendChild(b);
        });
        li.appendChild(actions);
        els.list.appendChild(li);
      });
      var full = presets.length >= PN.MAX_PRESETS;
      els.add.disabled = full || busy || !loaded; // 목록을 읽지 못했으면 순서를 알 수 없어 추가하지 않는다
      els.note.textContent = full ? '프리셋은 ' + PN.MAX_PRESETS + '개까지 만들 수 있습니다.'
        : loadFailed ? '목록을 불러오지 못했습니다. 설정 화면을 다시 열면 다시 시도합니다.'
        : presets.length ? '' : '프리셋이 없습니다. "+ 프리셋 추가"로 만들어 보세요.';
    }

    async function reload() {
      try {
        presets = await api.list();
        loaded = true;
        loadFailed = false;
        showBanner('');
      } catch (e) {
        loadFailed = true;
        showBanner(PN.dbErrorMessage(e, '프리셋 불러오기'));
      }
      renderList();
    }

    // DB를 바꾼 뒤 목록을 다시 읽고 사이드바에 알린다
    async function afterChange() {
      await reload();
      ctx.onChange();
    }

    async function run(task, verb) {
      if (busy) return;
      busy = true;
      renderList();
      try {
        await task();
        showBanner('');
      } catch (e) {
        showBanner(PN.dbErrorMessage(e, verb));
      }
      busy = false;
      await afterChange();
    }

    function move(index, delta) {
      // 새 순서에서의 자리 번호(1부터)와 지금 값을 비교해 바뀐 것만 저장한다
      var changes = PN.positionChanges(PN.moveItem(presets, index, delta));
      run(function () { return api.reorder(changes); }, '순서 바꾸기');
    }

    function remove(p) {
      if (!g.confirm('프리셋 "' + p.name + '"을(를) 삭제할까요?\n이 프리셋으로 저장한 논문은 지워지지 않고, 서재에서 "프리셋 없음"으로 보입니다.')) return;
      // 지운 뒤 남은 프리셋의 번호가 비지 않게 1부터 다시 매긴다
      var rest = presets.filter(function (x) { return x.id !== p.id; });
      var changes = PN.positionChanges(rest);
      run(function () { return api.remove(p.id).then(function () { return api.reorder(changes); }); }, '프리셋 삭제');
    }

    // ---- 폼 ----
    function writeForm(f) {
      els.name.value = f.name;
      els.query.value = f.query;
      els.arxiv.checked = f.sources.indexOf('arxiv') >= 0;
      els.s2.checked = f.sources.indexOf('semantic_scholar') >= 0;
      els.cats.value = f.arxivCategories;
      els.sort.value = f.sort;
      els.date.value = f.dateRange;
      els.min.value = String(f.minCitations);
      els.limit.value = String(f.resultLimit);
      els.stats.checked = f.statsMode;
    }

    function readForm() {
      var sources = [];
      if (els.arxiv.checked) sources.push('arxiv');
      if (els.s2.checked) sources.push('semantic_scholar');
      return {
        name: els.name.value, query: els.query.value, sources: sources, arxivCategories: els.cats.value, sort: els.sort.value,
        dateRange: els.date.value, minCitations: els.min.value, resultLimit: els.limit.value, statsMode: els.stats.checked
      };
    }

    function showErrors(errors) {
      els.errors.textContent = '';
      var keys = Object.keys(errors || {});
      els.errors.hidden = !keys.length;
      keys.forEach(function (k) {
        var li = document.createElement('li');
        li.textContent = errors[k];
        els.errors.appendChild(li);
      });
    }

    function openForm(preset) {
      editingId = preset ? preset.id : null;
      els.formTitle.textContent = preset ? '프리셋 수정' : '프리셋 추가';
      writeForm(preset ? PN.presetToForm(preset) : PN.presetDefaults());
      showErrors(null);
      els.form.hidden = false;
      setTimeout(function () { els.name.focus(); }, 60); // 다른 화면에서 막 넘어온 경우 화면이 보인 뒤에 초점을 준다
    }

    function closeForm() {
      els.form.hidden = true;
      editingId = null;
    }

    els.add.addEventListener('click', function () { openForm(null); });
    els.cancel.addEventListener('click', closeForm);
    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var checked = PN.validatePreset(readForm());
      showErrors(checked.errors);
      if (!checked.ok) return;
      var id = editingId;
      closeForm();
      if (id) {
        run(function () { return api.update(id, checked.value).then(function (row) { if (!row) throw new Error('preset row is gone'); }); }, '프리셋 수정');
      } else {
        var position = presets.length ? Math.max.apply(null, presets.map(function (p) { return p.position; })) + 1 : 1;
        run(function () { return api.create(checked.value, position); }, '프리셋 추가');
      }
    });

    return {
      // 앱 상태가 바뀔 때 부른다. 승인된 계정이면 목록을 읽고, 아니면 구역을 숨긴다.
      onState: function (state) {
        var auth = state.auth;
        approved = auth.state === 'approved';
        var key = approved ? 'approved:' + auth.email : auth.state;
        els.panel.hidden = !approved;
        if (key !== accountKey) {
          accountKey = key;
          presets = [];
          loaded = false;
          closeForm();
          renderList();
        }
        if (approved && !loaded && !busy) reload();
      },
      // 사이드바의 "+ 프리셋 추가"가 부른다
      openAdd: function () {
        if (!approved) return;
        if (presets.length >= PN.MAX_PRESETS) return;
        openForm(null);
      }
    };
  };
})(globalThis);
