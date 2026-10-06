// 모델 비교(model-compare.mjs)에서 쓰는 "객관 지표" 계산. 품질을 대신 판단하지는 않고, 눈으로 보기 전에 걸러 볼 수 있는 신호만 만든다.
//   - 근거 없는 숫자: 결과에 나온 수치가 입력 글에 없으면 지어냈을 가능성이 있다
//   - 섹션 범위: 입력의 "## 제목" 섹션 중 섹션별 번역에 나온 비율
//   - 한국어 비율, "언급 없음" 개수

// 결과 값(JSON) 안의 모든 문자열을 모은다
export function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

// 글 속의 수치 목록. 한 자리 정수(순번, 개수 표현)는 신호가 약해서 뺀다: 소수점이 있거나 두 자리 이상인 수만 본다.
export function extractNumbers(text) {
  const found = String(text).match(/\d+(?:[.,]\d+)?/g) || [];
  return found.map((n) => n.replace(/,/g, '')).filter((n) => n.includes('.') || n.length >= 2);
}

// 입력에 없는 수치를 돌려준다 (중복 제거). 코드 뼈대(python_skeleton)와 식별용 문자열은 검사에서 뺀다.
export function unsupportedNumbers(value, sourceText) {
  const source = new Set(extractNumbers(sourceText.replace(/,/g, '')));
  const copy = JSON.parse(JSON.stringify(value));
  if (copy.statistics_details) delete copy.statistics_details.python_skeleton;
  const bad = new Set();
  for (const s of collectStrings(copy)) for (const n of extractNumbers(s)) if (!source.has(n)) bad.add(n);
  return [...bad];
}

// 입력 본문의 "## 제목" 줄들
export function sectionTitles(sourceText) {
  return [...String(sourceText).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

// 섹션별 번역이 입력 섹션을 얼마나 덮는지. 제목은 대소문자와 공백을 무시하고 비교한다.
export function sectionCoverage(sourceText, sectionTranslations) {
  const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
  const want = sectionTitles(sourceText);
  const got = new Set((sectionTranslations || []).map((s) => norm(s.title)));
  const covered = want.filter((t) => got.has(norm(t)));
  return { total: want.length, covered: covered.length, missing: want.filter((t) => !got.has(norm(t))) };
}

// 한글이 글자(한글+영문)에서 차지하는 비율. 설명과 번역이 한국어로 나왔는지 본다.
export function koreanRatio(strings) {
  let ko = 0;
  let letters = 0;
  for (const s of strings) {
    for (const ch of s) {
      if (/[가-힣]/.test(ch)) { ko++; letters++; }
      else if (/[A-Za-z]/.test(ch)) letters++;
    }
  }
  return letters ? ko / letters : 0;
}

export function countMatches(strings, re) {
  return strings.reduce((n, s) => n + (s.match(re) || []).length, 0);
}

// 모델 결과 하나의 지표 모음
export function measure(value, sourceText) {
  const strings = collectStrings(value);
  return {
    unsupportedNumbers: unsupportedNumbers(value, sourceText),
    sectionCoverage: value.section_translations ? sectionCoverage(sourceText, value.section_translations) : null,
    koreanRatio: Number(koreanRatio(strings).toFixed(3)),
    noMentionCount: countMatches(strings, /언급 없음/g),
    glossaryCount: value.glossary ? value.glossary.length : 0,
    appIdeaCount: value.app_ideas ? value.app_ideas.length : null,
    totalChars: strings.reduce((n, s) => n + s.length, 0)
  };
}
