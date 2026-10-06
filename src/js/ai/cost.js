// 예상 토큰과 비용. 분석을 실행하기 전에 보여 주고, 크면 확인을 받는다. (PRD "비용")
(function (g) {
  var PN = (g.PN = g.PN || {});

  // 이 값을 넘으면 실행 전에 확인창을 띄운다 (전문 번역처럼 비싼 작업, 입력이 큰 분석)
  PN.CONFIRM_COST_USD = 0.10;
  PN.CONFIRM_INPUT_TOKENS = 60000;

  // 토큰 수 어림값. 영문은 글자 4개 ≈ 1토큰, 한글 등 영문이 아닌 글자는 1글자 ≈ 1토큰으로 넉넉히 센다.
  // 모델마다 토큰을 세는 방식이 달라서(시험에서 같은 글이 358, 167, 123토큰) 정확한 값이 아니라 어림값이다.
  PN.estimateTokens = function (text) {
    var latin = 0;
    var other = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) < 128) latin++;
      else other++;
    }
    return Math.ceil(latin / 4) + other;
  };

  // USD. 입력이 긴 요청의 단가 인상(Luna)을 반영한다.
  PN.computeCost = function (modelId, inputTokens, outputTokens) {
    var m = PN.getModel(modelId);
    if (!m) throw new Error('알 수 없는 모델: ' + modelId);
    var priceIn = m.priceIn;
    if (m.longContext && inputTokens > m.longContext.aboveTokens) priceIn *= m.longContext.inputMultiplier;
    return (inputTokens * priceIn + outputTokens * m.priceOut) / 1e6;
  };

  // opts: { modelId, stage, inputText 또는 inputTokens, statsMode }
  // → { inputTokens, outputTokens, costUsd, needsConfirm, reasons[] }
  PN.estimateAnalysis = function (opts) {
    var inputTokens = opts.inputTokens != null ? opts.inputTokens : PN.estimateTokens(opts.inputText || '');
    var outputTokens = PN.STAGES[opts.stage].expectedOutput + (opts.stage === 'fulltext' && opts.statsMode ? PN.STATS_EXTRA_OUTPUT : 0);
    var costUsd = PN.computeCost(opts.modelId, inputTokens, outputTokens);
    var reasons = [];
    if (costUsd >= PN.CONFIRM_COST_USD) reasons.push('cost');
    if (inputTokens >= PN.CONFIRM_INPUT_TOKENS) reasons.push('input');
    return { inputTokens: inputTokens, outputTokens: outputTokens, costUsd: costUsd, needsConfirm: reasons.length > 0, reasons: reasons };
  };

  // 화면에 보일 문장: "약 1센트", "약 0.4센트", "0.1센트 미만", "약 $1.2"
  PN.formatCost = function (usd) {
    var cents = usd * 100;
    if (cents < 0.1) return '0.1센트 미만';
    if (cents < 1) return '약 ' + cents.toFixed(1) + '센트';
    if (cents < 100) return '약 ' + Math.round(cents) + '센트';
    return '약 $' + usd.toFixed(1);
  };
})(globalThis);
