// 사이드바 아래의 OpenRouter API 키 상자 (DESIGN.md 5.7). 키는 입력창에서 곧바로 keyStore(sessionStorage)로 가고, 화면에는 다시 보이지 않는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var $ = function (sel) { return document.querySelector(sel); };

  // keyStore: PN.createKeyStore(), onChange: 키가 들어오거나 지워졌을 때 부른다
  PN.initKeyBox = function (keyStore, onChange) {
    var els = {
      dot: $('#key-dot'), status: $('#key-status'), note: $('#key-note'), form: $('#key-form'),
      input: $('#key-input'), error: $('#key-error'), toggle: $('#key-toggle'),
      chip: $('#key-chip'), chipDot: $('#key-chip-dot'), chipText: $('#key-chip-text') // education의 상단 막대에 있는 요약 (academic에서는 숨김)
    };

    function render() {
      var has = keyStore.has();
      els.dot.dataset.on = has ? 'true' : 'false';
      els.status.textContent = has ? '입력됨' : '키를 입력하세요';
      els.note.textContent = has ? '탭을 닫으면 삭제됩니다' : '키는 이 탭에만 보관됩니다';
      els.toggle.textContent = has ? '키 삭제' : '키 입력';
      els.chipDot.dataset.on = has ? 'true' : 'false';
      els.chip.dataset.on = has ? 'true' : 'false';
      els.chipText.textContent = has ? 'API 키 입력됨' : 'API 키 필요';
      els.chip.setAttribute('aria-label', 'OpenRouter ' + els.chipText.textContent + (has ? '. 삭제는 왼쪽 메뉴 아래에서' : '. 눌러서 입력'));
      if (has) els.form.hidden = true;
    }

    function open() {
      els.form.hidden = false;
      els.input.focus();
    }

    // 상단 막대의 요약을 누르면: 키가 없으면 입력창을 열고, 있으면 삭제 버튼으로 이동한다
    els.chip.addEventListener('click', function () {
      if (keyStore.has()) els.toggle.focus();
      else open();
    });

    els.toggle.addEventListener('click', function () {
      if (keyStore.has()) {
        keyStore.clear();
        render();
        onChange();
      } else if (els.form.hidden) {
        open();
      } else {
        els.form.hidden = true;
      }
    });

    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var problem = keyStore.set(els.input.value);
      els.error.textContent = problem || '';
      els.error.hidden = !problem;
      if (problem) return;
      els.input.value = ''; // 입력창에도 남기지 않는다
      render();
      onChange();
    });

    render();
    return { open: open };
  };
})(globalThis);
