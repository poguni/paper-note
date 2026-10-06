import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/db/papers.js');
await import('../src/js/db/analyses.js');
const PN = globalThis.PN;

// db.test.mjs와 같은 가짜 Supabase 클라이언트
function fakeClient(handler) {
  const log = [];
  const client = {
    from(table) {
      const state = { table, filters: [] };
      const b = {
        select(cols) { state.select = cols; return b; },
        eq(col, val) { state.filters.push([col, val]); return b; },
        order(col, opts) { state.order = [col, opts]; return b; },
        range(from, to) { state.range = [from, to]; return b; },
        then(resolve, reject) { log.push({ ...state }); return Promise.resolve(handler({ ...state })).then(resolve, reject); },
      };
      return b;
    },
  };
  return { client, log };
}

test('papers.listAll: 메타데이터와 메모까지 저장일 최신순으로, 1000건씩 끝까지 읽는다', async () => {
  const page = (n, off = 0) => Array.from({ length: n }, (_, i) => ({ id: `r${off + i}`, title: 't', memo: '' }));
  const { client, log } = fakeClient((s) => ({ data: s.range[0] === 0 ? page(1000) : s.range[0] === 1000 ? page(2, 1000) : [], error: null }));
  const rows = await PN.createPapersApi(client).listAll();
  assert.equal(rows.length, 1002);
  assert.deepEqual(log.map((l) => l.range), [[0, 999], [1000, 1999]]);
  assert.deepEqual(log[0].order, ['saved_at', { ascending: false }]);
  for (const col of ['title', 'authors', 'abstract', 'pdf_url', 'landing_url', 'memo', 'saved_at']) assert.ok(log[0].select.includes(col), col);
  assert.ok(!log[0].select.includes('user_id'));
});

test('papers.listAll: 오류는 던진다', async () => {
  const { client } = fakeClient(() => ({ data: null, error: { code: 'PGRST301' } }));
  await assert.rejects(PN.createPapersApi(client).listAll(), (e) => e.code === 'PGRST301');
});

test('analyses.listIndex: 논문 id와 단계만 읽는다 (결과 본문은 가져오지 않는다)', async () => {
  const { client, log } = fakeClient(() => ({ data: [{ paper_id: 'p1', stage: 'abstract' }], error: null }));
  assert.deepEqual(await PN.createAnalysesApi(client).listIndex(), [{ paper_id: 'p1', stage: 'abstract' }]);
  assert.equal(log[0].select, 'paper_id,stage');
});

test('analyses.listIndex: 1000건씩 끝까지 읽고 오류는 던진다', async () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ paper_id: `p${i}`, stage: 'abstract' }));
  let c = fakeClient((s) => ({ data: s.range[0] === 0 ? rows(1000) : rows(3), error: null }));
  assert.equal((await PN.createAnalysesApi(c.client).listIndex()).length, 1003);
  c = fakeClient(() => ({ data: null, error: { code: 'x' } }));
  await assert.rejects(PN.createAnalysesApi(c.client).listIndex(), (e) => e.code === 'x');
});

// ---------------------------------------------------------------- 프리셋 기록
function insertClient(handler) {
  const calls = [];
  const client = {
    from() {
      const state = {};
      const b = {
        insert(row) { state.row = row; return b; },
        select() { return b; },
        single() { return b; },
        eq() { return b; },
        maybeSingle() { return b; },
        then(resolve, reject) { calls.push({ ...state }); return Promise.resolve(handler(calls.length, state)).then(resolve, reject); },
      };
      return b;
    },
  };
  return { client, calls };
}
const paperIn = { source: 'arxiv', sourceId: '1', title: 't', authors: [], categories: [] };

test('paperToRow: 프리셋이 있으면 preset_id를 담고, 없으면 열 자체를 보내지 않는다', () => {
  assert.equal(PN.paperToRow(paperIn, 'pre-1').preset_id, 'pre-1');
  assert.ok(!('preset_id' in PN.paperToRow(paperIn)));
  assert.ok(!('preset_id' in PN.paperToRow(paperIn, null)));
});

test('save: 프리셋 id를 함께 저장한다', async () => {
  const { client, calls } = insertClient(() => ({ data: { id: 'r1' }, error: null }));
  await PN.createPapersApi(client).save(paperIn, 'pre-1');
  assert.equal(calls[0].row.preset_id, 'pre-1');
});

test('save: 프리셋이 그 사이 지워졌으면(외래 키 23503) 프리셋 없이 한 번 더 저장한다', async () => {
  const { client, calls } = insertClient((n) => (n === 1 ? { data: null, error: { code: '23503' } } : { data: { id: 'r1' }, error: null }));
  const res = await PN.createPapersApi(client).save(paperIn, 'gone');
  assert.equal(res.status, 'saved');
  assert.equal(calls.length, 2);
  assert.ok(!('preset_id' in calls[1].row));
});

test('save: 프리셋 없이 저장하다 23503이 나면 재시도하지 않고 오류를 던진다', async () => {
  const { client, calls } = insertClient(() => ({ data: null, error: { code: '23503' } }));
  await assert.rejects(PN.createPapersApi(client).save(paperIn), (e) => e.code === '23503');
  assert.equal(calls.length, 1);
});
