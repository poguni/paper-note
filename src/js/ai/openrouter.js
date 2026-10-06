// OpenRouter 호출. 키는 이 파일의 요청 한 곳(Authorization 헤더)에만 쓰고, 요청 주소는 openrouter.ai로 고정한다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  PN.OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

  function aiError(code, status) {
    var e = new Error(code);
    e.name = 'OpenRouterError';
    e.code = code;
    e.status = status || 0;
    return e;
  }

  var BY_STATUS = { 401: 'unauthorized', 402: 'insufficient_credit', 403: 'forbidden', 408: 'timeout', 429: 'rate_limited', 504: 'timeout' };

  // cfg: { getKey: () => string|null, fetch }
  PN.createOpenRouter = function (cfg) {
    return {
      // body: PN.buildRequestBody()의 결과. signal은 취소용(AbortController). 응답 JSON을 돌려준다.
      chat: async function (body, signal) {
        var key = cfg.getKey();
        if (!key) throw aiError('no_key');
        var res;
        try {
          res = await cfg.fetch(PN.OPENROUTER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
            body: JSON.stringify(body),
            signal: signal
          });
        } catch (e) {
          throw aiError(e && e.name === 'AbortError' ? 'aborted' : 'network');
        }
        if (!res.ok) throw aiError(BY_STATUS[res.status] || 'upstream', res.status);
        var json;
        try { json = await res.json(); } catch (e) { throw aiError('bad_response', res.status); }
        // 제공사 오류는 HTTP 200 안의 error 항목으로 올 수도 있다
        if (json && json.error) throw aiError(BY_STATUS[json.error.code] || 'upstream', Number(json.error.code) || 0);
        return json;
      }
    };
  };

  // 사용자에게 보일 문장. 서버가 보낸 오류 문장은 그대로 보이지 않는다.
  PN.openrouterErrorMessage = function (e) {
    switch (e && e.code) {
      case 'no_key': return 'OpenRouter API 키를 먼저 입력하세요.';
      case 'unauthorized': return 'API 키가 올바르지 않거나 만료되었습니다. 키를 다시 입력하세요.';
      case 'insufficient_credit': return 'OpenRouter 크레딧이 부족합니다. 잔액이나 키의 사용 한도를 확인하세요.';
      case 'forbidden': return '이 요청은 OpenRouter가 허용하지 않았습니다. 키의 설정과 한도를 확인하세요.';
      case 'rate_limited': return '요청이 너무 많습니다. 잠시 뒤에 다시 시도하세요.';
      case 'timeout': return '모델의 응답이 늦습니다. 잠시 뒤에 다시 시도하세요.';
      case 'network': return '네트워크 오류로 분석하지 못했습니다.';
      case 'aborted': return '분석을 취소했습니다.';
      default: return 'AI 서비스에 문제가 생겼습니다. 잠시 뒤에 다시 시도하세요.';
    }
  };
})(globalThis);
