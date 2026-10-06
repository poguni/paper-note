import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/state.js');
const { PN } = globalThis;

test('parseScreen: 해시를 화면 이름으로', () => {
  assert.equal(PN.parseScreen('#search'), 'search');
  assert.equal(PN.parseScreen('#library'), 'library');
  assert.equal(PN.parseScreen('#settings'), 'settings');
});

test('parseScreen: 비었거나 알 수 없으면 search', () => {
  assert.equal(PN.parseScreen(''), 'search');
  assert.equal(PN.parseScreen(undefined), 'search');
  assert.equal(PN.parseScreen('#nope'), 'search');
  assert.equal(PN.parseScreen('#toString'), 'search');
});

test('createStore: set이 상태를 합치고 구독자에게 알린다', () => {
  const store = PN.createStore({ screen: 'search', n: 1 });
  const seen = [];
  store.subscribe((s) => seen.push(s.screen));
  store.set({ screen: 'library' });
  assert.deepEqual(store.get(), { screen: 'library', n: 1 });
  assert.deepEqual(seen, ['library']);
});
