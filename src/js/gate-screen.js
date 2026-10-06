// 첫 화면(스플래시 + 로그인 + 회원가입)과 승인 대기·거절·오류 화면. 앱 메뉴가 보이기 전에 계정 상태를 가리는 관문이다. (DESIGN.md 5.12, 5.13)
(function (g) {
  var PN = (g.PN = g.PN || {});
  var $ = function (sel) { return document.querySelector(sel); };

  // 계정 상태 → 관문 화면. null이면 관문을 열어 앱을 보여 준다.
  //   splash: 로고만 / auth: 로그인·회원가입 / pending / rejected / error
  PN.gateViewFor = function (authState, splashActive) {
    switch (authState) {
      case 'loading': return 'splash';
      case 'approved': return splashActive ? 'splash' : null;
      case 'signed-out': return 'auth';
      case 'pending': return 'pending';
      case 'rejected': return 'rejected';
      default: return 'error';
    }
  };

  // ctx: { auth: PN.createAuth() 결과(없을 수 있음), refresh: 계정 상태를 다시 읽는다, logout: 로그아웃한다 }
  PN.initGate = function (ctx) {
    var els = {
      gate: $('#gate'), card: $('#gate-card'),
      loginForm: $('#login-form'), loginEmail: $('#login-email'), loginPw: $('#login-password'), loginErr: $('#login-error'), loginBtn: $('#login-submit'),
      signupForm: $('#signup-form'), signupEmail: $('#signup-email'), signupPw: $('#signup-password'), signupConfirm: $('#signup-confirm'),
      signupErr: $('#signup-error'), signupBtn: $('#signup-submit'),
      pendingEmail: $('#pending-email'), rejectedEmail: $('#rejected-email'), refresh: $('#gate-refresh'), status: $('#gate-status'), retry: $('#gate-retry')
    };
    var mode = 'login'; // signed-out일 때 보이는 화면: login | signup | signup-done
    var last = { view: null, auth: null };

    function showMessage(el, text) {
      el.textContent = text || '';
      el.hidden = !text;
    }

    // 지금 보여 줄 카드 안의 화면 이름
    function innerView(view) {
      return view === 'auth' ? mode : view;
    }

    function show(view, auth) {
      last = { view: view, auth: auth };
      var on = !!view;
      els.gate.hidden = !on;
      if (!on) return;
      var splash = view === 'splash';
      els.card.hidden = splash;
      var name = innerView(view);
      document.querySelectorAll('[data-gate-view]').forEach(function (el) { el.hidden = splash || el.dataset.gateView !== name; });
      if (auth && auth.email) {
        els.pendingEmail.textContent = auth.email;
        els.rejectedEmail.textContent = auth.email;
      }
      if (name === 'login' && !els.loginEmail.value) setTimeout(function () { els.loginEmail.focus(); }, 0);
    }

    function goto(next) {
      mode = next;
      showMessage(els.loginErr, '');
      showMessage(els.signupErr, '');
      show('auth', last.auth);
      var first = next === 'signup' ? els.signupEmail : next === 'login' ? els.loginEmail : null;
      if (first) first.focus();
    }

    document.querySelectorAll('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { goto(b.dataset.goto); }); });
    document.querySelectorAll('[data-logout]').forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true;
        try { await ctx.logout(); } finally { b.disabled = false; }
      });
    });

    // 비밀번호 보이기·숨기기 (글씨가 바뀌는 버튼. 색만으로 구분하지 않는다)
    document.querySelectorAll('[data-pw-for]').forEach(function (b) {
      b.addEventListener('click', function () {
        var input = document.getElementById(b.dataset.pwFor);
        var visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        b.textContent = visible ? '보이기' : '숨기기';
        b.setAttribute('aria-pressed', visible ? 'false' : 'true');
      });
    });

    els.loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (els.loginBtn.disabled) return;
      var invalid = PN.validateLogin(els.loginEmail.value, els.loginPw.value);
      if (invalid) { showMessage(els.loginErr, invalid); return; }
      if (!ctx.auth) { showMessage(els.loginErr, '로그인 기능을 불러오지 못했습니다. 새로고침해 보세요.'); return; }
      els.loginBtn.disabled = true;
      showMessage(els.loginErr, '');
      var error;
      try { error = await ctx.auth.signIn(els.loginEmail.value, els.loginPw.value); } catch (err) { error = err; }
      els.loginBtn.disabled = false;
      if (error) { showMessage(els.loginErr, PN.authErrorMessage(error)); return; }
      els.loginPw.value = '';
      await ctx.refresh();
    });

    els.signupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (els.signupBtn.disabled) return;
      var invalid = PN.validateSignup(els.signupEmail.value, els.signupPw.value, els.signupConfirm.value);
      if (invalid) { showMessage(els.signupErr, invalid); return; }
      if (!ctx.auth) { showMessage(els.signupErr, '가입 기능을 불러오지 못했습니다. 새로고침해 보세요.'); return; }
      els.signupBtn.disabled = true;
      showMessage(els.signupErr, '');
      var out;
      try { out = await ctx.auth.signUp(els.signupEmail.value, els.signupPw.value); } catch (err) { out = { error: err, session: null }; }
      els.signupBtn.disabled = false;
      if (out.error) { showMessage(els.signupErr, PN.signupErrorMessage(out.error)); return; }
      els.signupPw.value = '';
      els.signupConfirm.value = '';
      if (out.session) { // 확인 메일을 끈 설정: 가입 즉시 로그인된 상태가 되어 승인 대기 화면으로 이어진다
        mode = 'login';
        await ctx.refresh();
      } else {
        goto('signup-done');
      }
    });

    els.refresh.addEventListener('click', async function () {
      els.refresh.disabled = true;
      showMessage(els.status, '');
      await ctx.refresh();
      els.refresh.disabled = false;
      if (last.view === 'pending') showMessage(els.status, '아직 승인되지 않았습니다. 잠시 뒤에 다시 확인하세요.');
    });
    els.retry.addEventListener('click', function () { ctx.refresh(); });

    return {
      // 앱 상태가 바뀔 때마다 부른다
      render: function (view, auth) {
        if (view === 'auth' && last.view !== 'auth') mode = 'login'; // 로그아웃 뒤에는 로그인 화면부터
        if (view !== 'pending') showMessage(els.status, '');
        show(view, auth);
      }
    };
  };
})(globalThis);
