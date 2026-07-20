-- Harden every server-only SECURITY DEFINER RPC without rewriting an already
-- deployed migration. Apply after 012_atomic_failure_refund.sql.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;
REVOKE CREATE ON SCHEMA public FROM service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Remove direct CREATE grants left on public for any non-owner role. Runtime
-- roles must never be able to shadow objects used by privileged code.
DO $schema_acl$
DECLARE
  v_grantee name;
BEGIN
  FOR v_grantee IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(a.grantee)
    FROM pg_catalog.pg_namespace AS n
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
    ) AS a
    WHERE n.nspname = 'public'
      AND a.privilege_type = 'CREATE'
      AND a.grantee <> 0
      AND a.grantee <> n.nspowner
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE CREATE ON SCHEMA public FROM %I',
      v_grantee
    );
  END LOOP;
END;
$schema_acl$;

-- Normalize ownership to the application table owner, pin a trusted
-- search_path, and rebuild the runtime ACL for the complete RPC manifest.
DO $migration$
DECLARE
  v_application_owner name;
  v_signature text;
  v_grantee name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_application_owner
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = 'public.profiles'::pg_catalog.regclass;

  IF v_application_owner IS NULL THEN
    RAISE EXCEPTION 'could not resolve the application table owner';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.ensure_profile_with_signup_bonus(text, text, text)',
    'public.spend_credit_for_analysis(text, text, integer)',
    'public.refund_credit_for_analysis(text, text, integer)',
    'public.add_credits_from_stripe(text, integer, text, text, text)',
    'public.add_credits_from_payment(text, integer, text, text, text, text, text, text)',
    'public.claim_next_analysis_job(text, integer)',
    'public.report_analysis_worker(uuid, text, text, boolean)',
    'public.get_analysis_worker_health(text, integer)',
    'public.purge_expired_analysis_job_data(integer, boolean)',
    'public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamp with time zone)',
    'public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text)'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s OWNER TO %I',
      v_signature,
      v_application_owner
    );
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path = pg_catalog',
      v_signature
    );

    -- Remove grants to any role outside the owner/service boundary, including
    -- grants introduced manually after an older migration.
    FOR v_grantee IN
      SELECT pg_catalog.pg_get_userbyid(a.grantee)
      FROM pg_catalog.pg_proc AS p
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) AS a
      WHERE p.oid = v_signature::pg_catalog.regprocedure
        AND a.privilege_type = 'EXECUTE'
        AND a.grantee <> 0
        AND a.grantee <> p.proowner
        AND a.grantee <> 'service_role'::pg_catalog.regrole
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION %s FROM %I',
        v_signature,
        v_grantee
      );
    END LOOP;

    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_signature
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      v_signature
    );
  END LOOP;
END;
$migration$;

-- The HTTP API and Worker use the service role for these direct table paths.
-- Keep the grant list explicit so a vanilla PostgreSQL rehearsal matches the
-- hosted Supabase contract instead of relying on platform default privileges.
DO $table_acl$
DECLARE
  v_relation text;
  v_grantee name;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.profiles',
    'public.credit_logs',
    'public.analysis_jobs',
    'public.analysis_worker_instances',
    'public.analysis_job_finalization_failures',
    'public.katatalk_schema_migrations'
  ]
  LOOP
    -- The history table is runner-owned and may not exist when this migration
    -- is inspected by another Supabase migration tool.
    IF pg_catalog.to_regclass(v_relation) IS NULL THEN
      CONTINUE;
    END IF;

    FOR v_grantee IN
      SELECT DISTINCT pg_catalog.pg_get_userbyid(a.grantee)
      FROM pg_catalog.pg_class AS c
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) AS a
      WHERE c.oid = v_relation::pg_catalog.regclass
        AND a.grantee <> 0
        AND a.grantee <> c.relowner
        AND a.grantee <> 'service_role'::pg_catalog.regrole
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON TABLE %s FROM %I',
        v_relation,
        v_grantee
      );
    END LOOP;
  END LOOP;
END;
$table_acl$;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.credit_logs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.analysis_jobs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.analysis_worker_instances FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.analysis_job_finalization_failures FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.credit_logs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.analysis_jobs TO service_role;
GRANT SELECT ON TABLE public.analysis_worker_instances TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.analysis_job_finalization_failures TO service_role;

DO $history_table_acl$
BEGIN
  IF pg_catalog.to_regclass('public.katatalk_schema_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.katatalk_schema_migrations FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT ON TABLE public.katatalk_schema_migrations TO service_role;
    ALTER TABLE public.katatalk_schema_migrations ENABLE ROW LEVEL SECURITY;
  END IF;
END;
$history_table_acl$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_worker_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_job_finalization_failures ENABLE ROW LEVEL SECURITY;
