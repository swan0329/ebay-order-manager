-- Supabase Data API(PostgREST) 노출 차단
--
-- 이 앱은 Supabase를 순수 PostgreSQL로만 쓴다. Prisma가 데이터베이스에 직접
-- 연결하며 supabase-js·Supabase Auth·Storage·REST API를 전혀 사용하지 않는다.
-- 따라서 REST API 역할(anon, authenticated)은 어떤 테이블에도 접근할 필요가 없다.
--
-- 이 마이그레이션을 적용해도 앱 연결은 영향받지 않는다. 앱이 쓰는 역할은 이
-- 테이블들의 소유자이고, 소유자는 RLS를 우회한다(FORCE ROW LEVEL SECURITY를
-- 켜지 않았으므로). 적용 전 아래 "적용 전 확인"의 질의로 소유자를 확인한다.
--
-- 적용 전 확인 (Supabase SQL Editor에서 실행, 결과가 앱 연결 역할과 같아야 한다):
--   SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';

-- 1) public 스키마의 모든 테이블에 RLS를 켠다. 정책을 하나도 만들지 않으므로
--    anon·authenticated는 어떤 행도 읽거나 쓸 수 없다. 런타임 SQL로 만들어진
--    테이블(ai_image_jobs, image_work_assignments 등)도 함께 포함된다.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      target.schemaname,
      target.tablename
    );
  END LOOP;
END $$;

-- 2) RLS보다 앞단에서 막는다: REST API 역할의 권한 자체를 회수한다.
--    service_role은 Supabase 내부·대시보드가 쓰므로 건드리지 않는다.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', api_role);

      -- 앞으로 만들어질 테이블에도 같은 상태가 적용되게 한다. 이 프로젝트는
      -- 아직 일부 테이블을 첫 요청 때 런타임 SQL로 만들기 때문에 필요하다
      -- (docs/engineering-notes.md "요청 중 데이터 구조 생성").
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END $$;

-- 적용 후 확인 (rls_enabled가 모두 true, anon 권한이 0건이어야 한다):
--   SELECT relname, relrowsecurity AS rls_enabled
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY relname;
--
--   SELECT count(*) FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
