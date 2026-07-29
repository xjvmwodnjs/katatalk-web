import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runSql } from "./postgres.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url))
);
export const defaultMigrationDirectory = resolve(
  repositoryRoot,
  "supabase",
  "migrations"
);

export function loadMigrationManifest({
  directory = defaultMigrationDirectory,
  through,
} = {}) {
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".sql"))
    .map(entry => {
      const match = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(entry.name);
      if (!match) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }
      const version = Number.parseInt(match[1], 10);
      const path = resolve(directory, entry.name);
      const source = readFileSync(path, "utf8");
      return {
        version,
        versionLabel: match[1],
        filename: entry.name,
        path,
        source,
        checksum: createHash("sha256").update(source, "utf8").digest("hex"),
      };
    })
    .sort((left, right) => left.version - right.version);

  if (entries.length === 0)
    throw new Error(`No migrations found in ${directory}`);

  entries.forEach((entry, index) => {
    const expected = index + 1;
    if (entry.version !== expected) {
      throw new Error(
        `Migration sequence must be contiguous from 001: expected ${String(expected).padStart(3, "0")}, found ${entry.versionLabel}`
      );
    }
  });

  const throughText = through == null ? null : String(through);
  if (throughText !== null && !/^\d{1,3}$/.test(throughText)) {
    throw new Error(`Invalid migration target: ${JSON.stringify(through)}`);
  }
  const target =
    throughText == null
      ? entries.at(-1).version
      : Number.parseInt(throughText, 10);
  if (
    !Number.isInteger(target) ||
    target < 1 ||
    target > entries.at(-1).version
  ) {
    throw new Error(`Invalid migration target: ${JSON.stringify(through)}`);
  }
  return entries.filter(entry => entry.version <= target);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildMigrationScript(manifest) {
  const target = manifest.at(-1).version;
  const sections = [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('katatalk:supabase-migrations', 0));",
    `DO $history_guard$
BEGIN
  IF pg_catalog.to_regclass('public.katatalk_schema_migrations') IS NULL
    AND (
      pg_catalog.to_regclass('public.profiles') IS NOT NULL
      OR pg_catalog.to_regclass('public.credit_logs') IS NOT NULL
      OR pg_catalog.to_regclass('public.analysis_jobs') IS NOT NULL
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'existing KataTalk schema has no trusted migration history; reviewed baseline required';
  END IF;
END;
$history_guard$;`,
    `CREATE TABLE IF NOT EXISTS public.katatalk_schema_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  filename text NOT NULL UNIQUE,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  applied_by text NOT NULL DEFAULT CURRENT_USER
);`,
    `DO $history_acl$
DECLARE
  v_grantee name;
BEGIN
  FOR v_grantee IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(a.grantee)
    FROM pg_catalog.pg_class AS c
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) AS a
    WHERE c.oid = 'public.katatalk_schema_migrations'::pg_catalog.regclass
      AND a.grantee <> 0
      AND a.grantee <> c.relowner
      AND a.grantee <> 'service_role'::pg_catalog.regrole
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON TABLE public.katatalk_schema_migrations FROM %I',
      v_grantee
    );
  END LOOP;
END;
$history_acl$;`,
    "ALTER TABLE public.katatalk_schema_migrations ENABLE ROW LEVEL SECURITY;",
    "REVOKE ALL ON TABLE public.katatalk_schema_migrations FROM PUBLIC, anon, authenticated, service_role;",
    "GRANT SELECT ON TABLE public.katatalk_schema_migrations TO service_role;",
    `DO $target_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.katatalk_schema_migrations WHERE version > ${target}
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'database is newer than requested migration target ${String(target).padStart(3, "0")}';
  END IF;
END;
$target_guard$;`,
  ];

  for (const migration of manifest) {
    const variable = `migration_${migration.versionLabel}_applied`;
    sections.push(
      `DO $guard_${migration.versionLabel}$
DECLARE
  v_filename text;
  v_checksum text;
BEGIN
  SELECT filename, checksum_sha256
  INTO v_filename, v_checksum
  FROM public.katatalk_schema_migrations
  WHERE version = ${migration.version};

  IF FOUND AND (
    v_filename IS DISTINCT FROM ${sqlLiteral(migration.filename)}
    OR v_checksum IS DISTINCT FROM ${sqlLiteral(migration.checksum)}
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'migration ${migration.versionLabel} filename or checksum mismatch';
  END IF;

  IF NOT FOUND AND EXISTS (
    SELECT 1 FROM public.katatalk_schema_migrations WHERE version > ${migration.version}
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'migration ${migration.versionLabel} is missing before a newer applied migration';
  END IF;
END;
$guard_${migration.versionLabel}$;`,
      `SELECT EXISTS (
  SELECT 1 FROM public.katatalk_schema_migrations WHERE version = ${migration.version}
) AS ${variable} \\gset`,
      `\\if :${variable}`,
      `\\echo 'verified ${migration.filename}'`,
      "\\else",
      `\\echo 'applying ${migration.filename}'`,
      migration.source.trimEnd(),
      `INSERT INTO public.katatalk_schema_migrations (version, filename, checksum_sha256)
VALUES (${migration.version}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(migration.checksum)});`,
      "\\endif"
    );
  }

  sections.push("COMMIT;", "");
  return sections.join("\n\n");
}

export function applyMigrations({
  database,
  through,
  directory = defaultMigrationDirectory,
} = {}) {
  const manifest = loadMigrationManifest({ directory, through });
  const script = buildMigrationScript(manifest);
  const result = runSql({
    database,
    sql: script,
    label: `Migrations through ${manifest.at(-1).versionLabel} on ${database || "PGDATABASE"}`,
    capture: true,
  });
  return { manifest, ...result };
}

export { repositoryRoot };
