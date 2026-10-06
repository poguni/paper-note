// 앱 상태와 화면 주소 해석 (순수 로직, 화면과 무관)
(function (g) {
  var PN = (g.PN = g.PN || {});
  var SCREENS = ['search', 'library', 'settings'];

  PN.SCREENS = SCREENS;

  // '#library' → 'library'. 알 수 없는 값이면 'search'
  PN.parseScreen = function (hash) {
    var name = String(hash || '').replace(/^#/, '');
    return SCREENS.indexOf(name) >= 0 ? name : 'search';
  };

  PN.createStore = function (initial) {
    var state = Object.assign({}, initial);
    var listeners = [];
    return {
      get: function () { return state; },
      set: function (patch) {
        state = Object.assign({}, state, patch);
        listeners.forEach(function (fn) { fn(state); });
      },
      subscribe: function (fn) { listeners.push(fn); }
    };
  };
})(globalThis);
