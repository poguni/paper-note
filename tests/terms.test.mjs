import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 5.3 약관 점검을 코드로 고정한다: arXiv 호출 규칙을 지키고, PDF 원본과 추출 텍스트를 저장하거나 보내지 않는다.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const jsFiles = files(join(root, 'src', 'js')).filter((p) => p.endsWith('.js'));
const pdfFiles = [...files(join(root, 'src', 'js', 'pdf')), join(root, 'src', 'js', 'pdf-screen.js')].filter((p) => p.endsWith('.js'));

test('PDF 처리 코드(src/js/pdf, pdf-screen.js)에는 저장소, 네트워크 호출이 없다', () => {
  assert.ok(pdfFiles.length >= 4);
  for (const p of pdfFiles) {
    const code = stripComments(readFileSync(p, 'utf8'));
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|caches\b|document\.cookie/, `${p}: 브라우저 저장소 사용`);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/, `${p}: 네트워크 호출`);
    assert.doesNotMatch(code, /\.from\(\s*['"]pn_/, `${p}: DB 접근`);
  }
});

test('앱이 PDF를 내려받지 않는다: 네트워크 호출은 중계 함수와 OpenRouter로 가는 두 길뿐', () => {
  const callers = jsFiles.filter((p) => /\bfetch\s*\(/.test(stripComments(readFileSync(p, 'utf8')))).map((p) => p.split(/[\\/]/).slice(-2).join('/'));
  // relay.js와 openrouter.js가 요청을 보내고, app.js와 search-screen.js는 그 둘에 전역 fetch를 그대로 넘겨 주기만 한다
  assert.deepEqual(callers.sort(), ['ai/openrouter.js', 'js/app.js', 'js/search-screen.js', 'search/relay.js']);
  for (const f of ['app.js', 'search-screen.js']) {
    const code = stripComments(read('src', 'js', f));
    const calls = code.match(/[\w.]*fetch\s*\([^)]*\)/g) || [];
    assert.deepEqual([...new Set(calls)], ['globalThis.fetch(url, init)'], `${f}: 주소를 직접 만들어 호출함`);
  }
  // 요청 주소는 설정의 Supabase 함수 주소와 OpenRouter 고정 주소뿐
  assert.match(read('src', 'js', 'ai', 'openrouter.js'), /OPENROUTER_URL = 'https:\/\/openrouter\.ai\//);
  assert.match(read('src', 'js', 'search-screen.js'), /url: PN\.config\.supabaseUrl \+ '\/functions\/v1\/pn-search-proxy'/);
});

test('저장 대상: 논문 행에는 PDF 본문이나 파일이 들어가지 않는다 (허용된 열만)', async () => {
  await import('../src/js/db/papers.js');
  const row = globalThis.PN.paperToRow({
    source: 'arxiv', sourceId: '1', title: 't', authors: ['a'], year: 2020, abstract: 'abs', pdfText: '본문 전체', pdfFile: new Uint8Array(3), fullText: 'x',
  });
  assert.deepEqual(Object.keys(row).sort(), ['abstract', 'authors', 'categories', 'citation_count', 'doi', 'landing_url', 'pdf_url', 'published_date', 'source', 'source_id', 'title', 'year'].sort());
  assert.ok(!JSON.stringify(row).includes('본문 전체'));
});

test('arXiv 호출: 브라우저가 직접 부르지 않고 중계 함수만 부른다', () => {
  for (const p of jsFiles) {
    assert.doesNotMatch(readFileSync(p, 'utf8'), /export\.arxiv\.org/, `${p}: arXiv를 직접 호출`);
  }
  assert.match(read('supabase', 'functions', 'pn-search-proxy', 'requests.ts'), /export\.arxiv\.org\/api\/query/);
});

test('arXiv 호출 간격: 브라우저 대기열과 중계 함수 모두 3초에 한 번, 한 줄로 (연결 1개)', () => {
  assert.match(read('src', 'js', 'search-screen.js'), /arxiv:\s*PN\.createQueue\(3000,/);
  assert.match(read('supabase', 'functions', 'pn-search-proxy', 'index.ts'), /createGate\(3000,/);
  // 대기열은 앞선 호출이 끝나야 다음을 보내는 한 줄 구조다 (tail 체인)
  const queue = read('src', 'js', 'search', 'queue.js');
  assert.match(queue, /tail\s*=\s*run\.catch/);
});

test('중계 함수는 사용자를 알아볼 수 있는 User-Agent를 보낸다', () => {
  assert.match(read('supabase', 'functions', 'pn-search-proxy', 'handler.ts'), /USER_AGENT\s*=\s*'PaperNote\//);
});
