// 수동 확인용 (자동 테스트에 포함되지 않음). 우리 코드가 만드는 arXiv 검색식을 실제 arXiv에 보내 받아들여지는지 본다.
// 사용: node tests/manual/arxiv-query-check.mjs
// arXiv 이용 약관에 맞춰 요청 사이를 3초 이상 띄운다. 브라우저가 아니라 Node에서 직접 호출하므로 CORS와 무관하다.
import '../helpers/search-env.mjs';

const PN = globalThis.PN;
const now = new Date();
const cases = [
  ['검색어 하나', { terms: ['multilevel model'], categories: [], dateRange: 'all' }],
  ['검색어 둘(OR)', { terms: ['structural equation modeling', 'multilevel model'], categories: [], dateRange: 'all' }],
  ['분류 둘 + 5년', { terms: ['multilevel model'], categories: ['stat.ME', 'stat.AP'], dateRange: '5y' }],
  ['분류 와일드카드 q-bio.*', { terms: ['bioinformatics'], categories: ['q-bio.*'], dateRange: 'all' }],
  ['6개월', { terms: ['large language model'], categories: ['cs.AI', 'cs.LG', 'cs.SE'], dateRange: '6m' }],
];

let failed = 0;
for (const [name, opts] of cases) {
  const query = PN.arxiv.buildSearchQuery({ ...opts, now });
  const url = 'https://export.arxiv.org/api/query?' + new URLSearchParams({ search_query: query, start: '0', max_results: '2' });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'PaperNote-dev/1.0 (personal research tool; query check)' } });
    const { papers, total } = PN.arxiv.parseFeed(await res.text());
    const ok = res.ok && total > 0;
    if (!ok) failed += 1;
    console.log(`${ok ? '✔' : '✖'} ${name}: 총 ${total}건  ${papers.map((p) => `${p.arxivId} (${p.publishedDate}, ${p.categories[0]})`).join(' | ')}`);
    console.log(`   ${query}`);
  } catch (e) {
    failed += 1;
    console.log(`✖ ${name}: ${e.message}\n   ${query}`);
  }
  await new Promise((r) => setTimeout(r, 3500));
}
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
