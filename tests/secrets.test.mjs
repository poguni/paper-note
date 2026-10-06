import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const sources = files(srcDir).map((p) => ({ p, text: readFileSync(p, 'utf8') }));

test('소스에 비밀 키가 없다 (Supabase secret 키, OpenRouter 키)', () => {
  assert.ok(sources.length > 5);
  for (const { p, text } of sources) {
    assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9_-]{8,}/, `${p}: Supabase secret 키`);
    assert.doesNotMatch(text, /sk-or-[A-Za-z0-9_-]{10,}/, `${p}: OpenRouter 키`);
  }
});

test('소스의 JWT 형태 값은 service_role이 아니다', () => {
  for (const { p, text } of sources) {
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      assert.notEqual(payload.role, 'service_role', `${p}: service_role 키가 들어 있음`);
    }
  }
});

test('Supabase 설정은 공개용(publishable) 키만 쓴다', () => {
  const config = readFileSync(join(srcDir, 'js', 'config.js'), 'utf8');
  assert.match(config, /supabaseKey:\s*'sb_publishable_/);
});

test('외부 스크립트는 버전이 고정되어 있고 무결성 해시(SRI)가 있다', () => {
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="https?:[^"]+"[^>]*>/g)].map((m) => m[0]);
  assert.ok(tags.length >= 1);
  for (const t of tags) {
    assert.match(t, /@\d+\.\d+\.\d+\//, `버전 미고정: ${t}`);
    assert.match(t, /integrity="sha384-/, `SRI 없음: ${t}`);
    assert.match(t, /crossorigin=/, `crossorigin 없음: ${t}`);
  }
});

// ---- 콘텐츠 보안 정책(CSP): 키가 허용 목록 밖으로 나가는 길을 막는다
import { readFileSync as readSrc } from 'node:fs';
import { fileURLToPath as toPath } from 'node:url';

function cspOf() {
  const html = readSrc(toPath(new URL('../src/index.html', import.meta.url)), 'utf8');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'CSP 메타 태그가 없음');
  return Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
}

test('CSP: 기본은 모두 막고, 연결 대상은 Supabase와 OpenRouter뿐이다', async () => {
  await import('../src/js/config.js');
  await import('../src/js/ai/openrouter.js');
  const csp = cspOf();
  assert.deepEqual(csp['default-src'], ["'none'"]);
  const supabase = new URL(globalThis.PN.config.supabaseUrl).origin;
  const openrouter = new URL(globalThis.PN.OPENROUTER_URL).origin;
  assert.deepEqual([...csp['connect-src']].sort(), ["'self'", openrouter, supabase].sort());
});

test('CSP: 와일드카드(*)나 data:/http: 전체 허용이 없고, base-uri는 막는다', () => {
  const csp = cspOf();
  for (const [name, values] of Object.entries(csp)) {
    for (const v of values) {
      assert.ok(v !== '*' && v !== 'http:' && v !== 'https:', `${name}에 ${v} 허용`);
      assert.ok(!v.includes('*'), `${name}에 와일드카드: ${v}`);
    }
  }
  assert.deepEqual(csp['base-uri'], ["'none'"]);
  assert.ok(!(csp['script-src'] || []).includes("'unsafe-eval'"), 'unsafe-eval 허용');
  assert.ok(!csp['img-src'].includes('https:'), '이미지 외부 허용');
});

test('CSP: 스크립트는 같은 출처와 jsDelivr만, 글꼴은 Google 글꼴만 허용한다', () => {
  const csp = cspOf();
  assert.deepEqual(csp['script-src'].filter((v) => v.startsWith('http')), ['https://cdn.jsdelivr.net']);
  assert.deepEqual(csp['style-src'].filter((v) => v.startsWith('http')), ['https://fonts.googleapis.com']);
  assert.deepEqual(csp['font-src'], ['https://fonts.gstatic.com']);
});
