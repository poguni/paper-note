// 같은 논문의 분석 결과 두 건을 나란히 보는 비교 화면 (F16). 넓은 대화상자로 열고, 양쪽에서 보고 싶은 결과를 고른다.
// 모델이 만든 글은 모두 textContent로 넣는다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function content(kind, value) {
    var box = el('div', 'cmp-cell');
    if (Array.isArray(value)) {
      if (!value.length) { box.appendChild(el('p', 'cmp-empty', '없음')); return box; }
      var ul = el('ul', 'cmp-list');
      value.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      box.appendChild(ul);
    } else if (!String(value || '').trim()) {
      box.appendChild(el('p', 'cmp-empty', '없음'));
    } else {
      box.appendChild(el('p', 'cmp-text', value));
    }
    return box;
  }

  function metaCard(r) {
    var m = PN.compareMeta(r);
    var card = el('div', 'cmp-meta');
    card.appendChild(el('div', 'cmp-model', m.model));
    card.appendChild(el('div', 'cmp-sub', m.date + (m.saved ? '' : ' · 저장 전')));
    card.appendChild(el('div', 'cmp-sub', '비용 ' + m.cost));
    return card;
  }

  // cfg: { stage, results: 같은 단계 결과(새것부터, 2건 이상), title: 논문 제목, opener: 닫은 뒤 포커스를 돌려줄 버튼 }
  PN.openCompare = function (cfg) {
    var pair = PN.defaultComparePair(cfg.results);
    if (!pair || typeof document.createElement('dialog').showModal !== 'function') return null;
    var left = pair[0];
    var right = pair[1];

    var dlg = el('dialog', 'cmp');
    dlg.setAttribute('aria-labelledby', 'cmp-title');

    var head = el('div', 'cmp-head');
    var heading = el('div', 'cmp-heading');
    var h = el('h2', 'cmp-title', '분석 결과 비교');
    h.id = 'cmp-title';
    heading.appendChild(h);
    heading.appendChild(el('div', 'cmp-paper', cfg.title));
    head.appendChild(heading);
    var close = el('button', 'btn btn-sm btn-secondary', '닫기');
    close.type = 'button';
    close.addEventListener('click', function () { dlg.close(); });
    head.appendChild(close);
    dlg.appendChild(head);

    var body = el('div', 'cmp-body');
    var controls = el('div', 'cmp-controls');
    var selects = [];
    [['왼쪽 결과', left], ['오른쪽 결과', right]].forEach(function (side, k) {
      var label = el('label', 'cmp-pick', side[0]);
      var sel = el('select', 'select');
      cfg.results.forEach(function (r, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = (cfg.results.length - i) + '. ' + r.modelLabel + ' · ' + PN.compareMeta(r).date;
        sel.appendChild(o);
      });
      sel.value = String(side[1]);
      sel.addEventListener('change', function () {
        if (k === 0) left = Number(sel.value); else right = Number(sel.value);
        draw();
      });
      label.appendChild(sel);
      controls.appendChild(label);
      selects.push(sel);
    });
    body.appendChild(controls);

    var table = el('div', 'cmp-grid');
    table.setAttribute('aria-live', 'polite');
    body.appendChild(table);
    dlg.appendChild(body);

    function draw() {
      var a = cfg.results[left];
      var b = cfg.results[right];
      table.textContent = '';
      table.appendChild(metaCard(a));
      table.appendChild(metaCard(b));
      PN.compareRows(cfg.stage, a, b).forEach(function (row) {
        var title = el('h3', 'cmp-label', row.label);
        table.appendChild(title);
        if (row.kind === 'note') {
          table.appendChild(el('p', 'cmp-note', row.a));
          return;
        }
        table.appendChild(content(row.kind, row.a));
        table.appendChild(content(row.kind, row.b));
      });
    }

    dlg.addEventListener('close', function () {
      dlg.remove();
      if (cfg.opener && cfg.opener.isConnected) cfg.opener.focus();
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); }); // 바깥(어두운 부분)을 누르면 닫기

    draw();
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
    return dlg;
  };
})(globalThis);
