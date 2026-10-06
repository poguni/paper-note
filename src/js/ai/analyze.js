// 분석 실행: 요청을 보내고, 응답을 검증하고, 형식이 틀리면 한 번만 다시 요청한다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var RETRYABLE = { truncated: true, not_json: true, invalid: true, empty: true }; // 모델의 답이 문제인 경우. 거절(refused)과 통신 오류는 다시 보내지 않는다
  var RETRY_NOTE = '이전 답은 요청한 JSON 형식을 지키지 못했습니다. 설명 없이 지정한 JSON 스키마에 맞는 JSON만 출력하세요.';

  function analysisError(code, message, usage, errors) {
    var e = new Error(message);
    e.name = 'AnalysisError';
    e.code = code;
    e.usage = usage;
    e.errors = errors || null;
    return e;
  }

  function addUsage(total, response) {
    var u = (response && response.usage) || {};
    total.promptTokens += u.prompt_tokens || 0;
    total.completionTokens += u.completion_tokens || 0;
    total.reasoningTokens += (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
    total.costUsd += typeof u.cost === 'number' ? u.cost : 0;
  }

  // client: PN.createOpenRouter() 결과
  // req: { modelId, stage, messages, statsMode, effort, signal }
  // → { value, usage: { promptTokens, completionTokens, reasoningTokens, costUsd }, attempts }
  // 실패하면 AnalysisError(형식 문제) 또는 OpenRouterError(통신·키·크레딧 문제)를 던진다. usage는 실패해도 쓴 만큼 담긴다.
  PN.runAnalysis = async function (client, req) {
    var spec = PN.analysisSchema(req.stage, req.statsMode);
    var stage = PN.STAGES[req.stage];
    var usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 };
    var messages = req.messages;
    var maxTokens = stage.maxTokens;
    var failure = null;

    for (var attempt = 1; attempt <= 2; attempt++) {
      var body = PN.buildRequestBody({
        modelId: req.modelId, messages: messages, schemaName: spec.name, schema: spec.schema, maxTokens: maxTokens, effort: req.effort
      });
      var response;
      try {
        response = await client.chat(body, req.signal);
      } catch (e) {
        e.usage = usage;
        throw e;
      }
      addUsage(usage, response);
      var parsed = PN.parseAnalysisResponse(req.stage, response, req.statsMode);
      if (parsed.ok) return { value: parsed.value, usage: usage, attempts: attempt };
      failure = parsed;
      if (!RETRYABLE[parsed.code]) break;
      // 다시 보낼 때: 잘렸으면 한도를 늘리고, 형식 문제면 규칙을 다시 일러 준다
      if (parsed.code === 'truncated') maxTokens = Math.ceil(maxTokens * 1.5);
      else messages = req.messages.concat([{ role: 'user', content: RETRY_NOTE }]);
    }
    throw analysisError(failure.code, failure.message, usage, failure.errors);
  };

  PN.analysisErrorMessage = function (e) {
    switch (e && e.code) {
      case 'truncated': return '답이 너무 길어 잘렸습니다. 모델이나 분석 범위를 바꿔 다시 시도하세요.';
      case 'refused': return '모델이 이 논문의 분석을 거절했습니다. 다른 모델로 시도해 보세요.';
      case 'empty': case 'not_json': case 'invalid':
        return '모델의 답을 해석하지 못했습니다. 다시 시도하거나 다른 모델을 고르세요.';
      default: return PN.openrouterErrorMessage(e);
    }
  };
})(globalThis);
