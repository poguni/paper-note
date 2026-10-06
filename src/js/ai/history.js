// 한 논문의 분석 결과 목록(저장된 것 + 방금 만든 저장 전 결과)을 다루는 순수 로직.
(function (g) {
  var PN = (g.PN = g.PN || {});

  // pn_analyses 행들 → 화면용 결과 목록. 모양이 맞지 않는 행(손상, 옛 형식)은 건너뛴다.
  PN.rowsToResults = function (rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (r.stage !== 'abstract' && r.stage !== 'fulltext') return;
      var json = r.result_json;
      var withStats = r.stage === 'fulltext' && !!json && json.statistics_details != null; // 통계 상세가 저장되어 있으면 함께 검증해 살린다
      var checked = PN.validateAnalysis(r.stage, json, withStats);
      if (!checked.ok) return;
      var model = PN.getModel(r.model);
      out.push({ id: r.id, stage: r.stage, modelId: r.model, modelLabel: model ? model.label : r.model, value: checked.value, createdAt: r.created_at, usage: null, attempts: 1 });
    });
    return out;
  };

  // pn_analyses 행들 중 전문 번역(stage 'translation') → 화면용 번역 목록. 한 행이 섹션 하나의 번역이다.
  PN.rowsToTranslations = function (rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (r.stage !== 'translation') return;
      var checked = PN.validateTranslation(r.result_json);
      if (!checked.ok) return;
      var model = PN.getModel(r.model);
      out.push({ id: r.id, stage: 'translation', modelId: r.model, modelLabel: model ? model.label : r.model, value: checked.value, createdAt: r.created_at, usage: null });
    });
    return out;
  };

  // 이미 화면에 있는 결과(current)와 DB에서 읽은 결과(loaded)를 합친다. id가 같으면 화면에 있는 쪽을 쓰고, 새것부터 늘어놓는다.
  PN.mergeResults = function (current, loaded) {
    var byId = {};
    current.forEach(function (r) { if (r.id) byId[r.id] = true; });
    var merged = current.concat(loaded.filter(function (r) { return !byId[r.id]; }));
    return merged.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; });
  };
})(globalThis);
