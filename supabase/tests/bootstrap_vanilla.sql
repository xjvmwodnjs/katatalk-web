-- CI-only Supabase role emulation for a disposable vanilla PostgreSQL cluster.
-- Never run this bootstrap against a hosted or production database.
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ci_rogue_runtime') THEN
    CREATE ROLE ci_rogue_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END;
$bootstrap$;

ALTER ROLE anon NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE authenticated NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
ALTER ROLE ci_rogue_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
