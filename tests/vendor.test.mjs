import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// pdfjs-dist 6.4.299의 build/ 파일. 버전을 올릴 때 vendor/pdfjs/README.md의 절차대로 함께 바꾼다.
const PINNED = {
  'pdf.min.mjs': 'sha384-QCvhu/UPp22U/TNLVbQNONL82ES2yY717GAiqP9VVu37Y7+m9VPKvadGx9XlFvcp',
  'pdf.worker.min.mjs': 'sha384-NfW/OTMWezITv4oaALvfH7MFLwzPxEvpySmDpoALa1mtTY8MC200l0ZNFD+SOlrM',
};
const sha384 = (path) => 'sha384-' + createHash('sha384').update(readFileSync(path)).digest('base64');

test('vendor/pdfjs 파일이 고정한 해시와 같다 (변조·실수로 바뀐 경우 감지)', () => {
  for (const [name, hash] of Object.entries(PINNED)) {
    assert.equal(sha384(join(root, 'vendor', 'pdfjs', name)), hash, name);
  }
  assert.ok(existsSync(join(root, 'vendor', 'pdfjs', 'LICENSE')), 'Apache-2.0 라이선스 파일이 있어야 함');
});

test('build가 pdf.js를 dist/vendor로 복사하고, 내용이 원본과 같다', () => {
  const { outFile } = build();
  for (const [name, hash] of Object.entries(PINNED)) {
    assert.equal(sha384(join(dirname(outFile), 'vendor', 'pdfjs', name)), hash, `dist: ${name}`);
  }
});

test('index.html은 pdf.js를 외부 서버(CDN)에서 불러오지 않는다', () => {
  const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /pdf(\.worker)?(\.min)?\.m?js/);
  const loader = readFileSync(join(root, 'src', 'js', 'pdf', 'loader.js'), 'utf8');
  assert.doesNotMatch(loader, /https?:\/\//);
});
