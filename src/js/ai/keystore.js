// OpenRouter API 키 보관. 탭을 닫으면 지워지는 sessionStorage에만 둔다. (localStorage, Supabase, 소스 코드에는 두지 않는다)
// 키는 openrouter.ai로 가는 요청의 Authorization 헤더에만 쓰이고(openrouter.js), 화면이나 로그에 출력하지 않는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var STORAGE_KEY = 'pn_openrouter_key';

  // 문제가 있으면 사용자에게 보일 문장, 괜찮으면 null. 키 내용은 문장에 넣지 않는다.
  PN.validateKey = function (key) {
    key = String(key || '').trim();
    if (!key) return '키를 입력하세요.';
    if (!/^sk-or-[A-Za-z0-9_-]{10,}$/.test(key)) return 'OpenRouter 키 형식이 아닙니다. sk-or-로 시작하는 키를 입력하세요.';
    return null;
  };

  // storage: 보통 window.sessionStorage. 시험에서는 같은 모양의 가짜를 넣는다.
  // 접근이 막힌 환경(시크릿 창, 저장소 차단)에서는 예외가 날 수 있어 모두 감싼다.
  PN.createKeyStore = function (storage) {
    return {
      get: function () {
        try { return storage.getItem(STORAGE_KEY) || null; } catch (e) { return null; }
      },
      has: function () { return this.get() !== null; },
      // 성공하면 null, 실패하면 사용자에게 보일 문장
      set: function (key) {
        var problem = PN.validateKey(key);
        if (problem) return problem;
        try { storage.setItem(STORAGE_KEY, String(key).trim()); } catch (e) { return '이 브라우저에서는 키를 보관할 수 없습니다.'; }
        return null;
      },
      clear: function () {
        try { storage.removeItem(STORAGE_KEY); } catch (e) { /* 지울 것이 없거나 접근 불가 */ }
      }
    };
  };
})(globalThis);
