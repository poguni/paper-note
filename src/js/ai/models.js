// 분석에 쓰는 모델 3종과 요청 본문 만들기. 모델 ID는 고정이며 `latest` 별칭은 쓰지 않는다. (PRD "AI 분석")
(function (g) {
  var PN = (g.PN = g.PN || {});

  var EFFORT = { kind: 'effort', levels: ['low', 'medium', 'high'], default: 'low' }; // 추론이 항상 켜져 있고 강도만 고른다

  PN.MODELS = [
    { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', priceIn: 2, priceOut: 10, reasoning: EFFORT },
    { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', priceIn: 0.75, priceOut: 3.75, reasoning: EFFORT },
    {
      id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', priceIn: 0.10, priceOut: 0.50,
      reasoning: { kind: 'effort', levels: ['none', 'low', 'medium', 'high'], default: 'none' }, // 추론을 끌 수 있다
      longContext: { aboveTokens: 272000, inputMultiplier: 2 } // 입력이 이보다 길면 입력 단가가 2배
    }
  ];

  PN.DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';

  PN.getModel = function (id) {
    for (var i = 0; i < PN.MODELS.length; i++) if (PN.MODELS[i].id === id) return PN.MODELS[i];
    return null;
  };

  // spec: { modelId, messages, schemaName, schema, maxTokens, effort? } → OpenRouter chat/completions 요청 본문
  PN.buildRequestBody = function (spec) {
    var model = PN.getModel(spec.modelId);
    if (!model) throw new Error('알 수 없는 모델: ' + spec.modelId);
    var effort = spec.effort || model.reasoning.default;
    if (model.reasoning.levels.indexOf(effort) < 0) throw new Error(model.label + '은(는) 추론 강도 ' + effort + '를 쓸 수 없습니다.');
    return {
      model: model.id,
      messages: spec.messages,
      reasoning: { effort: effort },
      max_tokens: spec.maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: spec.schemaName, strict: true, schema: spec.schema } },
      usage: { include: true } // 응답에 실제 비용을 함께 받는다
    };
  };
})(globalThis);
