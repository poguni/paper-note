import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/auth.js');
await import('../src/js/db/admin.js');
const PN = globalThis.PN;

// ---------------------------------------------------------------- 회원가입 입력 검사
test('validateSignup: 이메일, 비밀번호 8자 이상, 비밀번호 확인', () => {
  assert.equal(PN.validateSignup('', 'abcdefgh', 'abcdefgh'), '이메일을 입력하세요.');
  assert.equal(PN.validateSignup('abc', 'abcdefgh', 'abcdefgh'), '이메일 형식이 올바르지 않습니다.');
  assert.equal(PN.validateSignup('a@b.co', '', ''), '비밀번호를 입력하세요.');
  assert.match(PN.validateSignup('a@b.co', 'abcdefg', 'abcdefg'), /8자 이상/); // 7자
  assert.match(PN.validateSignup('a@b.co', 'abcdefgh', 'abcdefgX'), /일치하지 않습니다/);
  assert.equal(PN.validateSignup(' a@b.co ', 'abcdefgh', 'abcdefgh'), null); // 8자 경계, 이메일 공백은 허용
});

test('validateSignup: 비밀번호 길이는 글자 수로 센다 (한글도 1글자)', () => {
  assert.equal(PN.validateSignup('a@b.co', '가나다라마바사아', '가나다라마바사아'), null);
  assert.match(PN.validateSignup('a@b.co', '가나다라마바사', '가나다라마바사'), /8자 이상/);
});

test('signupErrorMessage: 오류 종류별 문장, 서버 문장은 그대로 보이지 않는다', () => {
  assert.match(PN.signupErrorMessage({ code: 'user_already_exists' }), /가입할 수 없습니다/);
  assert.match(PN.signupErrorMessage({ message: 'User already registered' }), /가입할 수 없습니다/);
  assert.match(PN.signupErrorMessage({ code: 'weak_password' }), /너무 약합니다/);
  assert.match(PN.signupErrorMessage({ message: 'Password should be at least 8 characters.' }), /너무 약합니다/);
  assert.match(PN.signupErrorMessage({ code: 'signup_disabled' }), /받지 않습니다/);
  assert.match(PN.signupErrorMessage({ status: 429 }), /너무 많습니다/);
  assert.match(PN.signupErrorMessage({ code: 'over_email_send_rate_limit' }), /너무 많습니다/);
  assert.match(PN.signupErrorMessage({ message: 'Failed to fetch' }), /네트워크/);
  assert.match(PN.signupErrorMessage(null), /가입 신청을 하지 못했습니다/);
  const raw = 'secret internal detail xyz';
  assert.ok(!PN.signupErrorMessage({ code: 'unexpected', message: raw }).includes(raw));
});

test('createAuth.signUp: 이메일을 다듬어 보내고 { error, session }을 돌려준다', async () => {
  const calls = [];
  const sb = {
    createClient: () => ({
      auth: {
        signUp: async (arg) => { calls.push(arg); return { data: { session: { access_token: 't' } }, error: null }; },
      },
    }),
  };
  const auth = PN.createAuth(sb, { supabaseUrl: 'u', supabaseKey: 'k' });
  const out = await auth.signUp('  a@b.co ', 'pw123456');
  assert.deepEqual(calls[0], { email: 'a@b.co', password: 'pw123456' });
  assert.deepEqual(out, { error: null, session: { access_token: 't' } });
});

test('createAuth.signUp: 세션이 없으면(확인 메일을 켠 설정) session은 null, 오류는 그대로 전달', async () => {
  const sb = { createClient: () => ({ auth: { signUp: async () => ({ data: { user: {}, session: null }, error: null }) } }) };
  assert.deepEqual(await PN.createAuth(sb, { supabaseUrl: 'u', supabaseKey: 'k' }).signUp('a@b.co', 'x'), { error: null, session: null });
  const err = { code: 'weak_password' };
  const sb2 = { createClient: () => ({ auth: { signUp: async () => ({ data: null, error: err }) } }) };
  assert.deepEqual(await PN.createAuth(sb2, { supabaseUrl: 'u', supabaseKey: 'k' }).signUp('a@b.co', 'x'), { error: err, session: null });
});

// ---------------------------------------------------------------- 관리자 승인 API
function fakeClient(handler) {
  const log = [];
  const client = {
    from(table) {
      const state = { table, filters: [] };
      const b = {
        select(cols, opts) { state.select = cols; state.opts = opts; return b; },
        update(row) { state.op = 'update'; state.row = row; return b; },
        eq(col, val) { state.filters.push([col, val]); return b; },
        order(col, opts) { state.order = [col, opts]; return b; },
        then(resolve, reject) { log.push({ ...state }); return Promise.resolve(handler({ ...state })).then(resolve, reject); },
      };
      return b;
    },
  };
  return { client, log };
}

test('admin.listProfiles: 신청일 최신순으로 필요한 열만 읽는다', async () => {
  const rows = [{ id: 'a', email: 'a@x.co', status: 'pending' }];
  const { client, log } = fakeClient(() => ({ data: rows, error: null }));
  assert.deepEqual(await PN.createAdminApi(client).listProfiles(), rows);
  assert.equal(log[0].table, 'pn_profiles');
  assert.deepEqual(log[0].order, ['created_at', { ascending: false }]);
  assert.ok(log[0].select.includes('email') && log[0].select.includes('status') && log[0].select.includes('is_admin'));
});

test('admin.listProfiles: 오류는 던지고, 빈 결과는 빈 목록', async () => {
  let c = fakeClient(() => ({ data: null, error: { code: 'x' } }));
  await assert.rejects(PN.createAdminApi(c.client).listProfiles(), (e) => e.code === 'x');
  c = fakeClient(() => ({ data: null, error: null }));
  assert.deepEqual(await PN.createAdminApi(c.client).listProfiles(), []);
});

test('admin.setStatus: status만 바꾸고, 바뀐 행이 있으면 true, 대상이 없거나 권한이 없으면 false', async () => {
  let c = fakeClient(() => ({ data: [{ id: 'p1' }], error: null }));
  assert.equal(await PN.createAdminApi(c.client).setStatus('p1', 'approved'), true);
  assert.deepEqual(c.log[0].row, { status: 'approved' });
  assert.deepEqual(c.log[0].filters, [['id', 'p1']]);
  c = fakeClient(() => ({ data: [], error: null })); // RLS가 막으면 0행
  assert.equal(await PN.createAdminApi(c.client).setStatus('p1', 'rejected'), false);
  c = fakeClient(() => ({ data: null, error: { code: '42501' } }));
  await assert.rejects(PN.createAdminApi(c.client).setStatus('p1', 'approved'), (e) => e.code === '42501');
});

test('admin.setStatus: 정해진 상태 값만 보낸다', async () => {
  const { client, log } = fakeClient(() => ({ data: [], error: null }));
  const api = PN.createAdminApi(client);
  for (const bad of ['admin', '', 'APPROVED', null]) await assert.rejects(api.setStatus('p1', bad), /알 수 없는 상태/);
  assert.equal(log.length, 0); // 잘못된 값은 요청 자체를 보내지 않는다
});

test('admin.countPending: 대기 건수만 센다 (본문 없이)', async () => {
  const { client, log } = fakeClient(() => ({ count: 3, data: null, error: null }));
  assert.equal(await PN.createAdminApi(client).countPending(), 3);
  assert.deepEqual(log[0].opts, { count: 'exact', head: true });
  assert.deepEqual(log[0].filters, [['status', 'pending']]);
  const none = fakeClient(() => ({ count: null, data: null, error: null }));
  assert.equal(await PN.createAdminApi(none.client).countPending(), 0);
  const bad = fakeClient(() => ({ error: { code: 'y' } }));
  await assert.rejects(PN.createAdminApi(bad.client).countPending(), (e) => e.code === 'y');
});

test('sortProfiles: 승인 대기가 맨 위, 같은 상태 안에서는 신청이 최근인 순, 원본은 그대로', () => {
  const rows = [
    { id: '1', status: 'approved', created_at: '2026-10-01' },
    { id: '2', status: 'pending', created_at: '2026-10-02' },
    { id: '3', status: 'rejected', created_at: '2026-10-05' },
    { id: '4', status: 'pending', created_at: '2026-10-04' },
    { id: '5', status: 'approved', created_at: '2026-10-03' },
  ];
  const before = rows.map((r) => r.id);
  assert.deepEqual(PN.sortProfiles(rows).map((r) => r.id), ['4', '2', '5', '1', '3']);
  assert.deepEqual(rows.map((r) => r.id), before);
});

test('profileStatusText', () => {
  assert.equal(PN.profileStatusText('pending'), '승인 대기');
  assert.equal(PN.profileStatusText('approved'), '승인됨');
  assert.equal(PN.profileStatusText('rejected'), '승인 거절');
});

// ---------------------------------------------------------------- 첫 화면(관문) 판단
await import('../src/js/gate-screen.js');

test('gateViewFor: 계정 상태별로 보여 줄 첫 화면을 정한다', () => {
  assert.equal(PN.gateViewFor('loading', false), 'splash');
  assert.equal(PN.gateViewFor('signed-out', false), 'auth');
  assert.equal(PN.gateViewFor('pending', false), 'pending');
  assert.equal(PN.gateViewFor('rejected', false), 'rejected');
  assert.equal(PN.gateViewFor('error', false), 'error');
  assert.equal(PN.gateViewFor('something-else', false), 'error'); // 알 수 없는 상태는 앱을 열지 않는다
});

test('gateViewFor: 승인된 계정은 스플래시가 끝나면 앱으로(null), 스플래시 중에는 로고만', () => {
  assert.equal(PN.gateViewFor('approved', true), 'splash');
  assert.equal(PN.gateViewFor('approved', false), null);
});

test('gateViewFor: 승인되지 않은 계정은 스플래시 여부와 상관없이 앱에 들어가지 못한다', () => {
  for (const state of ['signed-out', 'pending', 'rejected', 'error']) {
    assert.notEqual(PN.gateViewFor(state, true), null, state);
    assert.notEqual(PN.gateViewFor(state, false), null, state);
  }
});
