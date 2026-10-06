// 앱 껍데기: 주소의 해시(#search, #library, #settings)에 따라 화면을 바꾸고, 계정 상태에 따라 첫 화면(관문)을 보여 준다.
(function () {
  var store = PN.createStore({ screen: PN.parseScreen(location.hash), auth: { state: 'loading' } });

  var $ = function (sel) { return document.querySelector(sel); };
  var els = {
    chip: $('#account-chip'), steps: $('#steps'), email: $('#account-email'), admin: $('#account-admin'), note: $('#account-note'), logout: $('#logout')
  };

  var STATUS_TEXT = {
    approved: { chip: '승인됨', note: '' },
    pending: { chip: '승인 대기', note: '관리자가 승인하면 사용할 수 있습니다.' },
    rejected: { chip: '승인 거절', note: '가입이 승인되지 않았습니다. 관리자에게 문의하세요.' }
  };

  // 설정 화면의 계정 구역 (승인된 계정만 설정 화면에 들어오므로 정보와 로그아웃만 있다)
  function renderAccount(auth) {
    var view = STATUS_TEXT[auth.state] ? 'account' : 'none';
    document.querySelectorAll('[data-auth-view]').forEach(function (el) {
      el.hidden = el.dataset.authView !== view;
    });
    if (view === 'account') {
      els.chip.textContent = STATUS_TEXT[auth.state].chip;
      els.chip.dataset.status = auth.state;
      els.email.textContent = auth.email;
      els.admin.hidden = !auth.isAdmin;
      els.note.textContent = STATUS_TEXT[auth.state].note;
      els.note.hidden = !STATUS_TEXT[auth.state].note;
    }
  }

  // 상단 4단계 표시: 화면과 지금 열린 논문의 상태에서 현재 단계를 계산한다 (DESIGN.md 4.3). 다른 화면의 상세에 열린 논문은 세지 않는다.
  var shownStep = -1;
  function updateSteps() {
    var screen = store.get().screen;
    var info = analysis.progress();
    var section = info.box && info.box.closest('[data-screen]');
    var onScreen = !!section && section.dataset.screen === screen;
    var step = PN.currentStep({ screen: screen, hasPaper: onScreen && info.hasPaper, saved: onScreen && info.saved, analyzed: onScreen && info.analyzed });
    if (step === shownStep) return;
    shownStep = step;
    PN.renderSteps(els.steps, step);
  }

  // 앱을 처음 열 때 로고만 잠깐 보여 준다 (이미 로그인된 승인 계정). 로그인 직후에는 건너뛴다.
  var SPLASH_MS = 900;
  var splashUntil = Date.now() + SPLASH_MS;
  var splashTimer = null;

  function render(state) {
    // 첫 화면(관문): 승인된 계정이 아니면 앱 메뉴 대신 이 화면만 보인다
    var splashActive = Date.now() < splashUntil;
    var view = PN.gateViewFor(state.auth.state, splashActive);
    document.body.dataset.gate = view ? 'on' : 'off';
    gate.render(view, state.auth);
    if (state.auth.state === 'approved' && splashActive && !splashTimer) {
      splashTimer = setTimeout(function () { splashTimer = null; render(store.get()); }, splashUntil - Date.now() + 20);
    }

    document.querySelectorAll('[data-screen]').forEach(function (el) {
      el.hidden = el.dataset.screen !== state.screen;
    });
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      if (el.dataset.nav === state.screen) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    renderAccount(state.auth);
    updateSteps();
    searchScreen.onAuth(state.auth);
    library.onState(state);
    presetManager.onState(state);
    adminScreen.onState(state);
    // 서재에서 저장을 취소했을 수 있고, 다른 화면이 그려지는 동안 분석 모듈이 검색 상세에서 떨어져 나갔을 수 있으므로,
    // 어느 화면에서든 검색 화면으로 돌아오면 저장 표시를 다시 읽고 상세를 다시 연결한다
    if (shownScreen !== 'search' && state.screen === 'search') searchScreen.refreshSaved();
    shownScreen = state.screen;
  }

  // ---- 로그인 ----
  var auth = null;
  try { auth = PN.createAuth(globalThis.supabase, PN.config); } catch (e) { /* 라이브러리를 못 불러온 경우 */ }

  async function refresh() {
    if (!auth) { store.set({ auth: { state: 'error' } }); return; }
    try { store.set({ auth: await auth.load() }); } catch (e) { store.set({ auth: { state: 'error' } }); }
  }

  async function logout() {
    try { if (auth) await auth.signOut(); } finally { await refresh(); }
  }

  var gate = PN.initGate({ auth: auth, refresh: refresh, logout: logout });

  // OpenRouter 키와 분석. 키는 탭 안(sessionStorage)에만 있고 openrouter.ai 요청에만 쓰인다.
  var session;
  try { session = globalThis.sessionStorage; session.getItem('pn_probe'); } catch (e) {
    var memory = {}; // 저장소 접근이 막힌 환경: 이 화면이 열려 있는 동안에만 메모리에 둔다
    session = { getItem: function (k) { return k in memory ? memory[k] : null; }, setItem: function (k, v) { memory[k] = String(v); }, removeItem: function (k) { delete memory[k]; } };
  }
  var keyStore = PN.createKeyStore(session);
  var pdf = PN.initPdf({ onChange: function () { analysis.refresh(); } });
  var analysis = PN.initAnalysis({
    pdf: pdf,
    client: PN.createOpenRouter({ getKey: keyStore.get, fetch: function (url, init) { return globalThis.fetch(url, init); } }),
    keyStore: keyStore,
    api: auth ? PN.createAnalysesApi(auth.client) : null,
    openKeyBox: function () { keyBox.open(); },
    select: document.querySelector('#model-select'),
    onProgress: updateSteps
  });
  var keyBox = PN.initKeyBox(keyStore, function () { analysis.onKeyChange(); });

  var searchScreen = PN.initSearchScreen({ auth: auth, store: store, analysis: analysis, pdf: pdf });
  var library = PN.initLibraryScreen({ auth: auth, analysis: analysis, pdf: pdf });
  var presetManager = PN.initPresetManager({ auth: auth, onChange: function () { searchScreen.reloadPresets(); } });
  var adminScreen = PN.initAdminScreen({ auth: auth });
  document.querySelector('#preset-add').addEventListener('click', function () {
    if (location.hash !== '#settings') location.hash = '#settings';
    presetManager.openAdd();
  });
  var shownScreen = store.get().screen;
  PN.initThemeSwitch();
  // 본문으로 건너뛰기: 주소의 해시가 화면 이름이라서 링크로 이동하지 않고 본문에 포커스만 옮긴다
  document.querySelector('#skip-link').addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector('#main-content').focus();
  });

  store.subscribe(render);
  window.addEventListener('hashchange', function () {
    store.set({ screen: PN.parseScreen(location.hash) });
  });

  els.logout.addEventListener('click', async function () {
    els.logout.disabled = true;
    try { await logout(); } finally { els.logout.disabled = false; }
  });

  if (auth) auth.onChange(refresh);

  render(store.get());
  refresh();
  document.documentElement.dataset.ready = '1';
})();
