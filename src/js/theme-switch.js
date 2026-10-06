// 테마 전환: 설정 화면의 선택 목록(미리보기 포함)과 왼쪽 메뉴 아래의 빠른 전환 버튼. (DESIGN.md 2)
// 모델 선택은 education에서는 상단 막대에, academic에서는 검색 막대에 둔다. 같은 요소를 옮기기만 해서 선택값과 이벤트가 그대로 남는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var $ = function (sel) { return document.querySelector(sel); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // 선택 목록의 미리보기: 그 테마의 색과 배치를 흉내 낸 작은 그림 (data-theme-scope가 그 테마의 토큰을 켠다)
  function preview(theme) {
    var box = el('div', 'tp');
    box.dataset.themeScope = theme;
    box.setAttribute('aria-hidden', 'true');
    var top = el('div', 'tp-top');
    top.appendChild(el('span', 'tp-dot'));
    top.appendChild(el('span', 'tp-dot tp-dot-on'));
    top.appendChild(el('span', 'tp-dot'));
    box.appendChild(top);
    var body = el('div', 'tp-body');
    var side = el('div', 'tp-side');
    side.appendChild(el('span', 'tp-nav tp-nav-on'));
    side.appendChild(el('span', 'tp-nav'));
    side.appendChild(el('span', 'tp-nav'));
    body.appendChild(side);
    var main = el('div', 'tp-main');
    main.appendChild(el('span', 'tp-title', 'Aa 논문 제목'));
    main.appendChild(el('span', 'tp-card'));
    var chips = el('span', 'tp-chips');
    chips.appendChild(el('i', 'tp-chip'));
    chips.appendChild(el('i', 'tp-chip tp-chip-saved'));
    main.appendChild(chips);
    body.appendChild(main);
    box.appendChild(body);
    return box;
  }

  PN.initThemeSwitch = function () {
    var storage;
    try { storage = g.localStorage; } catch (e) { /* 저장소 접근이 막힌 환경 */ }
    var els = { list: $('#theme-options'), quick: $('#theme-quick'), quickText: $('#theme-quick-text'), note: $('#theme-note') };
    var model = $('#model-select').closest('label');
    var slot = $('#model-slot');
    var form = $('#search-form');
    var dirty = $('#filter-dirty');
    var options = [];

    function placeModel(theme) {
      if (theme === 'education') slot.appendChild(model);
      else form.insertBefore(model, dirty);
    }

    function render(theme) {
      options.forEach(function (o) {
        o.input.checked = o.theme === theme;
        o.node.dataset.selected = o.theme === theme ? 'true' : 'false';
      });
      els.quickText.textContent = PN.themeQuickLabel(theme);
    }

    function choose(theme) {
      var applied = PN.applyTheme(theme, document);
      var saved = PN.saveTheme(applied, storage);
      placeModel(applied);
      render(applied);
      els.note.hidden = saved;
      els.note.textContent = saved ? '' : '이 브라우저는 선택을 저장하지 못해서, 새로고침하면 처음 테마로 돌아갑니다.';
    }

    PN.THEMES.forEach(function (theme) {
      var info = PN.THEME_INFO[theme];
      var label = el('label', 'theme-option');
      var input = el('input');
      input.type = 'radio';
      input.name = 'theme';
      input.value = theme;
      input.addEventListener('change', function () { if (input.checked) choose(theme); });
      label.appendChild(input);
      label.appendChild(preview(theme));
      label.appendChild(el('span', 'theme-name', info.label));
      label.appendChild(el('span', 'theme-desc', info.note));
      els.list.appendChild(label);
      options.push({ theme: theme, node: label, input: input });
    });

    els.quick.addEventListener('click', function () { choose(PN.otherTheme(document.documentElement.dataset.theme)); });

    var current = document.documentElement.dataset.theme;
    placeModel(current);
    render(current);
  };
})(globalThis);
