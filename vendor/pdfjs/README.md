# pdf.js (vendored)

- 패키지: `pdfjs-dist` 6.4.299 (npm 레지스트리의 공식 배포본), 라이선스 Apache-2.0 (`LICENSE`)
- 파일: `pdf.min.mjs`(라이브러리), `pdf.worker.min.mjs`(워커) — `build/` 폴더의 원본을 수정하지 않고 그대로 복사
- 무결성: 두 파일의 SHA-384 값이 `tests/vendor.test.mjs`에 고정되어 있어, 파일이 바뀌면 시험이 실패한다.
- 버전을 올릴 때: `npm pack pdfjs-dist@<버전>`으로 받아 두 파일과 LICENSE를 바꾸고, 시험의 해시 값과 이 문서의 버전을 함께 고친다.
- 앱은 PDF를 끌어다 놓을 때만 이 파일들을 불러온다(첫 화면 용량에 영향 없음). `npm run build`가 `dist/vendor/pdfjs/`로 복사한다.
