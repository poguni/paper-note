// 분석 결과의 JSON 스키마와 검증. 같은 스키마로 (1) OpenRouter에 출력 형식을 요청하고 (2) 받은 값을 검사한다.
// 항목 이름은 PRD "출력 형식"과 같고, pn_analyses.result_json에 그대로 저장된다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  var str = { type: 'string' };
  var bool = { type: 'boolean' };
  var arr = function (items) { return { type: 'array', items: items }; };
  // strict 출력: 모든 항목이 필수이고 정의하지 않은 항목은 허용하지 않는다
  var obj = function (props) { return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false }; };
  var enumOf = function (values) { return { type: 'string', enum: values }; };

  var glossary = arr(obj({ term: str, ko: str, explanation: str }));
  var summary3 = arr(str); // 개수(3)는 의미 검사에서 확인한다. 개수 제한 키워드는 제공사마다 지원이 달라 스키마에 넣지 않는다.

  var statistics = obj({
    is_statistical: bool, model: str, assumptions: arr(str), estimation_method: str, software: arr(str),
    sample: str, fit_indices: arr(obj({ name: str, value: str })), python_skeleton: str
  });

  var appIdea = obj({
    name: str, one_liner: str, evidence: str, core_features: arr(str),
    difficulty: enumOf(['easy', 'medium', 'hard']), single_html_possible: bool, first_prompt: str
  });

  // 단계별 설정: maxTokens는 추론 토큰까지 포함한 상한, expectedOutput은 비용 추정에 쓰는 평균 출력 토큰
  PN.STAGES = {
    abstract: { maxTokens: 4000, expectedOutput: 1200 },
    fulltext: { maxTokens: 16000, expectedOutput: 3000 } // PRD 비용 표는 2천 토큰이지만 섹션별 번역까지 담으면 더 길다
  };
  PN.STATS_EXTRA_OUTPUT = 1000; // 통계 분석 모드는 출력이 약 1천 토큰 늘어난다

  // { name, schema }. statsMode는 본문 단계에서만 뜻이 있다.
  PN.analysisSchema = function (stage, statsMode) {
    if (stage === 'abstract') {
      return { name: 'abstract_analysis', schema: obj({ summary_3lines: summary3, abstract_translation: str, glossary: glossary }) };
    }
    if (stage === 'fulltext') {
      var props = {
        summary_3lines: summary3,
        structured_summary: obj({ purpose: str, method: str, results: str, limitations: str }),
        glossary: glossary,
        section_translations: arr(obj({ title: str, ko: str })),
        app_ideas: arr(appIdea)
      };
      if (statsMode) props.statistics_details = statistics;
      return { name: 'fulltext_analysis', schema: obj(props) };
    }
    throw new Error('알 수 없는 분석 단계: ' + stage);
  };

  // ---- 검증 ----
  // 스키마 모양(타입, 필수 항목, enum)을 확인하고 정의에 없는 항목은 버린 값을 돌려준다.
  function check(schema, value, path, errors) {
    var t = schema.type;
    if (t === 'string') {
      if (typeof value !== 'string') { errors.push(path + ': 글이어야 합니다'); return value; }
      if (schema.enum && schema.enum.indexOf(value) < 0) errors.push(path + ': 허용되지 않는 값');
      return value;
    }
    if (t === 'boolean') {
      if (typeof value !== 'boolean') errors.push(path + ': true/false여야 합니다');
      return value;
    }
    if (t === 'array') {
      if (!Array.isArray(value)) { errors.push(path + ': 목록이어야 합니다'); return value; }
      return value.map(function (v, i) { return check(schema.items, v, path + '[' + i + ']', errors); });
    }
    // object
    if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(path + ': 묶음이어야 합니다'); return value; }
    var out = {};
    schema.required.forEach(function (key) {
      if (!(key in value)) { errors.push(path + '.' + key + ': 없음'); return; }
      out[key] = check(schema.properties[key], value[key], path + '.' + key, errors);
    });
    return out;
  }

  var blank = function (s) { return typeof s !== 'string' || !s.trim(); };

  // 모양은 맞지만 내용이 비어 쓸 수 없는 경우. 논문에 없는 내용은 비워 두지 않고 "언급 없음"으로 적게 한다. (PRD "프롬프트 원칙")
  function checkContent(stage, v, errors) {
    if (v.summary_3lines.length !== 3 || v.summary_3lines.some(blank)) errors.push('summary_3lines: 비어 있지 않은 3줄이어야 합니다');
    if (stage === 'abstract' && blank(v.abstract_translation)) errors.push('abstract_translation: 비어 있음');
    v.glossary.forEach(function (t, i) {
      if (blank(t.term) || blank(t.ko)) errors.push('glossary[' + i + ']: 용어나 한국어 번역이 비어 있음');
    });
    if (stage === 'fulltext') {
      ['purpose', 'method', 'results', 'limitations'].forEach(function (k) {
        if (blank(v.structured_summary[k])) errors.push('structured_summary.' + k + ': 비어 있음');
      });
      if (!v.section_translations.length) errors.push('section_translations: 비어 있음');
      v.section_translations.forEach(function (s, i) {
        if (blank(s.title) || blank(s.ko)) errors.push('section_translations[' + i + ']: 제목이나 번역이 비어 있음');
      });
      var sd = v.statistics_details;
      if (sd && sd.is_statistical) { // 통계 논문이면 문자열 항목은 비우지 않고 "본문에 언급 없음"으로 적어야 한다
        ['model', 'estimation_method', 'sample', 'python_skeleton'].forEach(function (k) {
          if (blank(sd[k])) errors.push('statistics_details.' + k + ': 비어 있음');
        });
      }
      v.app_ideas.forEach(function (a, i) {
        if (blank(a.name) || blank(a.one_liner) || blank(a.first_prompt) || !a.core_features.length) errors.push('app_ideas[' + i + ']: 필수 내용이 비어 있음');
      });
    }
  }

  // → { ok: true, value } | { ok: false, errors: [...] }
  // value는 정의된 항목만 담고, 통계 상세가 꺼져 있으면 statistics_details는 null이다.
  PN.validateAnalysis = function (stage, raw, statsMode) {
    var spec = PN.analysisSchema(stage, statsMode);
    var errors = [];
    var value = check(spec.schema, raw, '$', errors);
    if (!errors.length) checkContent(stage, value, errors);
    if (errors.length) return { ok: false, errors: errors };
    if (stage === 'fulltext' && !statsMode) value.statistics_details = null;
    return { ok: true, value: value };
  };

  // OpenRouter 응답(chat/completions의 JSON) → 결과 또는 실패 이유.
  //   { ok: true, value } | { ok: false, code: 'truncated'|'refused'|'empty'|'not_json'|'invalid', message, errors? }
  PN.parseAnalysisResponse = function (stage, response, statsMode) {
    var choice = response && response.choices && response.choices[0];
    if (!choice) return { ok: false, code: 'empty', message: '모델이 답을 보내지 않았습니다.' };
    var message = choice.message || {};
    if (message.refusal) return { ok: false, code: 'refused', message: '모델이 요청을 거절했습니다.' };
    if (choice.finish_reason === 'length') return { ok: false, code: 'truncated', message: '답이 길어서 중간에 잘렸습니다.' };
    var text = typeof message.content === 'string' ? message.content.trim() : '';
    if (!text) return { ok: false, code: 'empty', message: '모델이 답을 보내지 않았습니다.' };
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''); // 코드 블록으로 감싼 경우
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, code: 'not_json', message: '답이 JSON 형식이 아닙니다.' }; }
    var checked = PN.validateAnalysis(stage, raw, statsMode);
    if (!checked.ok) return { ok: false, code: 'invalid', message: '답의 일부 항목이 빠졌거나 형식이 맞지 않습니다.', errors: checked.errors };
    return { ok: true, value: checked.value };
  };
})(globalThis);
