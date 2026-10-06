// 수동 확인용 (자동 테스트에 포함되지 않음). 같은 논문을 같은 프롬프트로 모델 3종에 분석시키고, 결과와 비용, 객관 지표를 표로 모은다.
// 앱이 쓰는 것과 같은 코드(프롬프트, 스키마, 검증, 재시도)를 그대로 불러 쓰므로, 앱에서 분석한 것과 같은 조건의 비교다.
//
// 사용 (PowerShell, 키는 환경 변수로만 읽고 출력하지 않는다):
//   초록 단계:  node tests/manual/model-compare.mjs --stage abstract --arxiv 1406.5823
//   본문 단계:  node tests/manual/model-compare.mjs --stage fulltext --text 추출본문.txt --title "논문 제목" [--stats]
// 옵션:
//   --models a,b      비교할 모델 ID를 쉼표로 (기본: 앱의 모델 3종 모두)
//   --effort low      추론 강도를 모든 모델에 같게 (기본: 모델별 기본값. 모델이 지원하지 않는 값이면 그 모델의 기본값)
//   --authors "A, B" --year 2014   --text 방식일 때 논문 정보 (선택)
//   --yes             예상 비용이 기준(0.5달러)을 넘어도 확인 없이 실행
//   --out 폴더        결과 저장 위치 (기본: tests/manual/out)
// "추출본문.txt"는 앱의 PDF 드롭존에서 "추출 본문 내려받기"로 받은 파일이다. (앱이 AI에 보내는 바로 그 본문)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from './compare-metrics.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['search/terms', 'search/arxiv', 'ai/keystore', 'ai/models', 'ai/schema', 'ai/cost', 'ai/prompts', 'ai/openrouter', 'ai/analyze']) {
  await import(`../../src/js/${f}.js`);
}
const PN = globalThis.PN;

// ---- 인자
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[key] = true;
  else { args[key] = next; i++; }
}
const fail = (msg) => { console.error(msg); process.exit(1); };

const key = process.env.OPENROUTER_API_KEY;
if (!key) fail('OPENROUTER_API_KEY 환경변수가 없습니다.');
const stage = args.stage;
if (stage !== 'abstract' && stage !== 'fulltext') fail('--stage abstract 또는 --stage fulltext 를 지정하세요.');
const statsMode = stage === 'fulltext' && !!args.stats;

// ---- 입력 만들기
let paper;
let prepared = null;
if (args.arxiv) {
  const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(args.arxiv)}`);
  if (!res.ok) fail(`arXiv 요청 실패: HTTP ${res.status}`);
  const parsed = PN.arxiv.parseFeed(await res.text());
  paper = parsed.papers[0];
  if (!paper) fail('arXiv에서 논문을 찾지 못했습니다.');
}
if (args.text) {
  const text = readFileSync(args.text, 'utf8');
  prepared = { text };
  paper = paper || {
    title: args.title || args.text,
    authors: args.authors ? String(args.authors).split(',').map((s) => s.trim()) : [],
    year: args.year ? Number(args.year) : null,
    abstract: null,
  };
}
if (!paper) fail('--arxiv <ID> 또는 --text <파일> 중 하나가 필요합니다.');

const messages = stage === 'abstract' ? PN.buildAbstractMessages(paper) : PN.buildFulltextMessages(paper, prepared, { statsMode });
if (!messages) fail(stage === 'abstract' ? '이 논문에는 초록이 없어 초록 단계를 비교할 수 없습니다.' : '본문 텍스트가 없습니다. --text 로 추출 본문 파일을 지정하세요.');
const inputText = stage === 'abstract' ? paper.abstract : prepared.text;

const models = args.models ? String(args.models).split(',').map((s) => s.trim()) : PN.MODELS.map((m) => m.id);
for (const id of models) if (!PN.getModel(id)) fail(`알 수 없는 모델: ${id}`);

// ---- 실행 전 예상 비용
const inputJoined = messages.map((m) => m.content).join('\n');
let totalEstimate = 0;
console.log(`논문: ${paper.title}`);
console.log(`단계: ${stage}${statsMode ? ' (통계 분석 모드)' : ''}   입력: 약 ${PN.estimateTokens(inputJoined).toLocaleString('en-US')} 토큰`);
for (const id of models) {
  const est = PN.estimateAnalysis({ modelId: id, stage, statsMode, inputText: inputJoined });
  totalEstimate += est.costUsd;
  console.log(`  예상 ${id}: ${PN.formatCost(est.costUsd)}`);
}
console.log(`  예상 합계: ${PN.formatCost(totalEstimate)}`);
if (totalEstimate >= 0.5 && !args.yes) fail('예상 합계가 0.5달러 이상입니다. 그래도 실행하려면 --yes 를 붙이세요.');

// ---- 실행 (모델마다 한 번씩, 순서대로)
const client = PN.createOpenRouter({ getKey: () => key, fetch: (url, init) => fetch(url, init) });
const runs = [];
for (const id of models) {
  const model = PN.getModel(id);
  const effort = args.effort && model.reasoning.levels.includes(args.effort) ? args.effort : undefined;
  const t0 = Date.now();
  try {
    const out = await PN.runAnalysis(client, { modelId: id, stage, messages, statsMode, effort });
    runs.push({ id, label: model.label, ok: true, ms: Date.now() - t0, attempts: out.attempts, usage: out.usage, value: out.value, effort: effort || model.reasoning.default, metrics: measure(out.value, inputText) });
    console.log(`✔ ${model.label}  ${((Date.now() - t0) / 1000).toFixed(1)}초  시도 ${out.attempts}회  입력 ${out.usage.promptTokens} / 출력 ${out.usage.completionTokens} (추론 ${out.usage.reasoningTokens})  비용 $${out.usage.costUsd}`);
  } catch (e) {
    runs.push({ id, label: model.label, ok: false, ms: Date.now() - t0, error: `${e.name}: ${e.code || e.message}`, usage: e.usage || null });
    console.log(`✖ ${model.label}  실패: ${e.code || e.message}  ${e.usage ? `(쓴 비용 $${e.usage.costUsd})` : ''}`);
  }
}

// ---- 저장: 원본 JSON과 읽기 쉬운 마크다운
const outDir = args.out && args.out !== true ? args.out : join(root, 'tests', 'manual', 'out');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = join(outDir, `compare-${stage}-${stamp}`);
writeFileSync(`${base}.json`, JSON.stringify({ title: paper.title, stage, statsMode, runs }, null, 2));
writeFileSync(`${base}.md`, report(paper, stage, statsMode, runs));

console.log(`\n저장: ${base}.md (읽기용), ${base}.json (원본)`);
console.log('\n모델 | 시도 | 시간 | 입력 | 출력 | 추론 | 비용($) | 근거없는 숫자 | 섹션 범위 | 한국어 비율');
for (const r of runs) {
  if (!r.ok) { console.log(`${r.label} | 실패 (${r.error})`); continue; }
  const m = r.metrics;
  const cov = m.sectionCoverage ? `${m.sectionCoverage.covered}/${m.sectionCoverage.total}` : '-';
  console.log(`${r.label} | ${r.attempts} | ${(r.ms / 1000).toFixed(1)}초 | ${r.usage.promptTokens} | ${r.usage.completionTokens} | ${r.usage.reasoningTokens} | ${r.usage.costUsd} | ${m.unsupportedNumbers.length} | ${cov} | ${m.koreanRatio}`);
}

// ---- 읽기용 보고서
function report(paper, stage, statsMode, runs) {
  const lines = [];
  lines.push(`# 모델 비교: ${paper.title}`, '', `- 단계: ${stage}${statsMode ? ' (통계 분석 모드)' : ''}`, `- 실행: ${new Date().toISOString()}`, '');
  lines.push('## 한눈에 보기', '', '| 모델 | 결과 | 시도 | 시간 | 입력 토큰 | 출력 토큰 | 추론 토큰 | 실제 비용($) | 근거 없는 숫자 | 섹션 범위 | 한국어 비율 | "언급 없음" |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of runs) {
    if (!r.ok) { lines.push(`| ${r.label} | 실패: ${r.error} | | ${(r.ms / 1000).toFixed(1)}초 | | | | ${r.usage ? r.usage.costUsd : ''} | | | | |`); continue; }
    const m = r.metrics;
    lines.push(`| ${r.label} | 성공 | ${r.attempts} | ${(r.ms / 1000).toFixed(1)}초 | ${r.usage.promptTokens} | ${r.usage.completionTokens} | ${r.usage.reasoningTokens} | ${r.usage.costUsd} | ${m.unsupportedNumbers.length} | ${m.sectionCoverage ? `${m.sectionCoverage.covered}/${m.sectionCoverage.total}` : '-'} | ${m.koreanRatio} | ${m.noMentionCount} |`);
  }
  lines.push('', '> "근거 없는 숫자"는 결과의 수치가 입력 글에 없는 개수입니다. 0이 아니면 아래에서 그 수치를 확인하세요. 값이 크다고 반드시 잘못은 아니고(계산한 값, 단위 변환 등), 0이라고 내용이 모두 정확한 것도 아닙니다.', '');
  for (const r of runs.filter((x) => x.ok)) {
    const v = r.value;
    lines.push(`## ${r.label} (추론 강도: ${r.effort})`, '');
    if (r.metrics.unsupportedNumbers.length) lines.push(`- 입력에 없는 숫자: ${r.metrics.unsupportedNumbers.join(', ')}`);
    if (r.metrics.sectionCoverage && r.metrics.sectionCoverage.missing.length) lines.push(`- 섹션별 번역에 빠진 섹션: ${r.metrics.sectionCoverage.missing.join(' / ')}`);
    lines.push('', '### 3줄 요약');
    v.summary_3lines.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    if (v.abstract_translation) lines.push('', '### 초록 번역', '', v.abstract_translation);
    if (v.structured_summary) {
      const s = v.structured_summary;
      lines.push('', '### 구조화 요약', `- 연구 목적: ${s.purpose}`, `- 방법: ${s.method}`, `- 결과: ${s.results}`, `- 한계: ${s.limitations}`);
    }
    lines.push('', '### 용어');
    v.glossary.forEach((t) => lines.push(`- **${t.ko}** (${t.term}): ${t.explanation}`));
    if (v.section_translations) {
      lines.push('', '### 섹션별 번역');
      v.section_translations.forEach((s) => lines.push(`- **${s.title}**: ${s.ko}`));
    }
    if (v.app_ideas) {
      lines.push('', '### 앱 아이디어');
      v.app_ideas.forEach((a) => lines.push(`- **${a.name}** (${a.difficulty}${a.single_html_possible ? ', 단일 HTML 가능' : ''}): ${a.one_liner}`, `  - 근거: ${a.evidence}`, `  - 핵심 기능: ${a.core_features.join(' / ')}`, `  - 첫 프롬프트: ${a.first_prompt}`));
    }
    if (v.statistics_details) {
      const d = v.statistics_details;
      lines.push('', '### 통계 상세', `- 통계 논문: ${d.is_statistical}`);
      if (d.is_statistical) {
        lines.push(`- 모형: ${d.model}`, `- 가정: ${d.assumptions.join('; ') || '(없음)'}`, `- 추정 방법: ${d.estimation_method}`, `- 소프트웨어: ${d.software.join(', ') || '(없음)'}`, `- 표본·자료: ${d.sample}`, `- 적합도 지수: ${d.fit_indices.map((f) => `${f.name} ${f.value}`).join(', ') || '(없음)'}`, '', '```python', d.python_skeleton, '```');
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
