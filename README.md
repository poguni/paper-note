# 페이퍼노트 (Paper Note)

영어 논문을 검색하고, 저장하고, AI로 분석·요약·번역하는 개인용 웹 앱입니다. 통계학과 교육학 논문을 읽는 데 맞춰 만들었습니다.

**배포 주소**: https://poguni.github.io/paper-note/ (가입 후 관리자가 승인해야 쓸 수 있습니다)

## 할 수 있는 것
- **검색**: arXiv와 Semantic Scholar를 한 번에 검색합니다. 기간, 최소 인용수 필터와 8가지 정렬, 자주 쓰는 검색 조건을 프리셋으로 저장하는 기능이 있습니다.
- **서재**: 마음에 드는 논문을 저장하고 메모를 남깁니다. 프리셋별, 분석 여부별로 걸러 볼 수 있습니다.
- **AI 분석**: 초록 단계(3줄 요약, 번역, 용어 사전)와 본문 단계(구조화 요약, 섹션별 번역, 통계 상세, 앱 아이디어)를 분석합니다. 본문 단계는 사용자가 PDF를 끌어다 놓아야 합니다. 통계 논문에는 Python 코드 뼈대(AI 생성 초안)도 만듭니다.
- **모델 선택과 비교**: Claude Sonnet 5.5(기본), Gemini 3.8 Flash, GPT-6 Luna 중에서 고르고, 같은 논문의 결과를 모델별로 나란히 비교합니다.
- **두 가지 화면 테마**: 학술용(남색, 3열)과 교육용(따뜻한 서재, 상단 단계 표시).

## 개인 정보와 약관
- **OpenRouter API 키는 서버에 저장하지 않습니다.** 키는 이 브라우저 탭에만 보관되고(탭을 닫으면 삭제), `openrouter.ai`로 가는 요청에만 쓰입니다. AI 호출은 브라우저에서 OpenRouter로 직접 갑니다.
- **PDF 원본과 추출한 본문은 저장하지 않습니다.** 사용자가 끌어다 놓은 PDF를 브라우저 안에서만 처리합니다. 저장되는 것은 논문 정보, 메모, AI 분석 결과입니다.
- arXiv는 3초에 한 번, 연결 하나로만 호출합니다. 브라우저는 검색 중계 함수(Supabase Edge Function)를 통해서만 arXiv와 Semantic Scholar에 접근합니다.
- 한 사용자의 데이터는 다른 사용자가 볼 수 없습니다(DB의 행 수준 보안, RLS).

## 개발

외부 패키지가 없어서 `npm install`이 필요 없습니다. Node.js 24 이상이면 됩니다.

```
npm test         # 자동 테스트 (비밀 값 검사, 약관 규칙, 접근성 토큰 포함)
npm run build    # src/ → dist/ (CSS와 JS를 index.html 하나에 합치고 public/, vendor/를 복사)
npm run serve    # dist/를 http://localhost:5173 으로 제공
```

| 폴더 | 내용 |
| --- | --- |
| `src/` | 앱 소스. `index.html`, `css/`, `js/` (전역 `PN` 이름공간, 빌드가 한 파일로 합침) |
| `public/` | 앱 아이콘과 스플래시 이미지 (빌드가 `dist/`로 복사) |
| `vendor/pdfjs/` | pdf.js 6.4.299 (Apache-2.0). 해시를 `tests/vendor.test.mjs`가 고정해 검사 |
| `supabase/` | DB 마이그레이션, 검색 중계 함수(`functions/pn-search-proxy`), RLS 시험 SQL |
| `tests/` | 자동 테스트와 시험용 고정 데이터. `tests/manual/`은 실제 서비스를 부르는 수동 점검 도구 |
| `docs/` | PRD, DESIGN, 구현 계획, 점검 기록 |
| `design/` | 테마 시안(HTML) |

## 직접 운영하려면 (Supabase와 배포)
1. Supabase 프로젝트를 만들고 `supabase/migrations/`의 SQL을 순서대로 적용합니다.
2. Authentication 설정에서 이메일 확인(Confirm email)을 끄고 최소 비밀번호 길이를 8자로 합니다.
3. `supabase/functions/pn-search-proxy`를 배포하고 환경 변수 `ALLOWED_ORIGINS`에 앱 주소(예: `https://poguni.github.io`, 경로 없이)를 넣습니다. 선택으로 `S2_API_KEY`(Semantic Scholar 키)를 넣을 수 있습니다.
4. `src/js/config.js`에 프로젝트 주소와 공개용(publishable) 키를 넣습니다. **`service_role`이나 secret 키는 절대 넣지 않습니다.** 자동 테스트가 이를 검사합니다.
5. 첫 가입자를 SQL로 관리자로 승인합니다(`pn_profiles`의 `status = 'approved'`, `is_admin = true`). 그 뒤 신청은 설정 화면의 "가입 승인"에서 처리합니다.
6. GitHub 저장소의 Settings → Pages → Source를 **GitHub Actions**로 바꾸고 `main`에 올리면, 테스트를 통과한 빌드가 자동으로 배포됩니다(`.github/workflows/pages.yml`).

## 문서
- [PRD](docs/%ED%8E%98%EC%9D%B4%ED%8D%BC%EB%85%B8%ED%8A%B8%28Paper%20Note%29%20PRD.md): 무엇을 왜 만드는지
- [DESIGN](docs/DESIGN.md): 디자인 토큰, 화면 배치, 컴포넌트
- [구현 계획](docs/Implementation_Plan.md): Phase별 작업과 완료 기록
- [Phase 5 점검 기록](docs/phase5-checks.md): 접근성, 보안, 약관, 성능 점검 결과

## 라이선스
이 저장소의 라이선스는 아직 정하지 않았습니다. `vendor/pdfjs/`의 pdf.js는 Apache-2.0입니다(`vendor/pdfjs/LICENSE`).
