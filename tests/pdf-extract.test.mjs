import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/js/pdf/extract.js');
const PN = globalThis.PN;

const item = (str, over = {}) => ({ str, height: 12, transform: [12, 0, 0, 12, 50, 700], hasEOL: false, ...over });

// pdf.js 모듈을 흉내 낸 가짜. pages: 쪽마다 getTextContent의 items
const fakeLib = (pages, over = {}) => ({
  getDocument: () => ({
    promise: over.openError
      ? Promise.reject(Object.assign(new Error('x'), { name: over.openError }))
      : Promise.resolve({
        numPages: pages.length,
        getPage: async (n) => ({ getTextContent: async () => ({ items: pages[n - 1] }) }),
        destroy: () => { over.destroyed = true; },
      }),
  }),
});

// ---- 파일 확인
const head = (s) => new TextEncoder().encode(s);

test('checkPdfFile: PDF 이름이나 형식, 크기, 시작 표식을 확인한다', () => {
  const ok = { name: 'paper.pdf', type: 'application/pdf', size: 1000 };
  assert.equal(PN.checkPdfFile(ok, head('%PDF-1.7\n')), null);
  assert.equal(PN.checkPdfFile({ name: 'x.PDF', type: '', size: 10 }, head('%PDF-1.4')), null); // 형식 정보가 없어도 이름으로
  assert.match(PN.checkPdfFile({ name: 'a.docx', type: 'application/msword', size: 10 }, null), /PDF 파일만/);
  assert.match(PN.checkPdfFile({ name: 'a.pdf', type: 'application/pdf', size: 0 }, null), /빈 파일/);
  assert.match(PN.checkPdfFile({ name: 'a.pdf', type: 'application/pdf', size: PN.PDF_MAX_BYTES + 1 }, null), /너무 큽니다/);
  assert.equal(PN.checkPdfFile({ name: 'a.pdf', type: 'application/pdf', size: PN.PDF_MAX_BYTES }, null), null); // 경계값
  assert.match(PN.checkPdfFile(ok, head('<html>not a pdf</html>')), /PDF 형식이 아닌/); // 이름만 pdf인 다른 파일
});

// ---- 줄 만들기
test('itemsToLines: 줄바꿈 표식(hasEOL)에서 줄을 나누고, 빈 줄과 표식 항목은 건너뛴다', () => {
  const lines = PN.itemsToLines([
    item('Fitting '), item('Linear Mixed', { hasEOL: false }), item(' Models', { hasEOL: true }),
    item('', { hasEOL: true }), // 빈 줄
    { type: 'beginMarkedContent' }, // str 없는 표식
    item('Abstract', { height: 16, hasEOL: true }),
    item('Last line without EOL'),
  ]);
  assert.deepEqual(lines.map((l) => l.text), ['Fitting Linear Mixed Models', 'Abstract', 'Last line without EOL']);
});

test('itemsToLines: 줄마다 가장 큰 글자 높이를 기록한다 (제목 판별용)', () => {
  const lines = PN.itemsToLines([item('1 Introduction', { height: 14, hasEOL: true }), item('small ', { height: 9 }), item('BIG', { height: 20, hasEOL: true })]);
  assert.deepEqual(lines.map((l) => l.size), [14, 20]);
});

test('itemsToLines: height가 없으면 변환 행렬의 글자 크기를 쓴다', () => {
  const lines = PN.itemsToLines([{ str: 'x', transform: [1, 0, 0, 11, 0, 0], hasEOL: true }]);
  assert.equal(lines[0].size, 11);
});

// ---- 스캔본 판단
test('looksScanned: 쪽당 글자가 100자보다 적으면 스캔본, 충분하면 아님, 쪽이 없으면 스캔본', () => {
  const page = (n) => ({ text: 'a'.repeat(n) });
  assert.equal(PN.looksScanned([page(0), page(5), page(0)]), true);
  assert.equal(PN.looksScanned([page(3000), page(2500)]), false);
  assert.equal(PN.looksScanned([page(99)]), true);
  assert.equal(PN.looksScanned([page(100)]), false); // 경계값
  assert.equal(PN.looksScanned([]), true);
  // 공백과 줄바꿈은 글자로 세지 않는다
  assert.equal(PN.looksScanned([{ text: ' \n '.repeat(500) }]), true);
});

// ---- 추출
test('extractPdfText: 쪽마다 줄과 텍스트를 만들고 진행 상황을 알린다', async () => {
  const lib = fakeLib([
    [item('Abstract', { hasEOL: true }), item('We study mixed models. '.repeat(10), { hasEOL: true })],
    [item('1 Introduction', { hasEOL: true }), item('Hello world. '.repeat(20), { hasEOL: true })],
  ]);
  const progress = [];
  const res = await PN.extractPdfText(lib, new Uint8Array(), { onProgress: (d, t) => progress.push([d, t]) });
  assert.equal(res.numPages, 2);
  assert.deepEqual(res.pages.map((p) => p.n), [1, 2]);
  assert.match(res.pages[0].text, /^Abstract\nWe study/);
  assert.equal(res.pages[1].lines[0].text, '1 Introduction');
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.equal(res.charCount, res.pages[0].text.length + res.pages[1].text.length);
});

test('extractPdfText: 글자가 충분한 PDF는 스캔본이 아니다, 텍스트 없는 PDF는 스캔본이다', async () => {
  const text = (n) => [item('word '.repeat(n), { hasEOL: true })];
  assert.equal((await PN.extractPdfText(fakeLib([text(200), text(200)]), new Uint8Array())).scanned, false);
  const scan = await PN.extractPdfText(fakeLib([[], [], []]), new Uint8Array());
  assert.equal(scan.scanned, true);
  assert.equal(scan.charCount, 0);
  assert.equal(scan.numPages, 3);
});

test('extractPdfText: 끝나면 문서를 정리한다 (실패해도)', async () => {
  const state = {};
  await PN.extractPdfText(fakeLib([[item('x', { hasEOL: true })]], state), new Uint8Array());
  assert.equal(state.destroyed, true);
});

test('extractPdfText: 비밀번호 PDF와 손상된 PDF는 종류별 오류', async () => {
  await assert.rejects(PN.extractPdfText(fakeLib([], { openError: 'PasswordException' }), new Uint8Array()), (e) => e.name === 'PdfError' && e.code === 'password');
  await assert.rejects(PN.extractPdfText(fakeLib([], { openError: 'InvalidPDFException' }), new Uint8Array()), (e) => e.code === 'invalid');
});

test('extractPdfText: 쪽 수가 한도를 넘으면 읽지 않고 오류', async () => {
  const state = {};
  const many = Array.from({ length: PN.PDF_MAX_PAGES + 1 }, () => []);
  await assert.rejects(PN.extractPdfText(fakeLib(many, state), new Uint8Array()), (e) => e.code === 'too_many_pages');
  assert.equal(state.destroyed, true);
});

test('extractPdfText: 취소 신호가 오면 멈춘다', async () => {
  const ac = new AbortController();
  const lib = fakeLib([[item('a', { hasEOL: true })], [item('b', { hasEOL: true })], [item('c', { hasEOL: true })]]);
  await assert.rejects(PN.extractPdfText(lib, new Uint8Array(), { signal: ac.signal, onProgress: (done) => { if (done === 1) ac.abort(); } }), (e) => e.code === 'aborted');
});

test('pdfErrorMessage: 종류별 문장', () => {
  for (const code of ['password', 'too_many_pages', 'aborted', 'invalid', 'other']) {
    assert.ok(PN.pdfErrorMessage({ code }).length > 5, code);
  }
  assert.match(PN.pdfErrorMessage({ code: 'password' }), /비밀번호/);
});

test('extractedFileName: .pdf를 떼고 "-추출본문.txt"를 붙이며, 파일 이름에 못 쓰는 글자는 바꾼다', () => {
  assert.equal(PN.extractedFileName('paper.pdf'), 'paper-추출본문.txt');
  assert.equal(PN.extractedFileName('My Paper.PDF'), 'My Paper-추출본문.txt');
  assert.equal(PN.extractedFileName('a/b:c*d?.pdf'), 'a_b_c_d_-추출본문.txt');
  assert.equal(PN.extractedFileName(''), 'paper-추출본문.txt');
  assert.equal(PN.extractedFileName(undefined), 'paper-추출본문.txt');
  assert.equal(PN.extractedFileName('.pdf'), 'paper-추출본문.txt');
});
