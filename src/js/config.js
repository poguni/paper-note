// Supabase 연결 정보. 공개용(publishable) 키는 브라우저에 노출되도록 설계된 값이며,
// 데이터는 RLS가 지킨다. 비밀 키(secret, 서비스 역할)는 어떤 경우에도 여기에 넣지 않는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  PN.config = Object.freeze({
    supabaseUrl: 'https://ishkdpdejwlqurfkciyn.supabase.co',
    supabaseKey: 'sb_publishable_0jRvIFceiJu59_DxDO6UKA_XcB3yjNH'
  });
})(globalThis);
