// 논문 상세 안의 PDF 드롭존 (DESIGN.md 5.6): 대기, 끌어올 때, 처리 중, 완료, 스캔본 경고, 실패.
// PDF 원본과 추출 텍스트는 저장하지 않는다. 읽은 결과(섹션으로 나눈 본문)만 이 화면이 열려 있는 동안 메모리에 둔다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var PREVIEW_SECTIONS = 60; // 미리보기에 그리는 섹션 수 상한 (쪽 단위 분할이면 수백 개가 될 수 있다)
  var PREVIEW_CHARS = 3000; // 섹션 하나의 미리보기 글자 수 상한

  var ICON = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"></path></svg>';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function sizeText(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(bytes / 1024)) + 'KB';
  }

  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0;
  }

  // opts.onChange: 본문 준비 상태가 바뀔 때 부른다 (분석 구역이 단계 선택을 다시 그리도록)
  PN.initPdf = function (opts) {
    opts = opts || {};
    var states = new Map(); // 논문 열쇠 → { status, file, progress, prepared, message, showPreview }
    var aborts = new Map();
    var shown = null;

    // 영역 밖에 놓은 파일을 브라우저가 열어 버려 앱이 사라지는 것을 막는다
    g.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    g.addEventListener('drop', function (e) { if (hasFiles(e)) e.preventDefault(); });

    function refresh() {
      if (shown) render(shown.box, shown.paper);
    }

    function changed() {
      refresh();
      if (opts.onChange) opts.onChange();
    }

    async function handle(paper, file, extraCount) {
      var key = PN.paperKey(paper);
      var info = { name: file.name, size: file.size };
      var problem;
      try { problem = PN.checkPdfFile(file, await file.slice(0, 1024).arrayBuffer()); } catch (e) { problem = 'PDF 파일을 읽을 수 없습니다.'; }
      if (problem) { states.set(key, { status: 'error', file: info, message: problem }); changed(); return; }

      var ac = new AbortController();
      aborts.set(key, ac);
      var st = { status: 'processing', file: info, progress: { done: 0, total: 0 }, extra: extraCount };
      states.set(key, st);
      changed();
      try {
        var lib = await PN.loadPdfjs();
        var data = new Uint8Array(await file.arrayBuffer());
        var res = await PN.extractPdfText(lib, data, {
          signal: ac.signal,
          onProgress: function (done, total) { st.progress = { done: done, total: total }; refresh(); }
        });
        if (res.scanned) {
          states.set(key, { status: 'scanned', file: info, pages: res.numPages });
        } else {
          states.set(key, { status: 'done', file: info, pages: res.numPages, prepared: PN.prepareFullText(res.pages), extra: extraCount });
        }
      } catch (e) {
        if (e && e.code === 'aborted') states.delete(key);
        else states.set(key, { status: 'error', file: info, message: PN.pdfErrorMessage(e) });
      }
      aborts.delete(key);
      changed();
    }

    function picker(paper, label, className) {
      var wrap = el('label', className || 'btn btn-sm btn-secondary');
      wrap.appendChild(document.createTextNode(label));
      var input = el('input');
      input.type = 'file';
      input.accept = 'application/pdf,.pdf';
      input.className = 'visually-hidden';
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) handle(paper, input.files[0], input.files.length - 1);
        input.value = '';
      });
      wrap.appendChild(input);
      return wrap;
    }

    // 사용자가 요청했을 때만 내 컴퓨터로 파일을 내려받는다 (앱이 보관하는 것이 아니다)
    function download(fileName, text) {
      var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function previewNode(prepared) {
      var box = el('div', 'pdf-preview');
      prepared.sections.slice(0, PREVIEW_SECTIONS).forEach(function (s) {
        var d = el('details', 'pdf-section');
        d.appendChild(el('summary', null, (s.title || '(제목·저자 부분)') + ' · ' + s.text.length.toLocaleString('ko-KR') + '자'));
        var text = s.text.length > PREVIEW_CHARS ? s.text.slice(0, PREVIEW_CHARS) + '\n… (이하 생략, 분석에는 전체가 쓰입니다)' : s.text;
        d.appendChild(el('pre', null, text));
        box.appendChild(d);
      });
      if (prepared.sections.length > PREVIEW_SECTIONS) box.appendChild(el('p', 'detail-hint', '섹션 ' + (prepared.sections.length - PREVIEW_SECTIONS) + '개는 미리보기에서 생략했습니다.'));
      return box;
    }

    function render(box, paper) {
      shown = { box: box, paper: paper };
      box.textContent = '';
      var key = PN.paperKey(paper);
      var st = states.get(key) || { status: 'idle' };
      box.appendChild(el('h3', null, 'PDF 본문 분석'));

      var zone = el('div', 'dropzone');
      zone.dataset.state = st.status;
      zone.setAttribute('role', 'group');
      zone.setAttribute('aria-label', 'PDF 끌어다 놓기');

      if (st.status === 'idle') {
        var icon = el('span', 'dropzone-icon');
        icon.innerHTML = ICON; // 고정된 아이콘 문자열
        zone.appendChild(icon);
        var txt = el('div');
        txt.appendChild(el('div', 'dropzone-title', 'PDF를 끌어다 놓으면 본문 단계 분석이 열립니다'));
        txt.appendChild(el('div', 'dropzone-sub', 'PDF 파일은 저장하지 않으며, 텍스트 추출은 브라우저에서 처리합니다.'));
        if (PN.safeUrl(paper.pdfUrl)) txt.appendChild(el('div', 'dropzone-sub', '"원문 PDF 열기"로 받은 PDF를 여기에 놓으세요.'));
        zone.appendChild(txt);
        zone.appendChild(picker(paper, 'PDF 파일 선택'));
      } else if (st.status === 'processing') {
        var line = el('div', 'dropzone-title', 'PDF를 읽는 중입니다… ' + (st.progress.total ? st.progress.done + '/' + st.progress.total + '쪽' : ''));
        line.setAttribute('role', 'status');
        zone.appendChild(line);
        var bar = el('progress');
        bar.max = st.progress.total || 1;
        bar.value = st.progress.done;
        bar.setAttribute('aria-label', 'PDF 읽는 중');
        zone.appendChild(bar);
        var cancel = el('button', 'btn btn-sm btn-secondary', '취소');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { var ac = aborts.get(key); if (ac) ac.abort(); });
        zone.appendChild(cancel);
      } else if (st.status === 'done') {
        var p = st.prepared;
        var head = el('div', 'dropzone-title', '✓ ' + st.file.name + ' (' + sizeText(st.file.size) + ')');
        head.setAttribute('role', 'status');
        zone.appendChild(head);
        var facts = [st.pages + '쪽', '섹션 ' + p.sections.length + '개', '본문 약 ' + p.tokens.toLocaleString('ko-KR') + '토큰'];
        facts.push(p.referencesFound ? '참고문헌 제외(' + p.referencesRemoved.chars.toLocaleString('ko-KR') + '자)' : '참고문헌 구분 못 찾음');
        zone.appendChild(el('div', 'dropzone-sub', facts.join(' · ')));
        if (p.mode === 'pages') zone.appendChild(el('div', 'dropzone-sub dropzone-warn', '섹션 제목을 찾지 못해 쪽 단위로 나눴습니다.'));
        if (!p.referencesFound) zone.appendChild(el('div', 'dropzone-sub dropzone-warn', '참고문헌 부분을 찾지 못해 전체 텍스트를 포함합니다. 비용이 늘 수 있습니다.'));
        if (st.extra > 0) zone.appendChild(el('div', 'dropzone-sub dropzone-warn', '여러 파일을 놓았지만 첫 번째 파일만 처리했습니다.'));
        var row = el('div', 'dropzone-actions');
        var tog = el('button', 'btn btn-sm btn-secondary', st.showPreview ? '미리보기 접기' : '추출 미리보기');
        tog.type = 'button';
        tog.setAttribute('aria-expanded', st.showPreview ? 'true' : 'false');
        tog.addEventListener('click', function () { st.showPreview = !st.showPreview; refresh(); });
        row.appendChild(tog);
        var dl = el('button', 'btn btn-sm btn-secondary', '추출 본문 내려받기');
        dl.type = 'button';
        dl.title = 'AI에 보내는 본문(참고문헌 제외)을 내 컴퓨터에 텍스트 파일로 저장합니다. 앱은 이 파일을 저장하지 않습니다.';
        dl.addEventListener('click', function () { download(PN.extractedFileName(st.file.name), p.text); });
        row.appendChild(dl);
        row.appendChild(picker(paper, '다른 파일 선택'));
        zone.appendChild(row);
      } else if (st.status === 'scanned') {
        var warn = el('div', 'dropzone-title', st.file.name + ': 텍스트를 읽을 수 없습니다');
        warn.setAttribute('role', 'alert');
        zone.appendChild(warn);
        zone.appendChild(el('div', 'dropzone-sub', '스캔한 이미지 PDF로 보입니다. 본문 단계는 쓸 수 없고, 초록 단계 분석만 가능합니다.'));
        zone.appendChild(picker(paper, '다른 파일 선택'));
      } else { // error
        var fail = el('div', 'dropzone-title', st.message);
        fail.setAttribute('role', 'alert');
        zone.appendChild(fail);
        zone.appendChild(picker(paper, '다시 선택'));
      }
      box.appendChild(zone);
      if (st.status === 'done' && st.showPreview) box.appendChild(previewNode(st.prepared));

      // 끌어다 놓기: 처리 중에는 새 파일을 받지 않는다
      var depth = 0;
      zone.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; zone.dataset.over = 'true'; });
      zone.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = st.status === 'processing' ? 'none' : 'copy'; });
      zone.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) delete zone.dataset.over; });
      zone.addEventListener('drop', function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        delete zone.dataset.over;
        var files = e.dataTransfer.files;
        if (st.status === 'processing' || !files || !files.length) return;
        handle(paper, files[0], files.length - 1);
      });
    }

    return {
      renderInto: render,
      // 3.11의 본문 단계 분석이 쓸 값: 섹션으로 나눈 본문 또는 null
      getPrepared: function (paper) {
        var st = states.get(PN.paperKey(paper));
        return st && st.status === 'done' ? st.prepared : null;
      }
    };
  };
})(globalThis);
