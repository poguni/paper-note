// 논문 상세 패널: 검색 화면과 내 서재가 같이 쓴다. 메타데이터, AI 분석, PDF 드롭존, 초록 원문, 메모를 그린다.
//   cfg: { container, side(오른쪽 결과 열, 선택), papersApi, analysis, pdf, getRow(paper) → 저장된 논문 행({ id }) 또는 undefined, onToggleSave(paper, button) }
(function (g) {
  var PN = (g.PN = g.PN || {});

  PN.createDetailPanel = function (cfg) {
    var memoNo = 0; // 늦게 도착한 이전 논문의 메모가 지금 화면을 덮지 않게 한다

    function clearSide() {
      if (!cfg.side) return;
      cfg.side.textContent = '';
      cfg.side.hidden = true;
      if (cfg.side.parentElement) cfg.side.parentElement.classList.remove('has-side');
    }

    // paper가 없으면 안내만 보인다
    function render(paper) {
      memoNo++;
      cfg.container.textContent = '';
      clearSide();
      if (!paper) {
        cfg.analysis.detach(); // 지워진 상세에 늦게 도착한 결과가 오른쪽 열을 다시 채우지 못하게 한다
        var p = document.createElement('p');
        p.className = 'detail-hint';
        p.textContent = '논문을 고르면 상세 정보가 여기에 나옵니다.';
        cfg.container.appendChild(p);
        return;
      }
      var row = cfg.getRow(paper);
      var view = PN.renderDetail(paper, !!row, {
        onToggleSave: cfg.onToggleSave,
        onSaveMemo: async function (text) {
          if (!(await cfg.papersApi.saveMemo(row.id, text))) throw new Error('memo row is gone');
        }
      });
      cfg.container.appendChild(view.node);
      cfg.analysis.renderInto(view.analysisBox, paper, row, cfg.side);
      cfg.pdf.renderInto(view.pdfBox, paper);
      if (!row) return;
      var no = memoNo;
      cfg.papersApi.getMemo(row.id).then(function (text) {
        if (no !== memoNo) return;
        if (text === null) view.memo.fail('이 논문은 이미 저장 목록에서 지워졌습니다.');
        else view.memo.show(text);
      }, function (e) {
        if (no === memoNo) view.memo.fail(PN.dbErrorMessage(e, '메모 불러오기'));
      });
    }

    return { render: render };
  };
})(globalThis);
