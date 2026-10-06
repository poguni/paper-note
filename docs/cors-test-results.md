# CORS와 외부 API 검증 결과 (Phase 1-A)

시험일: 2026-10-05. 시험 방법은 두 가지입니다. ① `curl`로 `Origin` 헤더를 붙여 응답 헤더 확인 ② `http://localhost:5173`에서 서비스한 페이지에서 브라우저 `fetch` 실행(Playwright). 응답 헤더만 보고 판단하지 않고 브라우저 동작으로 재확인했습니다.

## 결과 요약

| # | 호출 | 헤더 확인 | 브라우저 fetch | 판정 |
| --- | --- | --- | --- | --- |
| 1.1 | arXiv 검색 (`export.arxiv.org/api/query`, GET) | 200이지만 `Access-Control-Allow-Origin` 없음 | `Failed to fetch` | **막힘 → 중계 필요** |
| 1.2 | Semantic Scholar 검색 (GET) | 3회 연속 **429** (키 없음), 429 응답에는 CORS 헤더 없음 | `Failed to fetch` (429 응답이라 판정 불가) | **미확정** (성공 응답의 CORS를 못 봄) |
| 1.3 | Semantic Scholar 일괄 조회 (`/paper/batch`, POST) | 사전 요청(OPTIONS)의 허용 메서드가 `GET,OPTIONS`뿐 (POST 없음) | `Failed to fetch` | **막힘 → 중계 필요** |
| 1.4 | OpenRouter (`/api/v1/chat/completions`, POST, `Authorization` 헤더) | `Access-Control-Allow-Origin: *`, POST와 Authorization 허용 | 가짜 키로 호출해 401 JSON 본문을 읽음 | **통과** (직접 호출 가능) |
| 1.5 | Supabase Auth (`/auth/v1/*`) | `Access-Control-Allow-Origin: *`, 필요한 헤더 허용 | 상태 확인 호출 200 | **통과** |

1.4는 CORS 통과만 확인했습니다. 모델별 JSON 출력과 추론 설정 파라미터는 OpenRouter 키가 있어야 해서 `tests/manual/openrouter-check.mjs`로 따로 확인합니다. (아래 "남은 확인")

## 의미와 영향

1. **arXiv는 브라우저에서 직접 호출할 수 없습니다.** 검색 기능의 한 축이므로 Edge Function 중계가 필요합니다. 계획서의 1.8은 "조건부"에서 "필요"로 바뀝니다.
2. **인용수 보강(일괄 조회)도 직접 호출할 수 없습니다.** 서버가 POST를 허용하지 않습니다. 대안은 논문마다 GET 한 번씩 부르는 방식인데, 호출 수가 논문 수만큼 늘어 한도에 걸리기 쉬워서 부적합합니다. 중계를 거치는 편이 맞습니다.
3. **Semantic Scholar는 키 없이 쓰기 어렵습니다.** 시험 중 모든 요청이 429였습니다. 한도는 무료 키를 신청하면 올라갑니다(신청 양식: `semanticscholar.org/product/api#api-key-form`). 키는 브라우저에 두지 않고 중계 함수의 비밀값(secret)으로 보관하는 방식을 제안합니다.
4. **OpenRouter와 Supabase는 중계 없이 브라우저에서 직접 호출합니다.** PRD의 "키는 `openrouter.ai`로 가는 요청에만 사용" 원칙이 그대로 지켜집니다.

## 제안: 검색용 중계 함수 1개

Supabase Edge Function 하나(예: `pn-search-proxy`)가 arXiv와 Semantic Scholar 호출을 모두 대신합니다.

- **허용 목록 방식**: 임의의 주소를 받지 않고 정해진 호출 종류(arXiv 검색, Semantic Scholar 검색, Semantic Scholar 일괄 조회)와 허용된 파라미터만 받아 정해진 주소로 보냅니다. 누구나 쓰는 열린 중계가 되지 않게 하기 위해서입니다.
- **로그인 필요**: 요청의 로그인 토큰을 검증하고, 승인된 계정(`status = approved`)만 사용할 수 있게 합니다.
- **Semantic Scholar 키**: 함수의 비밀값으로 보관하고 응답에는 절대 싣지 않습니다.
- **CORS**: 앱이 배포되는 주소와 `localhost`만 허용합니다.
- **OpenRouter 키는 이 함수를 거치지 않습니다.** 논문 텍스트와 키가 중계 서버에 닿지 않습니다.
- arXiv의 3초 간격 규칙은 앱의 대기열이 지키고, 함수는 호출 종류별 최소한의 제한만 둡니다.

단점: 함수 호출량이 Supabase 사용량에 잡히고, Semantic Scholar 키가 없으면 함수에서도 같은 429가 날 수 있습니다.

## 남은 확인

| 항목 | 방법 | 상태 |
| --- | --- | --- |
| OpenRouter 모델 3종의 JSON 출력과 추론 설정 | `OPENROUTER_API_KEY=... node tests/manual/openrouter-check.mjs` | 사용자 키 필요 |
| Semantic Scholar 성공 응답의 CORS, 일괄 조회 한도 | 키를 발급받은 뒤 중계 함수 또는 직접 호출로 확인 | 키 필요 |
| Supabase 로그인과 조회(1.5의 실제 로그인) | 마이그레이션 적용과 Auth 설정 뒤 확인 | Phase 1-B 이후 |

## 중계 함수 `pn-search-proxy` 구현 상태

코드: `supabase/functions/pn-search-proxy/` (`requests.ts` 요청 검증, `gate.ts` arXiv 3초 대기열, `handler.ts` 본체, `index.ts` Supabase 연결). 자동 테스트 25개 통과. **상태: 2026-10-05 `PaperNote` 프로젝트에 v1 배포 (`verify_jwt: true`).**

**배포 후 확인한 것** (로그인 없이 `curl`로, 허용 출처 `http://localhost:5173` 기준)

| 호출 | 결과 |
| --- | --- |
| 인증 헤더 없이 POST | 401 `unauthorized` (함수가 응답, CORS 헤더 포함) |
| 공개용 키를 Bearer로 POST | 401 `unauthorized` |
| 브라우저 사전 요청 OPTIONS (Authorization 없음) | 204, `Access-Control-Allow-Origin`과 허용 헤더 반환. **`verify_jwt: true`여도 사전 요청이 통과한다** |
| 허용되지 않은 출처의 OPTIONS | 403 `origin_not_allowed`, CORS 헤더 없음 |
| 배포된 파일 내용 | 로컬 코드와 동일 (정규식 포함) |

**호출 방식**: `POST /functions/v1/pn-search-proxy`, 헤더 `Authorization: Bearer <로그인 사용자 토큰>`, 본문 `{ "op": ..., "params": {...} }`.

| op | 보내는 곳 | 주요 파라미터 (모두 검증) | 응답 |
| --- | --- | --- | --- |
| `arxiv_search` | arXiv 검색 | `search_query`(허용 문자만, 600자 이하), `start`, `max_results`(1~100), `sort_by`, `sort_order` | arXiv XML 그대로 |
| `s2_search` | Semantic Scholar 검색 | `query`, `limit`(1~100), `offset`(offset+limit ≤ 1000), `year`, `minCitationCount`, `fields` | JSON 그대로 |
| `s2_batch` | Semantic Scholar 일괄 조회 | `ids`(1~500개, `ARXIV:`·`DOI:`·40자리 ID만), `fields` | JSON 그대로 |

**오류**: JSON `{ "error": { "code", "message" } }`. 400 `bad_request`, 401 `unauthorized`, 403 `not_approved` / `origin_not_allowed`, 405, 429 `upstream_rate_limited`(`retry_after` 포함), 502 `upstream_error`, 504 `upstream_timeout`.

**보안 설계**
- 임의의 주소를 받지 않고 위 3종만 정해진 주소로 보낸다. 검색어는 URL 인코딩해서 넣어 파라미터 끼워 넣기를 막는다.
- 사용자 토큰을 서버에서 검증하고, 그 토큰으로 `pn_profiles.status = 'approved'`를 확인한다. 공개용 키만으로는 통과할 수 없다.
- `service_role` 키를 쓰지 않는다. Semantic Scholar 키(`S2_API_KEY`)는 Semantic Scholar 요청에만 붙고 응답과 로그에 나오지 않는다.
- 로그에는 호출 종류, 상태, 소요 시간만 남기고 검색어는 남기지 않는다.
- 허용 출처(`ALLOWED_ORIGINS`) 밖의 브라우저 요청은 403이다. 기본값은 `http://localhost:5173`이므로 **배포 주소가 정해지면 값을 추가해야 한다.**

**배포 뒤 확인**: `PN_EMAIL=... PN_PASSWORD=... node tests/manual/relay-check.mjs` (인증 없음·공개 키만·허용되지 않은 출처·잘못된 요청·정상 호출 7가지를 확인한다).

**승인된 관리자 계정으로 `relay-check.mjs` 실행 (2026-10-05)**

| 확인 | 결과 |
| --- | --- |
| 관리자 계정 로그인 | 성공 (1.9, 1.14의 실제 로그인 확인) |
| 인증 헤더 없음 / 공개 키만 / 허용 외 출처 / 허용 외 op / 파라미터 끼워 넣기 | 401 / 401 / 403 / 400 / 400 |
| **arXiv 검색 (승인 계정 경로 전체)** | **200, XML 4,323 bytes.** 토큰 검증, 승인 상태 조회, 호출, Deno 연결부가 모두 동작 |
| Semantic Scholar 일괄 조회 · 검색 (`S2_API_KEY` 등록 직후 첫 실행) | 429 (원인은 확정하지 못함) |
| 같은 두 호출 (호출 사이 1.5초, 두 번째 실행) | **200.** 일괄 조회는 인용수 88,314(lme4 논문), 검색은 2건. 키가 함수에 반영되어 동작한다 |

**Semantic Scholar 429는 해결되었다.** 첫 실행에서 429였던 원인은 확정하지 못했다. 키 등록 직후의 반영 지연이거나 두 호출을 간격 없이 연달아 보낸 것(초당 1회 한도) 중 하나로 보이며, 그사이 시험 스크립트도 429를 "통과"가 아닌 경고(△)로 표시하고 호출 사이를 1.5초 띄우도록 고쳤다. 앞으로 키를 바꾸거나 새로 등록하면 같은 지연이 있을 수 있다는 점을 기억해 둔다.

**실제 Semantic Scholar 응답으로 파서 검증 (2026-10-05)**: `tests/fixtures/s2-live-search.json`, `s2-live-batch.json`에 실제 응답을 저장해 직접 쓴 예시(`s2-search-sample.json`)의 가정과 대조했다. 필드 구성, `null` 처리, 일괄 조회 응답이 요청 ID와 같은 순서로 오는 점이 모두 일치했다. 실제 데이터에서 새로 확인한 점: `venue`와 `openAccessPdf.url`이 빈 문자열(`""`)로 올 수 있고(파서가 "없음"으로 바꾼다), 같은 논문을 ARXIV ID와 DOI로 따로 물으면 두 번 돌려준다. 이 실제 응답은 `tests/search-s2-live.test.mjs`로 고정했다.

## OpenRouter 모델 3종 시험 (1.4, 2026-10-05)

`tests/manual/openrouter-check.mjs`로 같은 초록 요약(JSON 스키마 `strict`)을 모델 3개에 요청한 결과. 짧은 요청 1건 기준이라 실제 분석 비용은 더 크다.

| 모델 | JSON | 입력 / 출력 토큰 | 추론 토큰 | 비용 | 응답 시간 |
| --- | --- | --- | --- | --- | --- |
| anthropic/claude-sonnet-5.5 (`reasoning.effort: low`) | 통과 | 358 / 188 | 0 | $0.002596 | 4.8초 |
| google/gemini-3.8-flash (`reasoning.effort: low`) | 통과 | 167 / 80 | 0 | $0.00042525 | 2.6초 |
| openai/gpt-6-luna (`reasoning.effort: none`) | 통과 | 123 / 89 | 0 | $0.0000568 | 1.5초 |

- 세 모델 모두 `response_format: json_schema`(strict)와 `reasoning` 설정을 오류 없이 받아들였다.
- 추론 토큰이 세 모델 모두 0으로 보고되었다. 이 짧은 요청에서 `low`는 추론을 거의 쓰지 않았거나, 사용량에 따로 집계되지 않았을 수 있다. 긴 본문 분석에서 다시 확인한다.
- 입력 토큰은 같은 글인데도 모델마다 다르다(358 / 167 / 123). 토큰 수 추정은 모델별 보정이 필요하다.
