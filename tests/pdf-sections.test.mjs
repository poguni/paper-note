import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/search/terms.js');
await import('../src/js/ai/models.js');
await import('../src/js/ai/schema.js');
await import('../src/js/ai/cost.js');
await import('../src/js/pdf/sections.js');
const PN = globalThis.PN;

const BODY = 10;
const H = 14;
const L = (text, size = BODY) => ({ text, size });
// 본문 줄은 서로 달라야 한다 (같은 줄이 여러 쪽에 반복되면 머리글로 보고 지우기 때문). 숫자는 쪽 번호와 헷갈리지 않게 글자로 바꾼다.
let counter = 0;
const letters = (n) => { let s = ''; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } while (n > 0); return s; };
const body = (n, word = 'estimate') => Array.from({ length: n }, () => L(`This sentence ${letters(counter++)} describes how we ${word} the parameters of the model`));
const page = (n, lines) => ({ n, lines });
const titles = (r) => r.sections.map((s) => s.title);

// 일반적인 논문: 제목·저자, 초록, 번호 있는 제목, 참고문헌
const paper = () => [
  page(1, [L('Fitting Linear Mixed-Effects Models', 20), L('D. Bates, M. Maechler'), L('Abstract', H), ...body(3), L('1 Introduction', H), ...body(3)]),
  page(2, [L('2 Methods', H), ...body(4), L('2.1 Estimation of effects', 12), ...body(3), L('3 Results', H), ...body(3)]),
  page(3, [L('4 Discussion', H), ...body(3), L('5 Conclusion', H), ...body(2), L('References', H), L('Bates, D. (2015). Fitting models. Journal of Software, 67(1), 1-48.'), L('Smith, J. (2010). Another paper. Annals, 3, 10-20.')]),
];

test('섹션 분할: 제목 줄에서 나누고 제목 앞부분은 이름 없는 섹션이 된다', () => {
  const r = PN.prepareFullText(paper());
  assert.equal(r.mode, 'headings');
  assert.deepEqual(titles(r), ['', 'Abstract', '1 Introduction', '2 Methods', '2.1 Estimation of effects', '3 Results', '4 Discussion', '5 Conclusion']);
  assert.match(r.sections[0].text, /Fitting Linear Mixed-Effects Models/);
  assert.equal(r.sections[1].startPage, 1);
  assert.equal(r.sections[3].startPage, 2);
});

test('참고문헌 제거: 제목 줄부터 끝까지 빼고, 제거한 양을 알려 준다', () => {
  const r = PN.prepareFullText(paper());
  assert.equal(r.referencesFound, true);
  assert.equal(r.referencesRemoved.lines, 3); // 제목 줄 + 항목 2개
  assert.ok(r.referencesRemoved.chars > 80);
  assert.ok(!r.text.includes('Journal of Software'));
  assert.ok(!titles(r).includes('References'));
  assert.ok(r.text.includes('## 5 Conclusion'));
});

test('참고문헌 제거: 뒤에 부록이 오면 부록은 남긴다', () => {
  const pages = paper();
  pages[2].lines.push(L('Appendix A', H), L('Proof of the theorem goes here and continues'));
  const r = PN.prepareFullText(pages);
  assert.equal(r.referencesRemoved.lines, 3);
  assert.ok(r.text.includes('Proof of the theorem'));
  assert.ok(!r.text.includes('Annals'));
});

test('참고문헌 제거: 항목 안의 숫자 시작 줄은 섹션 제목으로 오인하지 않는다', () => {
  const pages = paper();
  pages[2].lines.push(L('1. Bates D, Maechler M. Linear models. 2015.'), L('2. Other work'), L('3 Something Else'));
  const r = PN.prepareFullText(pages);
  assert.equal(r.referencesRemoved.lines, 6);
  assert.ok(!titles(r).includes('3 Something Else'));
});

test('참고문헌 제목 표기: 대문자, 번호, Bibliography', () => {
  for (const heading of ['REFERENCES', '6 References', 'Bibliography', 'Literature Cited', 'References:']) {
    const r = PN.prepareFullText([page(1, [L('Abstract', H), ...body(3), L('1 Introduction', H), ...body(2), L('2 Methods', H), ...body(2), L(heading, H), L('Entry one 2001')])]);
    assert.equal(r.referencesFound, true, heading);
    assert.ok(!r.text.includes('Entry one'), heading);
  }
});

test('참고문헌 제목이 없으면 지우지 않고 알린다', () => {
  const pages = paper();
  pages[2].lines = pages[2].lines.filter((l) => l.text !== 'References');
  const r = PN.prepareFullText(pages);
  assert.equal(r.referencesFound, false);
  assert.deepEqual(r.referencesRemoved, { lines: 0, chars: 0 });
  assert.ok(r.text.includes('Journal of Software'));
});

test('본문 속에 "references"라는 단어가 있어도 문장은 제목으로 보지 않는다', () => {
  const pages = paper();
  pages[0].lines.splice(5, 0, L('See the references below for details of the approach used here'));
  const r = PN.prepareFullText(pages);
  assert.ok(r.text.includes('See the references below'));
});

test('쪽마다 반복되는 머리글·바닥글과 쪽 번호를 뺀다', () => {
  const mk = (n) => page(n, [L('Journal of Statistical Software'), ...(n === 1 ? [L('Abstract', H)] : []), ...body(2, `word${letters(n)}`), L(String(n))]);
  const pages = [mk(1), mk(2), mk(3), mk(4)];
  const r = PN.prepareFullText(pages);
  assert.ok(!r.text.includes('Journal of Statistical Software'));
  assert.ok(!/\n4(\n|$)/.test(r.text));
  assert.equal(r.runningRemoved, 8); // 머리글 4 + 쪽 번호 4
  assert.ok(r.text.includes('wordd'));
});

test('쪽 번호 모양의 줄은 쪽의 맨 위·맨 아래에서만 뺀다 (본문 속 숫자 줄은 남긴다)', () => {
  const pages = [page(1, [L('Abstract', H), L('12'), ...body(2), L('1')])];
  const r = PN.prepareFullText(pages);
  assert.ok(/Abstract\n12\n/.test(r.text) || r.sections.some((s) => s.text.startsWith('12')), '가운데 숫자 줄이 사라짐');
  assert.ok(!r.text.endsWith('\n1'));
});

test('제목이 거의 없으면 쪽 단위로 나눈다', () => {
  const pages = [page(1, body(5)), page(2, body(5)), page(3, body(5))];
  const r = PN.prepareFullText(pages);
  assert.equal(r.mode, 'pages');
  assert.deepEqual(titles(r), ['1쪽', '2쪽', '3쪽']);
  assert.deepEqual(r.sections.map((s) => s.startPage), [1, 2, 3]);
});

test('쪽 단위로 나눌 때도 참고문헌은 제거한다', () => {
  const pages = [page(1, body(5)), page(2, [...body(3), L('References'), L('Entry 2001 doi')])];
  const r = PN.prepareFullText(pages);
  assert.equal(r.mode, 'pages');
  assert.equal(r.referencesFound, true);
  assert.ok(!r.text.includes('Entry 2001'));
});

test('모호한 제목(Data, Model 등)은 번호가 있거나 글자가 클 때만 제목으로 본다', () => {
  const pages = [page(1, [L('Abstract', H), ...body(2), L('Data'), ...body(2), L('Introduction', H), ...body(2), L('2 Data', H), ...body(2), L('Results', H), ...body(2)])];
  const r = PN.prepareFullText(pages);
  assert.ok(!titles(r).includes('Data')); // 같은 크기의 단독 "Data" 줄(표 머리글 등)은 제목이 아님
  assert.ok(titles(r).includes('2 Data'));
  assert.ok(titles(r).includes('Introduction'));
  const big = PN.prepareFullText([page(1, [L('Abstract', H), ...body(2), L('Data', H), ...body(2), L('Introduction', H), ...body(2), L('Results', H), ...body(2)])]);
  assert.ok(titles(big).includes('Data')); // 글자가 크면 제목
});

test('번호 제목: 대문자로 시작하고 짧아야 하며, 문장 부호로 끝나는 줄은 제외', () => {
  const pages = [page(1, [L('Abstract', H), ...body(2), L('1 Introduction', H), ...body(2), L('2 Methods', H), L('2.1 estimation details', H), L('3 Results.', H), L('4 This is a very long sentence that has many words and goes on and on', H), ...body(2)])];
  const r = PN.prepareFullText(pages);
  assert.ok(titles(r).includes('2 Methods'));
  assert.ok(!titles(r).includes('2.1 estimation details')); // 소문자로 시작
  assert.ok(!titles(r).includes('3 Results.')); // 마침표로 끝남 (본문 줄)
  assert.ok(!titles(r).some((t) => t.startsWith('4 This')));
});

test('줄 끝에서 잘린 단어를 이어 붙이고, 줄바꿈은 유지한다', () => {
  const r = PN.prepareFullText([page(1, [L('Abstract', H), L('We study the estima-'), L('tion of mixed-'), L('effects models.'), L('1 Introduction', H), ...body(1), L('2 Methods', H), ...body(1)])]);
  const abs = r.sections.find((s) => s.title === 'Abstract');
  assert.equal(abs.text, 'We study the estima-tion of mixed-effects models.');
});

test('AI에 보낼 전체 본문: 섹션 제목 표시(##)와 토큰 어림값', () => {
  const r = PN.prepareFullText(paper());
  assert.match(r.text, /^Fitting Linear Mixed-Effects Models/);
  assert.match(r.text, /\n\n## Abstract\n/);
  assert.equal(r.charCount, r.text.length);
  assert.equal(r.tokens, PN.estimateTokens(r.text));
});

test('입력이 비어 있어도 오류 없이 빈 결과', () => {
  const r = PN.prepareFullText([]);
  assert.deepEqual(r.sections, []);
  assert.equal(r.text, '');
  const e = PN.prepareFullText([page(1, [])]);
  assert.equal(e.charCount, 0);
});

test('글자 크기 정보가 없는 PDF(크기 0)도 번호·표준 제목으로 나눈다', () => {
  const lines = [L('Abstract', 0), ...body(2).map((l) => L(l.text, 0)), L('1 Introduction', 0), ...body(2).map((l) => L(l.text, 0)), L('2 Methods', 0), ...body(2).map((l) => L(l.text, 0))];
  const r = PN.prepareFullText([page(1, lines)]);
  assert.equal(r.mode, 'headings');
  assert.deepEqual(titles(r), ['Abstract', '1 Introduction', '2 Methods']);
});

test('"References"라는 줄이 앞에도 있으면(목차 등) 마지막 것부터 참고문헌으로 본다', () => {
  const pages = paper();
  pages[0].lines.splice(3, 0, L('References'), L('Contents list entry that must stay'));
  const r = PN.prepareFullText(pages);
  assert.ok(r.text.includes('Contents list entry that must stay'));
  assert.ok(r.text.includes('## 5 Conclusion'));
  assert.ok(!r.text.includes('Journal of Software'));
});
