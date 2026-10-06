// 로그인과 가입 승인 상태. 판단 로직은 순수 함수로 두고, Supabase 호출은 createAuth 안에만 둔다.
(function (g) {
  var PN = (g.PN = g.PN || {});

  // 로그인 폼 검사. 비밀번호 길이는 검사하지 않는다: 8자 규칙은 새 비밀번호에만 적용되어
  // 이전에 만든 계정은 더 짧을 수 있다. 길이 검사는 회원가입에서 한다.
  PN.validateLogin = function (email, password) {
    email = String(email || '').trim();
    if (!email) return '이메일을 입력하세요.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '이메일 형식이 올바르지 않습니다.';
    if (!password) return '비밀번호를 입력하세요.';
    return null;
  };

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  PN.MIN_PASSWORD = 8;

  // 회원가입 폼 검사. 문제가 있으면 사용자에게 보일 문장, 괜찮으면 null.
  // 비밀번호 길이 규칙은 새 비밀번호에만 적용된다(로그인 폼은 길이를 검사하지 않는다).
  PN.validateSignup = function (email, password, confirm) {
    email = String(email || '').trim();
    if (!email) return '이메일을 입력하세요.';
    if (!EMAIL_RE.test(email)) return '이메일 형식이 올바르지 않습니다.';
    if (!password) return '비밀번호를 입력하세요.';
    if (String(password).length < PN.MIN_PASSWORD) return '비밀번호는 ' + PN.MIN_PASSWORD + '자 이상이어야 합니다.';
    if (password !== confirm) return '비밀번호 확인이 일치하지 않습니다.';
    return null;
  };

  // 회원가입 오류 문장. 서버가 보낸 문장은 그대로 보이지 않는다.
  PN.signupErrorMessage = function (error) {
    var code = (error && error.code) || '';
    var message = String((error && error.message) || '');
    if (code === 'user_already_exists' || /already registered|already been registered/i.test(message)) {
      return '이 이메일로는 가입할 수 없습니다. 이미 가입했다면 로그인하세요.';
    }
    if (code === 'weak_password' || /password/i.test(message) && /(short|weak|least|characters)/i.test(message)) {
      return '비밀번호가 너무 약합니다. ' + PN.MIN_PASSWORD + '자 이상으로 더 복잡하게 만드세요.';
    }
    if (code === 'signup_disabled' || /signups? (not allowed|disabled)/i.test(message)) return '지금은 가입 신청을 받지 않습니다.';
    if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || (error && error.status === 429)) {
      return '시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
    }
    if (/failed to fetch|network|retryable/i.test(message + ' ' + ((error && error.name) || ''))) return '네트워크 오류로 가입 신청을 하지 못했습니다.';
    return '가입 신청을 하지 못했습니다. 잠시 후 다시 시도하세요.';
  };

  // Supabase Auth 오류를 사용자에게 보일 문장으로. 이메일이 있는지 없는지는 드러내지 않는다.
  PN.authErrorMessage = function (error) {
    var code = (error && error.code) || '';
    var message = String((error && error.message) || '');
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
      return '이메일 또는 비밀번호가 맞지 않습니다.';
    }
    if (code === 'email_not_confirmed') return '이메일 확인이 필요한 계정입니다. 관리자에게 문의하세요.';
    if (code === 'over_request_rate_limit' || (error && error.status === 429)) {
      return '시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
    }
    if (/failed to fetch|network|retryable/i.test(message + ' ' + ((error && error.name) || ''))) {
      return '네트워크 오류로 로그인하지 못했습니다.';
    }
    return '로그인하지 못했습니다. 잠시 후 다시 시도하세요.';
  };

  // 세션과 프로필로 접근 상태를 정한다.
  //   signed-out | approved | pending | rejected | error
  PN.accessState = function (session, profile, profileError) {
    if (!session) return { state: 'signed-out' };
    if (profileError || !profile) return { state: 'error' };
    var email = profile.email || (session.user && session.user.email) || '';
    if (profile.status === 'approved') return { state: 'approved', email: email, isAdmin: profile.is_admin === true };
    if (profile.status === 'pending' || profile.status === 'rejected') {
      return { state: profile.status, email: email, isAdmin: false };
    }
    return { state: 'error' };
  };

  // sb: Supabase 라이브러리(전역 supabase), config: PN.config
  PN.createAuth = function (sb, config) {
    var client = sb.createClient(config.supabaseUrl, config.supabaseKey);
    return {
      client: client,
      // 성공하면 null, 실패하면 오류 객체
      signIn: async function (email, password) {
        var res = await client.auth.signInWithPassword({ email: String(email).trim(), password: password });
        return res.error;
      },
      // 가입 신청. → { error, session }. 확인 메일을 끈 설정이면 가입 즉시 세션이 생기고(승인 대기 상태로 이어짐),
      // 세션이 없으면 확인 메일이 켜져 있는 설정이다.
      signUp: async function (email, password) {
        var res = await client.auth.signUp({ email: String(email).trim(), password: password });
        return { error: res.error, session: (res.data && res.data.session) || null };
      },
      // 이 기기의 세션만 끝낸다. (기본값은 모든 기기에서 로그아웃)
      signOut: async function () {
        await client.auth.signOut({ scope: 'local' });
      },
      load: async function () {
        var s = await client.auth.getSession();
        var session = s.data && s.data.session;
        if (!session) return PN.accessState(null);
        var p = await client.from('pn_profiles').select('email,status,is_admin').eq('id', session.user.id).maybeSingle();
        return PN.accessState(session, p.data, p.error);
      },
      // 콜백 안에서 Supabase를 바로 호출하면 멈출 수 있어서 한 박자 늦춘다.
      onChange: function (fn) {
        client.auth.onAuthStateChange(function () { setTimeout(fn, 0); });
      }
    };
  };
})(globalThis);
