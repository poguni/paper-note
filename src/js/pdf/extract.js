// PDF 텍스트 추출. PDF 파일은 브라우저 안에서만 읽고, 어디에도 올리거나 저장하지 않는다. (PRD "PDF 처리")
(function (g) {
  var PN = (g.PN = g.PN || {});

  PN.PDF_MAX_BYTES = 40 * 1024 * 1024; // 논문 PDF로는 충분히 크고, 브라우저 메모리를 넘기지 않는 크기
  PN.PDF_MAX_PAGES = 300;
  var SCAN_CHARS_PER_PAGE = 100; // 쪽당 평균 글자 수가 이보다 적으면 스캔본으로 본다

  // 올려 둔 파일을 열기 전에 확인한다. 문제가 있으면 사용자에게 보일 문장, 괜찮으면 null.
  // head: 파일 앞부분 바이트(ArrayBuffer 또는 Uint8Array). PDF는 항상 "%PDF"로 시작한다.
  PN.checkPdfFile = function (file, head) {
    var name = String(file.name || '');
    var looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
    if (!looksPdf) return 'PDF 파일만 올릴 수 있습니다.';
    if (!file.size) return '빈 파일입니다.';
    if (file.size > PN.PDF_MAX_BYTES) return 'PDF가 너무 큽니다. ' + Math.round(PN.PDF_MAX_BYTES / 1048576) + 'MB 이하만 처리할 수 있습니다.';
    if (head) {
      var bytes = new Uint8Array(head).subarray(0, 1024);
      var text = '';
      for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      if (text.indexOf('%PDF') < 0) return 'PDF 형식이 아닌 파일입니다.';
    }
    return null;
  };

  // items(pdf.js의 getTextContent 항목) → 줄 목록 [{ text, size }]. size는 그 줄의 가장 큰 글자 높이(제목 판별에 쓴다).
  PN.itemsToLines = function (items) {
    var lines = [];
    var text = '';
    var size = 0;
    function flush() {
      var t = text.replace(/\s+$/, '').replace(/^\s+/, '');
      if (t) lines.push({ text: t, size: size });
      text = '';
      size = 0;
    }
    items.forEach(function (it) {
      if (typeof it.str !== 'string') return; // 표식 항목(beginMarkedContent 등)
      text += it.str;
      var h = it.height || (it.transform && Math.abs(it.transform[3])) || 0;
      if (it.str.trim() && h > size) size = h;
      if (it.hasEOL) flush();
    });
    flush();
    return lines;
  };

  // 스캔본 판단: 글자가 거의 없으면 텍스트를 뽑을 수 없는 PDF(이미지)로 본다.
  PN.looksScanned = function (pages) {
    if (!pages.length) return true;
    var chars = pages.reduce(function (sum, p) { return sum + p.text.replace(/\s/g, '').length; }, 0);
    return chars / pages.length < SCAN_CHARS_PER_PAGE;
  };

  // lib: pdf.js 모듈(PN.loadPdfjs()), data: Uint8Array, opts: { onProgress(done, total), signal }
  // → { numPages, pages: [{ n, lines[], text }], charCount, scanned }
  // 쪽 수가 한도를 넘으면 오류를 던진다. 비밀번호가 있는 PDF 등은 pdf.js의 오류를 code로 구분해 던진다.
  PN.extractPdfText = async function (lib, data, opts) {
    opts = opts || {};
    var task = lib.getDocument({ data: data });
    var doc;
    try {
      doc = await task.promise;
    } catch (e) {
      var err = new Error('pdf open failed');
      err.name = 'PdfError';
      err.code = e && e.name === 'PasswordException' ? 'password' : 'invalid';
      throw err;
    }
    try {
      if (doc.numPages > PN.PDF_MAX_PAGES) {
        var big = new Error('too many pages');
        big.name = 'PdfError';
        big.code = 'too_many_pages';
        throw big;
      }
      var pages = [];
      for (var i = 1; i <= doc.numPages; i++) {
        if (opts.signal && opts.signal.aborted) {
          var stop = new Error('aborted');
          stop.name = 'PdfError';
          stop.code = 'aborted';
          throw stop;
        }
        var page = await doc.getPage(i);
        var content = await page.getTextContent();
        var lines = PN.itemsToLines(content.items);
        pages.push({ n: i, lines: lines, text: lines.map(function (l) { return l.text; }).join('\n') });
        if (opts.onProgress) opts.onProgress(i, doc.numPages);
      }
      var charCount = pages.reduce(function (sum, p) { return sum + p.text.length; }, 0);
      return { numPages: doc.numPages, pages: pages, charCount: charCount, scanned: PN.looksScanned(pages) };
    } finally {
      if (doc.destroy) doc.destroy();
    }
  };

  // 추출 본문을 내려받을 때의 파일 이름: "paper.pdf" → "paper-추출본문.txt" (파일 이름에 쓸 수 없는 글자는 뺀다)
  PN.extractedFileName = function (pdfName) {
    var base = String(pdfName || 'paper').replace(/\.pdf$/i, '').replace(/[\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'paper';
    return base + '-추출본문.txt';
  };

  PN.pdfErrorMessage = function (e) {
    switch (e && e.code) {
      case 'password': return '비밀번호가 걸린 PDF는 처리할 수 없습니다. 비밀번호를 해제한 파일을 올려 주세요.';
      case 'too_many_pages': return 'PDF가 ' + PN.PDF_MAX_PAGES + '쪽을 넘어 처리할 수 없습니다.';
      case 'aborted': return 'PDF 처리를 취소했습니다.';
      case 'invalid': return 'PDF를 열 수 없습니다. 파일이 손상되었을 수 있습니다.';
      default: return 'PDF를 처리하지 못했습니다. 다시 시도하세요.';
    }
  };
})(globalThis);
