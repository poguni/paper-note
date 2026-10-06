// Supabase Edge Function: arXiv와 Semantic Scholar 검색 중계 (브라우저에서 직접 호출하면 CORS로 막힘)
//
// 환경 변수(Supabase 비밀값):
//   SUPABASE_URL, SUPABASE_ANON_KEY  플랫폼이 자동으로 넣어 준다. (service_role 키는 쓰지 않는다)
//   S2_API_KEY                       선택. Semantic Scholar 키. 응답에는 절대 싣지 않는다.
//   ALLOWED_ORIGINS                  선택. 쉼표로 구분한 허용 출처. 기본값은 로컬 개발 주소.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.ts';
import { createGate } from './gate.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const arxivGate = createGate(3000, () => Date.now(), (ms) => new Promise((resolve) => setTimeout(resolve, ms)));

// 로그인한 사용자이고 가입이 승인된 계정(pn_profiles.status = 'approved')만 통과시킨다.
// 사용자의 토큰으로 조회하므로 RLS가 그대로 적용되고, 공개용 키만으로는 통과할 수 없다.
async function authorize(authHeader: string | null) {
  const match = authHeader?.match(/^Bearer\s+(\S+)$/i);
  if (!authHeader || !match) return { ok: false as const, status: 401 as const, code: 'unauthorized' as const };

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) return { ok: false as const, status: 401 as const, code: 'unauthorized' as const };

  const profile = await client.from('pn_profiles').select('status').eq('id', data.user.id).maybeSingle();
  if (profile.error || profile.data?.status !== 'approved') {
    return { ok: false as const, status: 403 as const, code: 'not_approved' as const };
  }
  return { ok: true as const };
}

Deno.serve((req) =>
  handle(req, {
    authorize,
    fetch,
    allowedOrigins,
    arxivGate,
    s2ApiKey: Deno.env.get('S2_API_KEY') || undefined,
    // 요청 내용(검색어 등)은 기록하지 않는다. 호출 종류, 상태, 소요 시간만 남긴다.
    log: (entry) => console.log(JSON.stringify(entry)),
  })
);
