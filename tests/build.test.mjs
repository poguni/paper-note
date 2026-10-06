import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../scripts/build.mjs';

const built = () => readFileSync(build().outFile, 'utf8');

test('build가 CSS와 JS를 dist/index.html 하나에 인라인한다', () => {
  const html = built();
  assert.ok(!html.includes('@inline-'), '인라인 표시가 남아 있음');
  assert.ok(html.includes('<style>') && html.includes('--bg-app'));
  assert.ok(html.includes('PN.createStore') && html.includes("dataset.ready = '1'"));
});

test('테마 초기화 스크립트가 어떤 스타일보다 먼저 나온다 (깜빡임 방지)', () => {
  const html = built();
  const themeAt = html.indexOf("'pn_theme'");
  assert.ok(themeAt > 0, '테마 초기화 스크립트가 없음');
  assert.ok(themeAt < html.indexOf('<style>'), '테마 스크립트가 첫 <style>보다 뒤에 있음');
});

test('상단 막대, 4단계 표시, 테마 전환에 필요한 요소가 빌드 결과에 있다', () => {
  const html = built();
  for (const id of ['topbar', 'steps', 'key-chip', 'key-chip-dot', 'key-chip-text', 'model-slot', 'theme-options', 'theme-quick', 'theme-quick-text', 'theme-note']) {
    assert.ok(html.includes(`id="${id}"`), `#${id}가 없음`);
  }
  assert.ok(html.includes('PN.renderSteps') && html.includes('PN.initThemeSwitch'), '4단계 표시나 테마 전환 스크립트가 없음');
  assert.ok(html.includes('[data-theme-scope="education"]'), '미리보기용 토큰 선택자가 없음');
});

test('테마 전환 미리보기는 두 테마의 토큰을 각각 켠다', () => {
  const html = built();
  for (const t of ['academic', 'education']) assert.ok(html.includes(`[data-theme-scope="${t}"]`), t);
});

test('모델 비교 화면(F16)의 스크립트와 스타일이 빌드 결과에 있다', () => {
  const html = built();
  assert.ok(html.includes('PN.defaultComparePair') && html.includes('PN.openCompare'), '비교 스크립트가 없음');
  assert.ok(html.includes('.cmp-grid'), '비교 화면 스타일이 없음');
});
