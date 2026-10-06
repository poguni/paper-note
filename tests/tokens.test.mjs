import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cssDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'css');
const read = (f) => readFileSync(join(cssDir, f), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const themes = ['academic', 'education'];
const parse = (css) =>
  Object.fromEntries([...stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const tokens = Object.fromEntries(themes.map((t) => [t, parse(read(`tokens-${t}.css`))]));

test('두 테마가 같은 이름의 토큰을 정의한다', () => {
  const a = Object.keys(tokens.academic).sort();
  const e = Object.keys(tokens.education).sort();
  assert.deepEqual(a, e);
  assert.ok(a.length > 40, '토큰이 너무 적음');
});

test('컴포넌트 CSS에는 색 코드와 글꼴 이름을 직접 쓰지 않는다 (DESIGN.md 1의 3)', () => {
  const files = readdirSync(cssDir).filter((f) => f.endsWith('.css') && !f.startsWith('tokens-'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const css = stripComments(read(f));
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${f}: 색 코드를 직접 씀`);
    assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla)\(/, `${f}: 색 함수를 직접 씀`);
    for (const m of css.matchAll(/font-family\s*:\s*([^;]+);/g)) {
      assert.match(m[1].trim(), /^var\(--font-/, `${f}: font-family를 직접 씀 (${m[1].trim()})`);
    }
    for (const m of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      assert.ok(Number(m[1]) >= 12, `${f}: 12px 미만 글자 크기 (${m[1]}px)`);
    }
  }
});

test('토큰 값의 글자 크기는 12px 이상', () => {
  for (const t of themes) {
    for (const [name, value] of Object.entries(tokens[t])) {
      if (name.startsWith('--fs-')) assert.ok(parseFloat(value) >= 12, `${t} ${name} = ${value}`);
    }
  }
});

// ---- 명암비 (DESIGN.md 1의 5, 7): 일반 글씨는 4.5:1 이상
const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [글씨 토큰, 배경 토큰]
const pairs = [
  ['--text', '--bg-app'], ['--text', '--bg-surface'], ['--text', '--bg-surface-raised'], ['--text', '--bg-selected'],
  ['--text-muted', '--bg-app'], ['--text-muted', '--bg-surface'],
  ['--text-subtle', '--bg-app'], ['--text-subtle', '--bg-surface'],
  ['--accent-on', '--accent'], ['--accent-strong', '--accent-soft'], ['--accent-strong', '--bg-surface'],
  ['--text', '--ok'], // 4단계 표시에서 완료 단계의 ✓
  ['--on-splash', '--splash-bg'], ['--on-splash-muted', '--splash-bg'], // 로그인 첫 화면의 로고 글씨 (배경 이미지의 가장 밝은 부분을 뜻하는 색)
  ['--sidebar-text', '--sidebar-bg'], ['--sidebar-text-active', '--sidebar-active-bg'], ['--sidebar-muted', '--sidebar-bg'],
  ['--chip-source-text', '--chip-source-bg'], ['--chip-source2-text', '--chip-source2-bg'],
  ['--chip-pdf-text', '--chip-pdf-bg'], ['--chip-saved-text', '--chip-saved-bg'],
  ['--tile-purpose-text', '--tile-purpose-bg'], ['--tile-method-text', '--tile-method-bg'],
  ['--tile-result-text', '--tile-result-bg'], ['--tile-limit-text', '--tile-limit-bg'],
];

for (const t of themes) {
  test(`${t}: 글씨와 배경 조합의 명암비가 4.5:1 이상`, () => {
    const failures = [];
    for (const [fg, bg] of pairs) {
      const f = tokens[t][fg];
      const b = tokens[t][bg];
      assert.match(f, /^#[0-9A-Fa-f]{6}$/, `${t} ${fg}가 6자리 색 코드가 아님: ${f}`);
      assert.match(b, /^#[0-9A-Fa-f]{6}$/, `${t} ${bg}가 6자리 색 코드가 아님: ${b}`);
      const r = ratio(f, b);
      if (r < 4.5) failures.push(`${fg} ${f} on ${bg} ${b} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(failures, [], `명암비 미달:\n${failures.join('\n')}`);
  });
}
