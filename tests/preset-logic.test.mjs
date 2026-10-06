import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const f of ['terms', 'filter', 'arxiv', 'sort']) await import(`../src/js/search/${f}.js`);
await import('../src/js/filters-view.js');
await import('../src/js/preset-logic.js');
await import('../src/js/db/presets.js');
const PN = globalThis.PN;

const form = (over = {}) => ({ ...PN.presetDefaults(), name: '통계', query: 'multilevel model, linear mixed-effects', ...over });

test('presetDefaults: PRD 기본값 (두 소스, 제한 없음, 20개, 관련도, 통계 모드 꺼짐)', () => {
  const d = PN.presetDefaults();
  assert.deepEqual(d.sources, ['arxiv', 'semantic_scholar']);
  assert.equal(d.dateRange, 'all');
  assert.equal(d.minCitations, 0);
  assert.equal(d.resultLimit, 20);
  assert.equal(d.sort, 'relevance');
  assert.equal(d.statsMode, false);
});

test('validatePreset: 정상 입력은 DB 행 모양으로 바꾼다 (이름 공백 제거, 검색어 정리, 분류 나누기)', () => {
  const r = PN.validatePreset(form({ name: '  통계 ', query: 'Multilevel   model; linear mixed-effects', arxivCategories: 'stat.ME, stat.AP stat.ME', sort: 'date_desc', dateRange: '5y', minCitations: '10', resultLimit: '30', statsMode: true }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    name: '통계', query: 'Multilevel model, linear mixed-effects', sources: ['arxiv', 'semantic_scholar'], arxiv_categories: ['stat.ME', 'stat.AP'],
    sort: 'date_desc', date_range: '5y', min_citations: 10, result_limit: 30, stats_mode: true,
  });
});

test('validatePreset: 이름, 검색어, 소스는 필수', () => {
  const r = PN.validatePreset(form({ name: '  ', query: '다층모형', sources: [] }));
  assert.equal(r.ok, false);
  assert.match(r.errors.name, /이름/);
  assert.match(r.errors.query, /영문 검색어/); // 한글만 있으면 검색할 수 없다
  assert.match(r.errors.sources, /소스/);
});

test('validatePreset: 이름은 20자까지 (경계값)', () => {
  assert.equal(PN.validatePreset(form({ name: 'a'.repeat(20) })).ok, true);
  assert.match(PN.validatePreset(form({ name: 'a'.repeat(21) })).errors.name, /20자/);
});

test('validatePreset: 검색어는 3개까지만 쓰이므로 정리된 3개만 저장한다', () => {
  const r = PN.validatePreset(form({ query: 'a one, b two, c three, d four' }));
  assert.equal(r.value.query, 'a one, b two, c three');
});

test('validatePreset: arXiv 분류 형식 검사 (stat.ME, q-bio.*, math.* 허용)', () => {
  assert.equal(PN.validatePreset(form({ arxivCategories: 'stat.ME, q-bio.*, cs.LG' })).ok, true);
  assert.equal(PN.validatePreset(form({ arxivCategories: '' })).ok, true); // 분류는 선택
  const bad = PN.validatePreset(form({ arxivCategories: 'stat.ME, stat me!, a b' }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.arxivCategories, /형식/);
  const many = PN.validatePreset(form({ arxivCategories: Array.from({ length: 11 }, (_, i) => `cs.A${String.fromCharCode(65 + i)}`).join(',') }));
  assert.match(many.errors.arxivCategories, /10개/);
});

test('validatePreset: 정렬, 기간, 최소 인용수, 검색 개수는 정해진 선택지만', () => {
  for (const [field, bad] of [['sort', 'newest'], ['dateRange', '2y'], ['minCitations', 7], ['resultLimit', 25]]) {
    const r = PN.validatePreset(form({ [field]: bad }));
    assert.equal(r.ok, false, field);
    assert.ok(r.errors[field], field);
  }
  assert.equal(PN.validatePreset(form({ minCitations: 500, resultLimit: 100, dateRange: '10y', sort: 'has_pdf_first' })).ok, true);
});

test('presetToForm과 validatePreset은 서로 되돌릴 수 있다', () => {
  const row = { name: '통계', query: 'multilevel model', sources: ['arxiv'], arxiv_categories: ['stat.ME', 'stat.AP'], sort: 'date_desc', date_range: '3y', min_citations: 50, result_limit: 10, stats_mode: true };
  const back = PN.validatePreset(PN.presetToForm(row)).value;
  assert.deepEqual(back, row);
});

test('parseCategories: 공백·쉼표·세미콜론으로 나누고 중복을 뺀다', () => {
  assert.deepEqual(PN.parseCategories(' stat.ME,stat.AP ; stat.ME\n cs.LG '), ['stat.ME', 'stat.AP', 'cs.LG']);
  assert.deepEqual(PN.parseCategories(''), []);
  assert.deepEqual(PN.parseCategories(null), []);
});

test('moveItem: 한 칸씩 옮기고, 끝에서 더 옮기면 그대로, 원래 배열은 바꾸지 않는다', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(PN.moveItem(list, 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(PN.moveItem(list, 1, 1), ['a', 'c', 'b']);
  assert.deepEqual(PN.moveItem(list, 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(PN.moveItem(list, 2, 1), ['a', 'b', 'c']);
  assert.deepEqual(PN.moveItem(list, 5, 1), ['a', 'b', 'c']);
  assert.deepEqual(list, ['a', 'b', 'c']);
});

test('positionChanges: 번호를 1부터 다시 매기고 바뀐 것만 돌려준다', () => {
  const ps = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }];
  assert.deepEqual(PN.positionChanges(PN.moveItem(ps, 2, -1)), [{ id: 'c', position: 2 }, { id: 'b', position: 3 }]);
  assert.deepEqual(PN.positionChanges(ps), []);
  // 지우기 등으로 번호에 빈 곳이 생겼으면 메운다
  assert.deepEqual(PN.positionChanges([{ id: 'a', position: 1 }, { id: 'c', position: 3 }]), [{ id: 'c', position: 2 }]);
});

test('presetSummary: 검색어 · 소스 · 정렬', () => {
  assert.equal(PN.presetSummary({ query: 'multilevel model', sources: ['arxiv', 'semantic_scholar'], sort: 'date_desc' }), 'multilevel model · arXiv + Semantic Scholar · 최신순');
});

// ---------------------------------------------------------------- API
function fakeClient(handler) {
  const log = [];
  const client = {
    from(table) {
      const state = { table, filters: [] };
      const b = {
        select(c) { state.select = c; return b; },
        insert(row) { state.op = 'insert'; state.row = row; return b; },
        update(row) { state.op = 'update'; state.row = row; return b; },
        delete() { state.op = 'delete'; return b; },
        eq(col, val) { state.filters.push([col, val]); return b; },
        single() { state.single = true; return b; },
        then(resolve, reject) { log.push({ ...state }); return Promise.resolve(handler({ ...state })).then(resolve, reject); },
      };
      return b;
    },
  };
  return { client, log };
}

test('presets.create: 값과 자리(position)를 넣어 만들고 행을 돌려준다 (user_id는 보내지 않는다)', async () => {
  const { client, log } = fakeClient(() => ({ data: { id: 'n1' }, error: null }));
  const row = await PN.createPresetsApi(client).create({ name: 'x', query: 'q' }, 8);
  assert.deepEqual(row, { id: 'n1' });
  assert.deepEqual(log[0].row, { name: 'x', query: 'q', position: 8 });
  assert.equal(log[0].op, 'insert');
  assert.ok(!('user_id' in log[0].row));
});

test('presets.update: id로 바꾸고, 없으면 null', async () => {
  let c = fakeClient(() => ({ data: [{ id: 'p1', name: '새 이름' }], error: null }));
  assert.deepEqual(await PN.createPresetsApi(c.client).update('p1', { name: '새 이름' }), { id: 'p1', name: '새 이름' });
  assert.deepEqual(c.log[0].filters, [['id', 'p1']]);
  c = fakeClient(() => ({ data: [], error: null }));
  assert.equal(await PN.createPresetsApi(c.client).update('p1', {}), null);
});

test('presets.remove: 지웠으면 true, 이미 없었으면 false, 오류는 던진다', async () => {
  let c = fakeClient(() => ({ data: [{ id: 'p1' }], error: null }));
  assert.equal(await PN.createPresetsApi(c.client).remove('p1'), true);
  assert.equal(c.log[0].op, 'delete');
  c = fakeClient(() => ({ data: [], error: null }));
  assert.equal(await PN.createPresetsApi(c.client).remove('p1'), false);
  c = fakeClient(() => ({ data: null, error: { code: '42501' } }));
  await assert.rejects(PN.createPresetsApi(c.client).remove('p1'), (e) => e.code === '42501');
});

test('presets.reorder: 바뀐 것마다 position만 수정하고, 하나라도 실패하면 던진다', async () => {
  let c = fakeClient(() => ({ data: null, error: null }));
  await PN.createPresetsApi(c.client).reorder([{ id: 'a', position: 2 }, { id: 'b', position: 1 }]);
  assert.deepEqual(c.log.map((l) => [l.filters[0][1], l.row]), [['a', { position: 2 }], ['b', { position: 1 }]]);
  c = fakeClient((s) => (s.filters[0][1] === 'b' ? { data: null, error: { code: 'x' } } : { data: null, error: null }));
  await assert.rejects(PN.createPresetsApi(c.client).reorder([{ id: 'a', position: 2 }, { id: 'b', position: 1 }]), (e) => e.code === 'x');
  c = fakeClient(() => ({ data: null, error: null }));
  await PN.createPresetsApi(c.client).reorder([]);
  assert.equal(c.log.length, 0);
});
