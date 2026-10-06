// src/index.html 안의 인라인 표시를 파일 내용으로 바꿔 dist/index.html 하나로 합친다.
//   <!-- @inline-css css/base.css -->  → <style>...</style>
//   <!-- @inline-js js/app.js -->      → <script>...</script>
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const outFile = join(root, 'dist', 'index.html');

export function build() {
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const out = html.replace(/<!--\s*@inline-(css|js)\s+(\S+)\s*-->/g, (_, kind, path) => {
    const body = readFileSync(join(srcDir, path), 'utf8').replace(/\s+$/, '');
    return kind === 'css' ? `<style>\n${body}\n</style>` : `<script>\n${body}\n</script>`;
  });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, out);
  // 같은 출처에서 불러오는 외부 라이브러리(pdf.js). PDF를 끌어다 놓을 때만 내려받는다.
  cpSync(join(root, 'vendor'), join(dirname(outFile), 'vendor'), { recursive: true });
  // 스플래시 배경과 앱 아이콘 (public/). 원본 PNG(4.5MB)는 JPG와 같은 그림이라 올리지 않는다.
  cpSync(join(root, 'public'), dirname(outFile), { recursive: true, filter: (src) => !src.endsWith('papernote_splash.png') });
  return { outFile, bytes: Buffer.byteLength(out) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outFile: f, bytes } = build();
  console.log(`built ${f} (${bytes} bytes)`);
}
