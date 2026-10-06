// 테마 초기화. <head> 맨 위에서 인라인으로 실행되어 첫 화면이 깜빡이지 않게 한다. (DESIGN.md 2)
// 저장값(localStorage의 pn_theme)을 읽어 <html data-theme>에 먼저 적용하고, 선택된 테마의 글꼴만 불러온다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var STORAGE_KEY = 'pn_theme';
  var DEFAULT_THEME = 'academic';
  var FONTS = {
    academic: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@500;700&display=swap',
    education: 'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Gowun+Dodum&display=swap'
  };

  PN.THEMES = Object.keys(FONTS);

  // 저장값이 없거나 잘못되었거나 저장소 접근이 막혀 있으면 academic
  PN.readTheme = function (storage) {
    try {
      var value = storage.getItem(STORAGE_KEY);
      return Object.prototype.hasOwnProperty.call(FONTS, value) ? value : DEFAULT_THEME;
    } catch (e) {
      return DEFAULT_THEME;
    }
  };

  // 설정 화면의 선택 목록에 보일 이름과 설명
  PN.THEME_INFO = {
    academic: { short: '학술용', label: '학술용', note: '남색 사이드바와 3열 배치. 논문을 많이 훑어볼 때 알맞습니다.' },
    education: { short: '교육용', label: '교육용 (따뜻한 서재)', note: '상단 단계 표시와 2열 배치, 부드러운 색. 차분히 읽고 공부할 때 알맞습니다.' }
  };

  // 지금과 다른 테마 (빠른 전환 버튼용)
  PN.otherTheme = function (theme) {
    return theme === 'education' ? 'academic' : 'education';
  };

  // 선택을 저장한다. 저장소 접근이 막혀 있으면 false (이번 화면에는 그대로 적용된다)
  PN.saveTheme = function (theme, storage) {
    if (!Object.prototype.hasOwnProperty.call(FONTS, theme)) return false;
    try {
      storage.setItem(STORAGE_KEY, theme);
      return true;
    } catch (e) {
      return false;
    }
  };

  PN.applyTheme = function (theme, doc) {
    if (!Object.prototype.hasOwnProperty.call(FONTS, theme)) theme = DEFAULT_THEME;
    doc.documentElement.dataset.theme = theme;
    var id = 'pn-font-' + theme;
    if (!doc.getElementById(id)) {
      var link = doc.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = FONTS[theme];
      doc.head.appendChild(link);
    }
    return theme;
  };

  if (typeof document !== 'undefined') {
    var storage;
    try { storage = g.localStorage; } catch (e) { /* 저장소 접근이 막힌 환경 */ }
    PN.applyTheme(PN.readTheme(storage), document);
  }
})(globalThis);
