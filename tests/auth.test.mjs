import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/auth.js');
const { PN } = globalThis;

test('validateLogin: 비어 있거나 형식이 틀리면 메시지, 올바르면 null', () => {
  assert.equal(PN.validateLogin('', 'x'), '이메일을 입력하세요.');
  assert.equal(PN.validateLogin('   ', 'x'), '이메일을 입력하세요.');
  assert.equal(PN.validateLogin('abc', 'x'), '이메일 형식이 올바르지 않습니다.');
  assert.equal(PN.validateLogin('a@b', 'x'), '이메일 형식이 올바르지 않습니다.');
  assert.equal(PN.validateLogin('a@b.co', ''), '비밀번호를 입력하세요.');
  assert.equal(PN.validateLogin(' a@b.co ', 'x'), null);
});

test('validateLogin: 비밀번호 길이는 검사하지 않는다 (이전에 만든 짧은 비밀번호 계정 허용)', () => {
  assert.equal(PN.validateLogin('a@b.co', '1'), null);
});

test('authErrorMessage: 오류 종류별 문장', () => {
  assert.equal(PN.authErrorMessage({ code: 'invalid_credentials' }), '이메일 또는 비밀번호가 맞지 않습니다.');
  assert.equal(PN.authErrorMessage({ message: 'Invalid login credentials' }), '이메일 또는 비밀번호가 맞지 않습니다.');
  assert.match(PN.authErrorMessage({ code: 'email_not_confirmed' }), /이메일 확인/);
  assert.match(PN.authErrorMessage({ status: 429 }), /너무 많습니다/);
  assert.match(PN.authErrorMessage({ message: 'Failed to fetch' }), /네트워크/);
  assert.match(PN.authErrorMessage({ name: 'AuthRetryableFetchError', message: '' }), /네트워크/);
  assert.match(PN.authErrorMessage(null), /로그인하지 못했습니다/);
});

test('authErrorMessage: 이메일 존재 여부를 드러내는 문장이 없다', () => {
  const all = [
    PN.authErrorMessage({ code: 'invalid_credentials' }),
    PN.authErrorMessage({ message: 'User not found' }),
    PN.authErrorMessage({ message: 'Wrong password' }),
  ];
  for (const m of all) assert.doesNotMatch(m, /존재|가입되지|찾을 수/);
});

const session = { user: { id: 'u1', email: 'session@x.co' } };

test('accessState: 세션이 없으면 signed-out', () => {
  assert.deepEqual(PN.accessState(null), { state: 'signed-out' });
});

test('accessState: 프로필 상태별 결과', () => {
  assert.deepEqual(
    PN.accessState(session, { email: 'a@x.co', status: 'approved', is_admin: true }),
    { state: 'approved', email: 'a@x.co', isAdmin: true });
  assert.deepEqual(
    PN.accessState(session, { email: 'a@x.co', status: 'approved', is_admin: false }),
    { state: 'approved', email: 'a@x.co', isAdmin: false });
  assert.deepEqual(
    PN.accessState(session, { email: 'a@x.co', status: 'pending', is_admin: false }),
    { state: 'pending', email: 'a@x.co', isAdmin: false });
  assert.deepEqual(
    PN.accessState(session, { email: 'a@x.co', status: 'rejected', is_admin: false }),
    { state: 'rejected', email: 'a@x.co', isAdmin: false });
});

test('accessState: 승인되지 않은 계정은 is_admin이 true여도 관리자로 보지 않는다', () => {
  assert.equal(PN.accessState(session, { email: 'a@x.co', status: 'pending', is_admin: true }).isAdmin, false);
  assert.equal(PN.accessState(session, { email: 'a@x.co', status: 'rejected', is_admin: true }).isAdmin, false);
});

test('accessState: 프로필이 없거나 오류이거나 모르는 상태면 error (접근을 열어 주지 않는다)', () => {
  assert.deepEqual(PN.accessState(session, null, null), { state: 'error' });
  assert.deepEqual(PN.accessState(session, undefined, { message: 'x' }), { state: 'error' });
  assert.deepEqual(PN.accessState(session, { email: 'a', status: 'approved' }, { message: 'x' }), { state: 'error' });
  assert.deepEqual(PN.accessState(session, { email: 'a', status: 'whatever' }), { state: 'error' });
});

test('accessState: 프로필에 이메일이 없으면 세션의 이메일을 쓴다', () => {
  assert.equal(PN.accessState(session, { status: 'pending' }).email, 'session@x.co');
});

// ---- createAuth: 가짜 Supabase 클라이언트로 호출 연결을 확인
function fakeSupabase({ sessionValue = null, profile = null, profileError = null, signInError = null } = {}) {
  const calls = { created: null, signIn: null, signOut: null, query: null, listeners: [] };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: sessionValue } }),
      signInWithPassword: async (args) => { calls.signIn = args; return { error: signInError }; },
      signOut: async (args) => { calls.signOut = args; return { error: null }; },
      onAuthStateChange: (fn) => { calls.listeners.push(fn); },
    },
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({
          maybeSingle: async () => { calls.query = { table, cols, col, val }; return { data: profile, error: profileError }; },
        }),
      }),
    }),
  };
  return { calls, sb: { createClient: (url, key) => { calls.created = { url, key }; return client; } } };
}

const config = { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'sb_publishable_test' };

test('createAuth: 설정 값으로 클라이언트를 만든다', () => {
  const { sb, calls } = fakeSupabase();
  PN.createAuth(sb, config);
  assert.deepEqual(calls.created, { url: config.supabaseUrl, key: config.supabaseKey });
});

test('createAuth.load: 세션이 없으면 프로필을 조회하지 않는다', async () => {
  const { sb, calls } = fakeSupabase();
  assert.deepEqual(await PN.createAuth(sb, config).load(), { state: 'signed-out' });
  assert.equal(calls.query, null);
});

test('createAuth.load: 세션이 있으면 본인 프로필(pn_profiles)을 조회한다', async () => {
  const { sb, calls } = fakeSupabase({ sessionValue: session, profile: { email: 'a@x.co', status: 'approved', is_admin: true } });
  const result = await PN.createAuth(sb, config).load();
  assert.deepEqual(result, { state: 'approved', email: 'a@x.co', isAdmin: true });
  assert.deepEqual(calls.query, { table: 'pn_profiles', cols: 'email,status,is_admin', col: 'id', val: 'u1' });
});

test('createAuth.signIn: 이메일 공백을 지우고 성공이면 null, 실패면 오류를 돌려준다', async () => {
  const ok = fakeSupabase();
  assert.equal(await PN.createAuth(ok.sb, config).signIn('  a@x.co ', 'pw'), null);
  assert.deepEqual(ok.calls.signIn, { email: 'a@x.co', password: 'pw' });
  const err = { code: 'invalid_credentials' };
  const bad = fakeSupabase({ signInError: err });
  assert.equal(await PN.createAuth(bad.sb, config).signIn('a@x.co', 'pw'), err);
});

test('createAuth.signOut: 이 기기의 세션만 끝낸다 (scope local)', async () => {
  const { sb, calls } = fakeSupabase();
  await PN.createAuth(sb, config).signOut();
  assert.deepEqual(calls.signOut, { scope: 'local' });
});

test('createAuth.onChange: 인증 상태가 바뀌면 콜백을 한 박자 늦게 부른다', async () => {
  const { sb, calls } = fakeSupabase();
  let called = 0;
  PN.createAuth(sb, config).onChange(() => { called += 1; });
  calls.listeners[0]();
  assert.equal(called, 0, '같은 틱에서 바로 호출하면 안 됨');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(called, 1);
});
