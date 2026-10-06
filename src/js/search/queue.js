// 호출 대기열: 요청을 한 줄로 세워 최소 간격을 지킨다.
// arXiv는 3초에 1번(연결 1개), Semantic Scholar는 키가 있을 때 초당 1번이 기본 한도다.
// 중계 함수의 같은 이름 코드(supabase/functions/pn-search-proxy/gate.ts)와 같은 동작이다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  // 반환값의 wait()를 호출하면, 앞선 호출과의 간격이 지켜질 때 풀리는 약속을 돌려준다.
  PN.createQueue = function (minIntervalMs, now, sleep) {
    var tail = Promise.resolve();
    var last = -Infinity;
    return {
      wait: function () {
        var run = tail.then(function () {
          var delay = last + minIntervalMs - now();
          return (delay > 0 ? sleep(delay) : Promise.resolve()).then(function () { last = now(); });
        });
        tail = run.catch(function () {});
        return run;
      }
    };
  };
})(globalThis);
