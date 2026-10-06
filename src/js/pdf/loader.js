// pdf.js 불러오기. PDF를 처음 끌어다 놓을 때 한 번만 내려받고(첫 화면 용량에는 영향 없음), 같은 출처의 vendor/pdfjs/에서 가져온다.
// 외부 서버(CDN)를 쓰지 않으므로 무결성은 저장소의 고정 해시 시험(tests/vendor.test.mjs)이 지킨다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var LIB = './vendor/pdfjs/pdf.min.mjs';
  var WORKER = './vendor/pdfjs/pdf.worker.min.mjs';
  var pending = null;

  // → pdf.js 모듈. 실패하면 다음 호출에서 다시 시도한다.
  PN.loadPdfjs = function () {
    if (!pending) {
      pending = import(LIB).then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = new URL(WORKER, g.location.href).href;
        return lib;
      }).catch(function (e) {
        pending = null;
        throw e;
      });
    }
    return pending;
  };
})(globalThis);
