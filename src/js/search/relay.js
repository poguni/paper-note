// 검색 중계 함수(pn-search-proxy) 호출. 브라우저가 arXiv와 Semantic Scholar를 직접 부를 수 없어서 이 함수를 거친다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  function relayError(code, status, retryAfter) {
    var e = new Error(code);
    e.name = 'RelayError';
    e.code = code;
    e.status = status;
    e.retryAfter = retryAfter || null;
    return e;
  }

  // cfg: { url, apikey, getToken: () => Promise<string|null>, fetch }
  PN.createRelay = function (cfg) {
    return {
      // op: 'arxiv_search' | 's2_search' | 's2_batch'. arXiv는 XML 문자열, 나머지는 JSON 값을 돌려준다.
      call: async function (op, params) {
        var token = await cfg.getToken();
        if (!token) throw relayError('unauthorized', 401);

        var res;
        try {
          res = await cfg.fetch(cfg.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: cfg.apikey, Authorization: 'Bearer ' + token },
            body: JSON.stringify({ op: op, params: params })
          });
        } catch (e) {
          throw relayError('network', 0);
        }

        if (!res.ok) {
          var detail = null;
          try { detail = (await res.json()).error; } catch (e) { /* 본문이 JSON이 아닌 오류 */ }
          throw relayError((detail && detail.code) || 'upstream_error', res.status, detail && detail.retry_after);
        }
        var type = res.headers.get('content-type') || '';
        return type.indexOf('json') >= 0 ? res.json() : res.text();
      }
    };
  };

  // 사용자에게 보일 문장
  PN.relayErrorMessage = function (e) {
    switch (e && e.code) {
      case 'unauthorized': return '로그인이 필요합니다. 설정에서 로그인하세요.';
      case 'not_approved': return '관리자가 승인한 계정만 검색할 수 있습니다.';
      case 'network': return '네트워크 오류로 검색하지 못했습니다.';
      case 'upstream_rate_limited':
        return '검색 서비스의 호출 한도에 걸렸습니다.' + (e.retryAfter ? ' ' + e.retryAfter + '초 뒤에 다시 시도하세요.' : ' 잠시 뒤에 다시 시도하세요.');
      case 'upstream_timeout': return '검색 서비스의 응답이 늦습니다. 잠시 뒤에 다시 시도하세요.';
      case 'bad_request': return '검색 조건이 올바르지 않습니다.';
      default: return '검색 서비스에 문제가 생겼습니다. 잠시 뒤에 다시 시도하세요.';
    }
  };
})(globalThis);
