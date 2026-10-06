// 검색용 중계 함수의 본체. Supabase나 Deno에 직접 의존하지 않고 필요한 것을 deps로 받는다.
import { BadRequest, buildUpstream } from './requests.ts';

export type AuthResult = { ok: true } | { ok: false; status: 401 | 403; code: 'unauthorized' | 'not_approved' };

export type Deps = {
  authorize: (authHeader: string | null) => Promise<AuthResult>;
  fetch: typeof fetch;
  allowedOrigins: string[];
  arxivGate: () => Promise<void>;
  log: (entry: Record<string, unknown>) => void;
  s2ApiKey?: string;
  timeoutMs?: number;
};

const MAX_REQUEST_BYTES = 100_000;
const MAX_RESPONSE_CHARS = 3_000_000;
const USER_AGENT = 'PaperNote/1.0 (personal research tool)';

function corsHeaders(origin: string | null, deps: Deps): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && deps.allowedOrigins.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '3600';
  }
  return h;
}

function errorResponse(status: number, code: string, message: string, cors: Record<string, string>, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: { code, message, ...extra } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
  });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const started = Date.now();
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin, deps);
  let op = 'unknown';
  const done = (res: Response) => {
    deps.log({ op, status: res.status, ms: Date.now() - started });
    return res;
  };

  // 허용되지 않은 출처의 브라우저 요청은 거절한다. (Origin이 없는 요청은 인증이 막는다.)
  if (origin && !deps.allowedOrigins.includes(origin)) {
    return done(errorResponse(403, 'origin_not_allowed', 'origin not allowed', {}));
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return done(errorResponse(405, 'method_not_allowed', 'POST only', cors));

  const auth = await deps.authorize(req.headers.get('authorization'));
  if (!auth.ok) return done(errorResponse(auth.status, auth.code, auth.code, cors));

  let payload: { op?: unknown; params?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_REQUEST_BYTES) throw new BadRequest('request too large');
    payload = JSON.parse(text);
    if (typeof payload !== 'object' || payload === null) throw new BadRequest('invalid body');
  } catch (e) {
    return done(errorResponse(400, 'bad_request', e instanceof BadRequest ? e.message : 'invalid JSON body', cors));
  }
  if (typeof payload.op === 'string') op = payload.op;

  let upstream;
  try {
    upstream = buildUpstream(payload.op, payload.params ?? {});
  } catch (e) {
    if (e instanceof BadRequest) return done(errorResponse(400, 'bad_request', e.message, cors));
    throw e;
  }

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json, application/atom+xml' };
  if (upstream.kind === 's2' && deps.s2ApiKey) headers['x-api-key'] = deps.s2ApiKey;
  if (upstream.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    if (upstream.kind === 'arxiv') await deps.arxivGate();
    const res = await deps.fetch(upstream.url, {
      method: upstream.method,
      headers,
      body: upstream.body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      return done(errorResponse(429, 'upstream_rate_limited', 'upstream rate limited', cors,
        Number.isFinite(retryAfter) && retryAfter > 0 ? { retry_after: retryAfter } : {}));
    }
    if (!res.ok) return done(errorResponse(502, 'upstream_error', 'upstream error', cors, { upstream_status: res.status }));

    const text = await res.text();
    if (text.length > MAX_RESPONSE_CHARS) return done(errorResponse(502, 'upstream_too_large', 'upstream response too large', cors));
    return done(new Response(text, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        ...cors,
      },
    }));
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return done(timedOut
      ? errorResponse(504, 'upstream_timeout', 'upstream timeout', cors)
      : errorResponse(502, 'upstream_error', 'upstream unreachable', cors));
  }
}
