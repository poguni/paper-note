import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/theme.js'); // globalThis.PN 에 readTheme, applyTheme 등록 (브라우저가 아니므로 자동 실행은 안 됨)
const { PN } = globalThis;

const storageOf = (value) => ({ getItem: () => value });

test('readTheme: 저장값이 없거나 잘못되면 academic', () => {
  assert.equal(PN.readTheme(storageOf(null)), 'academic');
  assert.equal(PN.readTheme(storageOf('')), 'academic');
  assert.equal(PN.readTheme(storageOf('dark')), 'academic');
  assert.equal(PN.readTheme(storageOf('toString')), 'academic'); // 객체 기본 속성 이름도 거른다
  assert.equal(PN.readTheme(storageOf('__proto__')), 'academic');
});

test('readTheme: 올바른 저장값은 그대로', () => {
  assert.equal(PN.readTheme(storageOf('academic')), 'academic');
  assert.equal(PN.readTheme(storageOf('education')), 'education');
});

test('readTheme: 저장소 접근이 막혀도 academic', () => {
  assert.equal(PN.readTheme({ getItem: () => { throw new Error('blocked'); } }), 'academic');
  assert.equal(PN.readTheme(undefined), 'academic');
});

function fakeDoc() {
  const links = new Map();
  return {
    links,
    documentElement: { dataset: {} },
    head: { appendChild: (el) => links.set(el.id, el) },
    getElementById: (id) => links.get(id) ?? null,
    createElement: () => ({}),
  };
}

test('applyTheme: data-theme를 바꾸고 선택된 테마의 글꼴 링크만 추가한다', () => {
  const doc = fakeDoc();
  assert.equal(PN.applyTheme('education', doc), 'education');
  assert.equal(doc.documentElement.dataset.theme, 'education');
  assert.deepEqual([...doc.links.keys()], ['pn-font-education']);
  assert.match(doc.links.get('pn-font-education').href, /Gowun/);
});

test('applyTheme: 같은 테마를 다시 적용해도 글꼴 링크는 하나', () => {
  const doc = fakeDoc();
  PN.applyTheme('academic', doc);
  PN.applyTheme('academic', doc);
  assert.equal(doc.links.size, 1);
});

test('applyTheme: 잘못된 테마는 academic으로', () => {
  const doc = fakeDoc();
  assert.equal(PN.applyTheme('nope', doc), 'academic');
  assert.equal(doc.documentElement.dataset.theme, 'academic');
});

test('otherTheme: 지금과 다른 테마를 돌려준다', () => {
  assert.equal(PN.otherTheme('academic'), 'education');
  assert.equal(PN.otherTheme('education'), 'academic');
  assert.equal(PN.otherTheme('이상한 값'), 'education'); // 알 수 없는 값은 academic처럼 취급
});

test('themeQuickLabel: 눌렀을 때 바뀔 테마의 이름 + "테마" (기능 차이가 아니라 모양이라는 뜻)', () => {
  assert.equal(PN.themeQuickLabel('academic'), '교육용 테마');
  assert.equal(PN.themeQuickLabel('education'), '학술용 테마');
});

test('saveTheme: 올바른 테마만 pn_theme에 저장하고, 저장소가 막혀 있으면 false', () => {
  const saved = {};
  const storage = { setItem: (k, v) => { saved[k] = v; } };
  assert.equal(PN.saveTheme('education', storage), true);
  assert.deepEqual(saved, { pn_theme: 'education' });
  assert.equal(PN.saveTheme('dark', storage), false);
  assert.equal(PN.saveTheme('__proto__', storage), false);
  assert.deepEqual(saved, { pn_theme: 'education' }); // 잘못된 값은 저장하지 않는다
  assert.equal(PN.saveTheme('academic', { setItem: () => { throw new Error('blocked'); } }), false);
  assert.equal(PN.saveTheme('academic', undefined), false);
});

test('THEME_INFO: 두 테마 모두 이름과 설명이 있다', () => {
  for (const t of PN.THEMES) {
    assert.ok(PN.THEME_INFO[t].label && PN.THEME_INFO[t].short && PN.THEME_INFO[t].note, t);
  }
  assert.deepEqual(Object.keys(PN.THEME_INFO).sort(), [...PN.THEMES].sort());
});
