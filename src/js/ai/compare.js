// 같은 논문의 분석 결과 두 건을 나란히 비교하기 위한 순수 로직 (F16). 화면은 compare-view.js가 그린다.
// results: PN.mergeResults() 순서(새것부터)의 같은 단계 결과 목록. 결과 한 건의 모양은 history.js를 따른다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  // 처음 비교할 두 결과의 위치 [왼쪽, 오른쪽]. 가장 새 결과와, 그것과 다른 모델이 만든 가장 새 결과.
  // 다른 모델이 없으면(같은 모델로 다시 분석) 그다음 결과. 비교할 수 없으면 null.
  PN.defaultComparePair = function (results) {
    if (!results || results.length < 2) return null;
    for (var i = 1; i < results.length; i++) {
      if (results[i].modelId !== results[0].modelId) return [0, i];
    }
    return [0, 1];
  };

  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // 결과 한 건의 머리 정보. 저장된 결과는 비용을 기록하지 않아서(DB에는 AI 결과만 둔다) 비용을 알 수 없다.
  PN.compareMeta = function (r) {
    var cost = r.usage ? (r.usage.costUsd > 0 ? PN.formatCost(r.usage.costUsd) : '확인되지 않음') : '기록 없음 (저장된 결과)';
    return { model: r.modelLabel, date: when(r.createdAt), cost: cost, saved: !!r.id };
  };

  function termKey(t) { return String(t.term || '').trim().toLowerCase(); }
  function termLabel(t) { return t.ko + ' (' + t.term + ')'; }

  // 두 결과의 용어 겹침: 영어 용어를 대소문자 구분 없이 비교한다
  PN.termOverlap = function (a, b) {
    var inB = {};
    b.forEach(function (t) { inB[termKey(t)] = true; });
    var inA = {};
    a.forEach(function (t) { inA[termKey(t)] = true; });
    var both = 0;
    a.forEach(function (t) { if (inB[termKey(t)]) both++; });
    var onlyB = 0;
    b.forEach(function (t) { if (!inA[termKey(t)]) onlyB++; });
    return { both: both, onlyA: a.length - both, onlyB: onlyB };
  };

  function statsText(sd) {
    if (!sd) return '만들지 않음 (통계 분석 모드가 꺼져 있었음)';
    if (!sd.is_statistical) return '통계 논문이 아니라고 판단함';
    var parts = [];
    if (sd.model) parts.push('모형: ' + sd.model);
    if (sd.estimation_method) parts.push('추정: ' + sd.estimation_method);
    if (sd.software && sd.software.length) parts.push('소프트웨어: ' + sd.software.join(', '));
    return parts.join(' · ');
  }

  // 비교 표의 행. kind: 'list'(목록), 'text'(글), 'note'(두 칸을 합친 한 줄). a, b는 그 칸의 내용(목록이면 문자열 배열).
  PN.compareRows = function (stage, a, b) {
    var va = a.value;
    var vb = b.value;
    var rows = [];
    function add(label, kind, x, y) { rows.push({ label: label, kind: kind, a: x, b: y }); }

    add('3줄 요약', 'list', va.summary_3lines, vb.summary_3lines);
    if (stage === 'abstract') {
      add('초록 번역', 'text', va.abstract_translation, vb.abstract_translation);
    } else {
      var s = [['연구 목적', 'purpose'], ['방법', 'method'], ['결과', 'results'], ['한계', 'limitations']];
      s.forEach(function (p) { add(p[0], 'text', va.structured_summary[p[1]], vb.structured_summary[p[1]]); });
      add('섹션별 번역', 'list', va.section_translations.map(function (t) { return t.title; }), vb.section_translations.map(function (t) { return t.title; }));
    }
    add('용어 사전', 'list', va.glossary.map(termLabel), vb.glossary.map(termLabel));
    var o = PN.termOverlap(va.glossary, vb.glossary);
    add('용어 겹침', 'note', '두 결과가 모두 뽑은 용어 ' + o.both + '개 · 왼쪽에만 ' + o.onlyA + '개 · 오른쪽에만 ' + o.onlyB + '개', null);
    if (stage === 'fulltext') {
      add('통계 상세', 'text', statsText(va.statistics_details), statsText(vb.statistics_details));
      add('앱 아이디어', 'list', va.app_ideas.map(function (i) { return i.name; }), vb.app_ideas.map(function (i) { return i.name; }));
    }
    return rows;
  };
})(globalThis);
