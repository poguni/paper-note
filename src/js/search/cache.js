// 검색 결과 캐시: 같은 검색어와 필터는 다시 호출하지 않는다. 시간이 지나면 만료되고, 가득 차면 오래 안 쓴 것부터 버린다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  // 키 순서와 관계없이 같은 내용이면 같은 문자열
  PN.cacheKey = function (value) {
    return JSON.stringify(value, function (k, v) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.keys(v).sort().reduce(function (o, key) { o[key] = v[key]; return o; }, {});
      }
      return v;
    });
  };

  // opts: { ttlMs, max, now }
  PN.createCache = function (opts) {
    var ttl = opts.ttlMs;
    var max = opts.max;
    var now = opts.now || Date.now;
    var map = new Map(); // 삽입 순서 = 오래 안 쓴 순서

    return {
      get: function (key) {
        var hit = map.get(key);
        if (!hit) return undefined;
        if (now() - hit.at > ttl) { map.delete(key); return undefined; }
        map.delete(key);
        map.set(key, hit); // 방금 썼으니 맨 뒤로
        return hit.value;
      },
      set: function (key, value) {
        map.delete(key);
        map.set(key, { value: value, at: now() });
        while (map.size > max) map.delete(map.keys().next().value);
      },
      clear: function () { map.clear(); },
      size: function () { return map.size; }
    };
  };
})(globalThis);
