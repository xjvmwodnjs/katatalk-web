BEGIN;

CREATE FUNCTION public.__ci_assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $assertion$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CI assertion failed: %', p_message;
  END IF;
END;
$assertion$;

DO $security_contract$
DECLARE
  v_function_oid oid;
  v_signature text;
  v_owner oid;
  v_unexpected text;
  v_service_role oid := 'service_role'::pg_catalog.regrole;
BEGIN
  SELECT c.relowner
  INTO v_owner
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = 'public.profiles'::pg_catalog.regclass;

  FOR v_signature IN
    SELECT signature
    FROM (
      VALUES
        ('public.ensure_profile_with_signup_bonus(text, text, text)'),
        ('public.spend_credit_for_analysis(text, text, integer)'),
        ('public.refund_credit_for_analysis(text, text, integer)'),
        ('public.add_credits_from_stripe(text, integer, text, text, text)'),
        ('public.add_credits_from_payment(text, integer, text, text, text, text, text, text)'),
        ('public.claim_next_analysis_job(text, integer)'),
        ('public.report_analysis_worker(uuid, text, text, boolean)'),
        ('public.get_analysis_worker_health(text, integer)'),
        ('public.purge_expired_analysis_job_data(integer, boolean)'),
        ('public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamp with time zone)'),
        ('public.enqueue_paid_analysis_job_v2(text, text, text, text, integer, text, text, text, text, integer, boolean, text, timestamp with time zone)'),
        ('public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text)'),
        ('public.reconcile_analysis_job_finalization(text, boolean)')
    ) AS expected(signature)
  LOOP
    v_function_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION 'missing expected RPC: %', v_signature;
    END IF;

    PERFORM public.__ci_assert_true(p.prosecdef, v_signature || ' must be SECURITY DEFINER')
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_function_oid;

    PERFORM public.__ci_assert_true(
      p.proowner = v_owner,
      v_signature || ' owner must match the application table owner'
    )
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_function_oid;

    PERFORM public.__ci_assert_true(
      p.proconfig = ARRAY['search_path=pg_catalog']::text[],
      v_signature || ' must have only search_path=pg_catalog in proconfig'
    )
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_function_oid;

    PERFORM public.__ci_assert_true(
      NOT pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE'),
      'anon can execute ' || v_signature
    );
    PERFORM public.__ci_assert_true(
      NOT pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE'),
      'authenticated can execute ' || v_signature
    );
    PERFORM public.__ci_assert_true(
      pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE'),
      'service_role cannot execute ' || v_signature
    );

    PERFORM public.__ci_assert_true(
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) AS a
        WHERE p.oid = v_function_oid
          AND a.privilege_type = 'EXECUTE'
          AND a.grantee NOT IN (p.proowner, v_service_role)
      ),
      v_signature || ' has an unexpected EXECUTE grantee'
    );
  END LOOP;

  SELECT pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', ' ORDER BY p.oid::pg_catalog.regprocedure::text)
  INTO v_unexpected
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.oid <> ALL (
      ARRAY[
        'public.ensure_profile_with_signup_bonus(text, text, text)'::pg_catalog.regprocedure,
        'public.spend_credit_for_analysis(text, text, integer)'::pg_catalog.regprocedure,
        'public.refund_credit_for_analysis(text, text, integer)'::pg_catalog.regprocedure,
        'public.add_credits_from_stripe(text, integer, text, text, text)'::pg_catalog.regprocedure,
        'public.add_credits_from_payment(text, integer, text, text, text, text, text, text)'::pg_catalog.regprocedure,
        'public.claim_next_analysis_job(text, integer)'::pg_catalog.regprocedure,
        'public.report_analysis_worker(uuid, text, text, boolean)'::pg_catalog.regprocedure,
        'public.get_analysis_worker_health(text, integer)'::pg_catalog.regprocedure,
        'public.purge_expired_analysis_job_data(integer, boolean)'::pg_catalog.regprocedure,
        'public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamp with time zone)'::pg_catalog.regprocedure,
        'public.enqueue_paid_analysis_job_v2(text, text, text, text, integer, text, text, text, text, integer, boolean, text, timestamp with time zone)'::pg_catalog.regprocedure,
        'public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text)'::pg_catalog.regprocedure,
        'public.reconcile_analysis_job_finalization(text, boolean)'::pg_catalog.regprocedure
      ]::oid[]
    );
  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected public SECURITY DEFINER function(s): %', v_unexpected;
  END IF;
END;
$security_contract$;

SELECT public.__ci_assert_true(
  pg_catalog.to_regprocedure('public.claim_next_analysis_job()') IS NULL,
  'obsolete zero-argument claim RPC still exists'
);

SELECT public.__ci_assert_true(
  NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
    AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
    AND NOT pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE'),
  'a runtime role can CREATE in public schema'
);

SELECT public.__ci_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS n
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
    ) AS a
    WHERE n.nspname = 'public'
      AND a.privilege_type = 'CREATE'
      AND a.grantee <> n.nspowner
  ),
  'a non-owner role has a direct CREATE grant in public schema'
);

DO $table_contract$
DECLARE
  v_relation text;
  v_allowed text[];
  v_privilege text;
  v_relation_oid oid;
  v_owner oid;
  v_service_role oid := 'service_role'::pg_catalog.regrole;
BEGIN
  FOR v_relation, v_allowed IN
    SELECT relation_name, allowed_privileges
    FROM (
      VALUES
        ('public.profiles', ARRAY['SELECT']::text[]),
        ('public.credit_logs', ARRAY['SELECT']::text[]),
        ('public.analysis_jobs', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('public.analysis_worker_instances', ARRAY['SELECT']::text[]),
        ('public.analysis_job_finalization_failures', ARRAY['SELECT']::text[]),
        ('public.katatalk_schema_migrations', ARRAY['SELECT']::text[])
    ) AS expected(relation_name, allowed_privileges)
  LOOP
    v_relation_oid := v_relation::pg_catalog.regclass;
    SELECT relowner INTO v_owner FROM pg_catalog.pg_class WHERE oid = v_relation_oid;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS c
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) AS a
      WHERE c.oid = v_relation_oid
        AND (
          a.grantee NOT IN (v_owner, v_service_role)
          OR (a.grantee = v_service_role AND a.privilege_type <> ALL (v_allowed))
        )
    ) THEN
      RAISE EXCEPTION 'unexpected table ACL on %', v_relation;
    END IF;

    FOREACH v_privilege IN ARRAY v_allowed
    LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', v_relation_oid, v_privilege) THEN
        RAISE EXCEPTION 'service_role lacks % on %', v_privilege, v_relation;
      END IF;
    END LOOP;

    IF pg_catalog.has_table_privilege(
      'anon',
      v_relation_oid,
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    ) OR pg_catalog.has_table_privilege(
      'authenticated',
      v_relation_oid,
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    ) THEN
      RAISE EXCEPTION 'client role has table privilege on %', v_relation;
    END IF;
  END LOOP;
END;
$table_contract$;

SELECT public.__ci_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'profiles',
        'credit_logs',
        'analysis_jobs',
        'analysis_worker_instances',
        'analysis_job_finalization_failures',
        'katatalk_schema_migrations'
      )
      AND NOT c.relrowsecurity
  ),
  'an application or migration-history table is missing RLS'
);

-- Exercise every hardened body under its intended runtime role. The enclosing
-- transaction is rolled back so these probes never become fixture data.
SET LOCAL ROLE service_role;
SELECT public.ensure_profile_with_signup_bonus('__security_probe__', NULL, NULL);
SELECT public.add_credits_from_stripe(
  '__security_probe__', 1, '__security_stripe_event__', NULL, 'security probe'
);
SELECT public.add_credits_from_payment(
  '__security_probe__',
  1,
  '__security_payment_key__',
  'ci',
  '__security_payment_event__',
  '__security_order__',
  '__security_checkout__',
  'security probe'
);
SELECT public.spend_credit_for_analysis('__security_probe__', '__security_legacy_spend__', 1);
SELECT public.refund_credit_for_analysis('__security_probe__', '__security_legacy_spend__', 1);
SELECT public.enqueue_paid_analysis_job(
  '__security_probe__',
  '__security_job__',
  1,
  'security.sgf',
  'en',
  '(;GM[1])',
  '__security_hash__',
  8,
  true,
  NULL
);
SELECT public.enqueue_paid_analysis_job_v2(
  '__security_probe__',
  '__security_job_v2__',
  'security-request-v2-0001',
  pg_catalog.repeat('a', 64),
  1,
  'security-v2.sgf',
  'en',
  '(;GM[1])',
  pg_catalog.repeat('b', 64),
  8,
  true,
  NULL,
  NULL
);
SELECT public.claim_next_analysis_job('__security_probe_worker__', 900);
SELECT public.fail_analysis_job_and_refund_with_lease(
  '__security_job__',
  '__security_probe_worker__',
  1,
  'KATAGO_TIMEOUT',
  'private security probe detail'
);
SELECT public.reconcile_analysis_job_finalization('__security_missing_job__', false);
SELECT public.report_analysis_worker(
  '00000000-0000-0000-0000-000000000013'::uuid,
  '__security_probe__',
  'mock',
  false
);
SELECT * FROM public.get_analysis_worker_health('mock', 60);
SELECT * FROM public.purge_expired_analysis_job_data(1, true);
RESET ROLE;

ROLLBACK;
