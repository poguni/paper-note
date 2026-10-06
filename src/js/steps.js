// 상단 "4단계 표시"(검색 → 저장 → 분석 → 내 서재)의 현재 단계 계산과 그리기. 두 테마가 같은 값을 쓰고 academic에서는 CSS로 숨긴다. (DESIGN.md 4.2, 4.3)
(function (g) {
  var PN = (g.PN = g.PN || {});

  PN.STEPS = [
    { id: 'search', label: '검색' },
    { id: 'save', label: '저장' },
    { id: 'analyze', label: '분석' },
    { id: 'library', label: '내 서재' }
  ];

  // 앱 상태 → 현재 단계(1~4). 어느 단계도 아니면 0 (설정 화면).
  //   s: { screen, hasPaper: 상세에 논문이 열려 있음, saved: 그 논문이 저장됨, analyzed: 그 논문의 분석 결과가 있음 }
  PN.currentStep = function (s) {
    if (s.screen === 'library') return 4;
    if (s.screen !== 'search') return 0;
    if (!s.hasPaper) return 1;
    if (s.analyzed) return 3;
    if (s.saved) return 2;
    return 1;
  };

  // 현재 단계 → 단계별 상태 ['done' | 'current' | 'todo']
  PN.stepStates = function (step) {
    return PN.STEPS.map(function (_, i) {
      return i + 1 < step ? 'done' : i + 1 === step ? 'current' : 'todo';
    });
  };

  var STATE_TEXT = { done: '완료', current: '현재 단계', todo: '아직 안 함' };

  // 목록 요소(<ol>)를 단계 표시로 채운다. 색만으로 뜻을 전하지 않도록 완료는 ✓, 나머지는 번호와 화면 밖 글씨를 쓴다.
  PN.renderSteps = function (list, step) {
    var states = PN.stepStates(step);
    list.textContent = '';
    PN.STEPS.forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = 'step';
      li.dataset.state = states[i];
      if (states[i] === 'current') li.setAttribute('aria-current', 'step');

      var dot = document.createElement('span');
      dot.className = 'step-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = states[i] === 'done' ? '✓' : String(i + 1);
      li.appendChild(dot);

      var label = document.createElement('span');
      label.className = 'step-label';
      label.textContent = s.label;
      li.appendChild(label);

      var hint = document.createElement('span');
      hint.className = 'sr-only';
      hint.textContent = ' (' + STATE_TEXT[states[i]] + ')';
      li.appendChild(hint);
      list.appendChild(li);
    });
  };
})(globalThis);
