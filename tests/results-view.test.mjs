import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/results-view.js');
const PN = globalThis.PN;

test('authorsShort: 성만 보이고 4명을 넘으면 "외 N명"', () => {
  assert.equal(PN.authorsShort(['Douglas Bates', 'Martin Mächler', 'Ben Bolker', 'Steve Walker']), 'Bates, Mächler, Bolker, Walker');
  assert.equal(PN.authorsShort(['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six']), 'One, Two, Three, Four 외 2명');
  assert.equal(PN.authorsShort(['Douglas M. Bates']), 'Bates');
});

test('authorsShort: 저자가 없으면 안내 문구', () => {
  assert.equal(PN.authorsShort([]), '저자 정보 없음');
  assert.equal(PN.authorsShort(undefined), '저자 정보 없음');
});

test('citationLabel: 숫자는 천 단위 쉼표, 모르면 "인용수 미확인", 0은 0으로', () => {
  assert.equal(PN.citationLabel(88314), '인용 88,314');
  assert.equal(PN.citationLabel(0), '인용 0');
  assert.equal(PN.citationLabel(null), '인용수 미확인');
  assert.equal(PN.citationLabel(undefined), '인용수 미확인');
});

test('safeUrl: http(s)만 통과, javascript: 등은 막는다', () => {
  assert.equal(PN.safeUrl('https://arxiv.org/pdf/1406.5823'), 'https://arxiv.org/pdf/1406.5823');
  assert.equal(PN.safeUrl('http://example.org/a.pdf'), 'http://example.org/a.pdf');
  assert.equal(PN.safeUrl('javascript:alert(1)'), null);
  assert.equal(PN.safeUrl('data:text/html,<script>1</script>'), null);
  assert.equal(PN.safeUrl(''), null);
  assert.equal(PN.safeUrl(null), null);
});

test('sourceLabel: 알 수 없는 값은 그대로', () => {
  assert.equal(PN.sourceLabel('arxiv'), 'arXiv');
  assert.equal(PN.sourceLabel('semantic_scholar'), 'Semantic Scholar');
  assert.equal(PN.sourceLabel('other'), 'other');
});
