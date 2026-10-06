import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/results-view.js');
await import('../src/js/detail-view.js');
const PN = globalThis.PN;

test('doiUrl: DOI만 doi.org 주소로, 그 밖의 문자열은 null', () => {
  assert.equal(PN.doiUrl('10.18637/jss.v067.i01'), 'https://doi.org/10.18637/jss.v067.i01');
  assert.equal(PN.doiUrl('https://doi.org/10.1000/abc'), 'https://doi.org/10.1000/abc');
  assert.equal(PN.doiUrl('javascript:alert(1)'), null);
  assert.equal(PN.doiUrl('not a doi'), null);
  assert.equal(PN.doiUrl(null), null);
});

test('doiUrl: 주소에 위험한 글자가 들어가지 않게 인코딩한다', () => {
  assert.equal(PN.doiUrl('10.1000/a b"<>'), null); // 공백이 있으면 DOI로 보지 않는다
  assert.equal(PN.doiUrl('10.1000/a"b'), 'https://doi.org/10.1000/a%22b');
});

test('metaLine: 있는 정보만 이어 붙인다', () => {
  assert.equal(PN.metaLine({ authors: ['A One', 'B Two'], year: 2014, venue: 'JSS' }), 'A One, B Two · 2014 · JSS');
  assert.equal(PN.metaLine({ authors: [], year: 2014 }), '2014');
  assert.equal(PN.metaLine({ authors: [] }), '저자 정보 없음');
});

test('paperKey: 소스와 소스 ID로 만든다', () => {
  assert.equal(PN.paperKey({ source: 'arxiv', sourceId: '1406.5823' }), 'arxiv:1406.5823');
});
