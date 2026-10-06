// 허용 목록 방식 요청 검증. 임의의 주소나 파라미터는 받지 않고, 정해진 호출 3종만
// 정해진 주소(arXiv, Semantic Scholar)로 만들어 보낸다. Deno와 Node에서 모두 동작하는 순수 코드.

export type Upstream = {
  kind: 'arxiv' | 's2';
  method: 'GET' | 'POST';
  url: string;
  body?: string;
};

export class BadRequest extends Error {}

const ARXIV_URL = 'https://export.arxiv.org/api/query';
const S2_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const S2_BATCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/batch';

export const S2_FIELDS = [
  'paperId', 'title', 'authors', 'year', 'publicationDate', 'abstract', 'citationCount',
  'influentialCitationCount', 'externalIds', 'openAccessPdf', 'url', 'venue', 'publicationVenue',
  'journal', 'fieldsOfStudy', 'publicationTypes', 'referenceCount', 'isOpenAccess',
];
const S2_SEARCH_DEFAULT_FIELDS = 'title,authors,year,publicationDate,abstract,citationCount,externalIds,openAccessPdf,url,venue';
const S2_BATCH_DEFAULT_FIELDS = 'citationCount,externalIds';

const ARXIV_QUERY_RE = /^[A-Za-z0-9 _.:"()[\]*+-]{1,600}$/;
const S2_YEAR_RE = /^(\d{4}|\d{4}-\d{4}|\d{4}-|-\d{4})$/;
const S2_ID_RE = /^(ARXIV:(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Za-z]{2})?\/\d{7})(v\d+)?|DOI:10\.\S{1,150}|[0-9a-f]{40})$/i;

function obj(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BadRequest('params must be an object');
  return value as Record<string, unknown>;
}

function str(p: Record<string, unknown>, key: string, re: RegExp): string {
  const v = p[key];
  if (typeof v !== 'string' || !re.test(v)) throw new BadRequest(`invalid ${key}`);
  return v;
}

function int(p: Record<string, unknown>, key: string, min: number, max: number, fallback?: number): number {
  const v = p[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new BadRequest(`invalid ${key}`);
  return v;
}

function oneOf<T extends string>(p: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  const v = p[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new BadRequest(`invalid ${key}`);
  return v as T;
}

function s2Fields(p: Record<string, unknown>, fallback: string): string {
  const v = p.fields;
  if (v === undefined) return fallback;
  if (!Array.isArray(v) || v.length === 0 || v.length > S2_FIELDS.length) throw new BadRequest('invalid fields');
  for (const f of v) if (typeof f !== 'string' || !S2_FIELDS.includes(f)) throw new BadRequest('invalid fields');
  return v.join(',');
}

export function buildUpstream(op: unknown, params: unknown): Upstream {
  const p = obj(params);

  if (op === 'arxiv_search') {
    const query = new URLSearchParams({
      search_query: str(p, 'search_query', ARXIV_QUERY_RE),
      start: String(int(p, 'start', 0, 2000, 0)),
      max_results: String(int(p, 'max_results', 1, 100, 20)),
      sortBy: oneOf(p, 'sort_by', ['relevance', 'submittedDate', 'lastUpdatedDate'], 'relevance'),
      sortOrder: oneOf(p, 'sort_order', ['ascending', 'descending'], 'descending'),
    });
    return { kind: 'arxiv', method: 'GET', url: `${ARXIV_URL}?${query}` };
  }

  if (op === 's2_search') {
    const limit = int(p, 'limit', 1, 100, 20);
    const offset = int(p, 'offset', 0, 999, 0);
    if (offset + limit > 1000) throw new BadRequest('offset + limit must be 1000 or less');
    const query = new URLSearchParams({
      query: str(p, 'query', /^[^\u0000-\u001f]{1,300}$/),
      limit: String(limit),
      offset: String(offset),
      fields: s2Fields(p, S2_SEARCH_DEFAULT_FIELDS),
    });
    if (p.year !== undefined) query.set('year', str(p, 'year', S2_YEAR_RE));
    if (p.minCitationCount !== undefined) query.set('minCitationCount', String(int(p, 'minCitationCount', 0, 1_000_000)));
    return { kind: 's2', method: 'GET', url: `${S2_SEARCH_URL}?${query}` };
  }

  if (op === 's2_batch') {
    const ids = p.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500) throw new BadRequest('invalid ids');
    for (const id of ids) if (typeof id !== 'string' || !S2_ID_RE.test(id)) throw new BadRequest('invalid ids');
    const query = new URLSearchParams({ fields: s2Fields(p, S2_BATCH_DEFAULT_FIELDS) });
    return { kind: 's2', method: 'POST', url: `${S2_BATCH_URL}?${query}`, body: JSON.stringify({ ids }) };
  }

  throw new BadRequest('unknown op');
}
