-- Phase 5.2 보안 점검: public.rls_auto_enable()은 새 테이블에 RLS를 자동으로 켜 주는 이벤트 트리거(ensure_rls)용 함수다.
-- 이 함수가 /rest/v1/rpc/rls_auto_enable 로 anon, authenticated에게 노출되어 있어서(Supabase 보안 점검 경고 2건) 실행 권한을 회수한다.
-- 이벤트 트리거는 DDL을 실행하는 사용자의 EXECUTE 권한을 확인하지 않으므로, 권한을 회수해도 자동 RLS 기능은 그대로 동작한다.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
