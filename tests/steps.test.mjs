import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/steps.js');
const PN = globalThis.PN;

const base = { screen: 'search', hasPaper: false, saved: false, analyzed: false };

test('currentStep: 논문을 고르지 않았으면 검색', () => {
  assert.equal(PN.currentStep(base), 1);
});

test('currentStep: 논문을 열었지만 저장하지 않았으면 아직 검색', () => {
  assert.equal(PN.currentStep({ ...base, hasPaper: true }), 1);
});

test('currentStep: 저장했으면 저장, 분석 결과가 있으면 분석', () => {
  assert.equal(PN.currentStep({ ...base, hasPaper: true, saved: true }), 2);
  assert.equal(PN.currentStep({ ...base, hasPaper: true, saved: true, analyzed: true }), 3);
});

test('currentStep: 저장하기 전에 분석했어도 분석 단계', () => {
  assert.equal(PN.currentStep({ ...base, hasPaper: true, analyzed: true }), 3);
});

test('currentStep: 논문이 닫혀 있으면 이전 값(saved, analyzed)이 남아 있어도 검색', () => {
  assert.equal(PN.currentStep({ ...base, hasPaper: false, saved: true, analyzed: true }), 1);
});

test('currentStep: 서재 화면은 항상 내 서재, 설정 화면은 어느 단계도 아님', () => {
  assert.equal(PN.currentStep({ ...base, screen: 'library' }), 4);
  assert.equal(PN.currentStep({ screen: 'library', hasPaper: true, saved: true, analyzed: true }), 4);
  assert.equal(PN.currentStep({ ...base, screen: 'settings' }), 0);
  assert.equal(PN.currentStep({ screen: 'settings', hasPaper: true, saved: true, analyzed: true }), 0);
});

test('stepStates: 앞 단계는 완료, 현재는 current, 뒤는 todo', () => {
  assert.deepEqual(PN.stepStates(1), ['current', 'todo', 'todo', 'todo']);
  assert.deepEqual(PN.stepStates(3), ['done', 'done', 'current', 'todo']);
  assert.deepEqual(PN.stepStates(4), ['done', 'done', 'done', 'current']);
  assert.deepEqual(PN.stepStates(0), ['todo', 'todo', 'todo', 'todo']);
});

test('STEPS: 검색, 저장, 분석, 내 서재 순서', () => {
  assert.deepEqual(PN.STEPS.map((s) => s.label), ['검색', '저장', '분석', '내 서재']);
});

// ---- renderSteps: 아주 작은 가짜 DOM으로 구조만 확인한다
function fakeDocument() {
  const make = (tag) => ({
    tag, className: '', dataset: {}, attrs: {}, children: [], text: '',
    get textContent() { return this.text; },
    set textContent(v) { this.text = v; this.children = []; }, // 실제 DOM처럼 글씨를 넣으면 자식이 비워진다
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; }
  });
  return { createElement: make, list: make('ol') };
}

test('renderSteps: 단계마다 항목을 만들고 완료는 ✓, 나머지는 번호, 현재에만 aria-current', () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    doc.list.children.push('이전 내용');
    PN.renderSteps(doc.list, 3);
    const items = doc.list.children;
    assert.equal(items.length, 4);
    assert.deepEqual(items.map((li) => li.dataset.state), ['done', 'done', 'current', 'todo']);
    assert.deepEqual(items.map((li) => li.children[0].textContent), ['✓', '✓', '3', '4']);
    assert.deepEqual(items.map((li) => li.children[1].textContent), ['검색', '저장', '분석', '내 서재']);
    assert.deepEqual(items.map((li) => li.attrs['aria-current']), [undefined, undefined, 'step', undefined]);
    assert.match(items[0].children[2].textContent, /완료/);
    assert.match(items[2].children[2].textContent, /현재 단계/);
    assert.match(items[3].children[2].textContent, /아직 안 함/);
    assert.equal(items[0].children[0].attrs['aria-hidden'], 'true');
  } finally {
    delete globalThis.document;
  }
});
