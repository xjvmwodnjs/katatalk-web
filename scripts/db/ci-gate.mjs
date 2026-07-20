#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { applyMigrations, repositoryRoot } from "./migrationRunner.mjs";
import {
  dumpSchema,
  normalizeSchemaDump,
  requireSafeDatabaseName,
  runSql,
  runSqlAsync,
  runSqlExpectingFailure,
} from "./postgres.mjs";

const databases = {
  maintenance: "postgres",
  fresh: "katatalk_fresh",
  upgrade: "katatalk_upgrade",
  guard: "katatalk_migration_guard",
};

const artifactDirectory = resolve(
  process.env.DB_GATE_ARTIFACT_DIR ||
    resolve(repositoryRoot, ".tmp", "database-gate")
);
mkdirSync(artifactDirectory, { recursive: true });

function section(message) {
  console.log(`\n[database-gate] ${message}`);
}

function sqlFile(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function runFile(database, relativePath) {
  section(`${relativePath} on ${database}`);
  return runSql({
    database,
    sql: sqlFile(relativePath),
    label: `${relativePath} on ${database}`,
    capture: false,
  });
}

function recreateDatabase(database) {
  const name = requireSafeDatabaseName(database);
  runSql({
    database: databases.maintenance,
    sql: `SELECT pg_catalog.pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE datname = '${name}' AND pid <> pg_catalog.pg_backend_pid();`,
    label: `Terminate sessions for ${name}`,
  });
  runSql({
    database: databases.maintenance,
    sql: `DROP DATABASE IF EXISTS ${name};`,
    label: `Drop ${name}`,
  });
  runSql({
    database: databases.maintenance,
    sql: `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8';`,
    label: `Create ${name}`,
  });
}

function migrate(database, through) {
  const result = applyMigrations({ database, through });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.manifest;
}

function verifyDeniedRpc(database, role) {
  section(`${role} SQL execution denial`);
  runSqlExpectingFailure({
    database,
    label: `${role} atomic failure RPC denial`,
    sql: `SET ROLE ${role};
SELECT public.fail_analysis_job_and_refund_with_lease(
  'missing-job', 'untrusted-worker', 1, 'KATAGO_TIMEOUT', 'untrusted call'
);`,
    match:
      /42501:[^\n]*permission denied for function fail_analysis_job_and_refund_with_lease/i,
  });
}

async function waitForLockWait(database, queryMarker, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = runSql({
      database,
      label: `Observe lock wait for ${queryMarker}`,
      tuplesOnly: true,
      sql: `SELECT pg_catalog.count(*)
FROM pg_catalog.pg_stat_activity
WHERE pid <> pg_catalog.pg_backend_pid()
  AND state = 'active'
  AND query LIKE '%${queryMarker}%'
  AND wait_event_type = 'Lock';`,
    });
    if (Number.parseInt(result.stdout.trim(), 10) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(
    `Contender ${queryMarker} never reached a PostgreSQL lock wait`
  );
}

async function waitForAdvisoryLock(database, lockKey, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = runSql({
      database,
      label: `Observe holder advisory lock ${lockKey}`,
      tuplesOnly: true,
      sql: `SELECT pg_catalog.count(*)
FROM pg_catalog.pg_locks
WHERE locktype = 'advisory'
  AND granted
  AND classid = 0
  AND objid = ${lockKey};`,
    });
    if (Number.parseInt(result.stdout.trim(), 10) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Holder never published advisory lock ${lockKey}`);
}

async function runBlockedRace({
  database,
  holderSql,
  contenderSql,
  holderLockKey,
  contenderMarker,
  label,
}) {
  const holder = runSqlAsync({
    database,
    sql: holderSql,
    label: `${label} lock holder`,
  });

  await Promise.race([
    waitForAdvisoryLock(database, holderLockKey),
    holder.then(
      () => {
        throw new Error(
          `${label} lock holder exited before the barrier was observed`
        );
      },
      error => Promise.reject(error)
    ),
  ]);

  const contender = runSqlAsync({
    database,
    sql: contenderSql,
    label: `${label} contender`,
  });
  await waitForLockWait(database, contenderMarker);
  return Promise.all([holder, contender]);
}

async function verifyConcurrency(database) {
  runFile(database, "supabase/tests/concurrency_seed.sql");

  section("same-lease concurrent response-loss replay");
  const replayResults = await runBlockedRace({
    database,
    label: "Concurrent replay",
    holderLockKey: 91001,
    contenderMarker: "ci_replay_waiter",
    holderSql: `BEGIN;
SELECT public.fail_analysis_job_and_refund_with_lease(
  'concurrent-replay-job', 'worker-concurrent-replay', 1, 'KATAGO_TIMEOUT', 'concurrent replay'
);
SELECT pg_catalog.pg_advisory_xact_lock(91001);
SELECT pg_catalog.pg_sleep(3);
COMMIT;`,
    contenderSql: `BEGIN;
/* ci_replay_waiter */
SELECT public.fail_analysis_job_and_refund_with_lease(
  'concurrent-replay-job', 'worker-concurrent-replay', 1, 'KATAGO_TIMEOUT', 'concurrent replay'
);
COMMIT;`,
  });
  const replayOutput = replayResults.map(result => result.stdout).join("\n");
  if (
    !replayOutput.includes("FAILED_AND_REFUNDED") ||
    !replayOutput.includes("ALREADY_FAILED")
  ) {
    throw new Error(
      `Concurrent replay returned unexpected responses:\n${replayOutput.trim()}`
    );
  }

  section("completion-first terminal race");
  const completionFirst = await runBlockedRace({
    database,
    label: "Completion-first terminal race",
    holderLockKey: 91002,
    contenderMarker: "ci_completion_first_failure_waiter",
    holderSql: `BEGIN;
UPDATE public.analysis_jobs
SET
  status = 'completed',
  result = '{}'::jsonb,
  completed_at = pg_catalog.now(),
  locked_at = NULL,
  locked_by = NULL
WHERE id = 'concurrent-completion-wins-job'
  AND status = 'running'
  AND locked_by = 'worker-concurrent-completion'
  AND attempt_count = 1;
SELECT pg_catalog.pg_advisory_xact_lock(91002);
SELECT pg_catalog.pg_sleep(3);
COMMIT;`,
    contenderSql: `BEGIN;
/* ci_completion_first_failure_waiter */
SELECT public.fail_analysis_job_and_refund_with_lease(
  'concurrent-completion-wins-job', 'worker-concurrent-completion', 1, 'KATAGO_TIMEOUT', 'terminal race'
);
COMMIT;`,
  });
  if (!completionFirst[1].stdout.includes("ALREADY_COMPLETED")) {
    throw new Error(
      `Completion-first failure response was unexpected:\n${completionFirst[1].stdout}`
    );
  }

  section("failure-first terminal race");
  await runBlockedRace({
    database,
    label: "Failure-first terminal race",
    holderLockKey: 91003,
    contenderMarker: "ci_failure_first_completion_waiter",
    holderSql: `BEGIN;
SELECT public.fail_analysis_job_and_refund_with_lease(
  'concurrent-failure-wins-job', 'worker-concurrent-failure', 1, 'KATAGO_TIMEOUT', 'terminal race'
);
SELECT pg_catalog.pg_advisory_xact_lock(91003);
SELECT pg_catalog.pg_sleep(3);
COMMIT;`,
    contenderSql: `BEGIN;
/* ci_failure_first_completion_waiter */
UPDATE public.analysis_jobs
SET
  status = 'completed',
  result = '{}'::jsonb,
  completed_at = pg_catalog.now(),
  locked_at = NULL,
  locked_by = NULL
WHERE id = 'concurrent-failure-wins-job'
  AND status = 'running'
  AND locked_by = 'worker-concurrent-failure'
  AND attempt_count = 1;
COMMIT;`,
  });

  runFile(database, "supabase/tests/concurrency_assertions.sql");
}

function verifyMigrationDriftGuard(database) {
  section("migration checksum drift guard");
  migrate(database, 1);
  runSql({
    database,
    sql: `UPDATE public.katatalk_schema_migrations
SET checksum_sha256 = pg_catalog.repeat('0', 64)
WHERE version = 1;`,
    label: "Inject migration checksum drift",
  });

  try {
    migrate(database, 1);
  } catch (error) {
    if (!/migration 001 filename or checksum mismatch/i.test(error.message)) {
      throw new Error("Migration drift guard failed for an unexpected reason", {
        cause: error,
      });
    }
    return;
  }
  throw new Error("Migration checksum drift was accepted");
}

function securitySnapshot(database) {
  const sql = `SELECT pg_catalog.jsonb_pretty(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'signature', p.oid::pg_catalog.regprocedure::text,
      'owner', pg_catalog.pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'config', p.proconfig,
      'acl', p.proacl
    )
    ORDER BY p.oid::pg_catalog.regprocedure::text
  )
)
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef;`;
  return runSql({
    database,
    sql,
    label: "Security catalog snapshot",
    tuplesOnly: true,
  }).stdout.trim();
}

async function main() {
  const summary = { status: "running", startedAt: new Date().toISOString() };
  try {
    if (!process.env.POSTGRES_CONTAINER_ID?.trim()) {
      throw new Error(
        "Database gate requires an explicitly selected disposable POSTGRES_CONTAINER_ID"
      );
    }
    if (process.env.KATATALK_DB_GATE_CONFIRM !== "ephemeral-postgres") {
      throw new Error(
        "Set KATATALK_DB_GATE_CONFIRM=ephemeral-postgres only for a disposable PostgreSQL container"
      );
    }

    section("bootstrap vanilla PostgreSQL roles");
    runSql({
      database: databases.maintenance,
      sql: sqlFile("supabase/tests/bootstrap_vanilla.sql"),
      label: "Bootstrap Supabase-compatible roles",
      capture: false,
    });

    Object.values(databases)
      .filter(database => database !== databases.maintenance)
      .forEach(recreateDatabase);

    section("fresh 001 -> latest migration path");
    const manifest = migrate(databases.fresh);

    section("upgrade 011 -> latest migration path");
    migrate(databases.upgrade, 11);
    runFile(databases.upgrade, "supabase/tests/upgrade_011_seed.sql");
    migrate(databases.upgrade);

    verifyMigrationDriftGuard(databases.guard);

    for (const database of [databases.fresh, databases.upgrade]) {
      runFile(database, "supabase/tests/security_contract.sql");
      verifyDeniedRpc(database, "anon");
      verifyDeniedRpc(database, "authenticated");
    }

    runFile(databases.fresh, "supabase/tests/fresh_atomic_failure_refund.sql");
    runFile(databases.fresh, "supabase/tests/fault_injection.sql");
    runFile(databases.fresh, "supabase/tests/quarantine_recovery.sql");
    runFile(databases.upgrade, "supabase/tests/upgrade_assertions.sql");
    await verifyConcurrency(databases.fresh);

    section("fresh/upgrade schema and ACL equivalence");
    const freshSchema = normalizeSchemaDump(dumpSchema(databases.fresh));
    const upgradeSchema = normalizeSchemaDump(dumpSchema(databases.upgrade));
    writeFileSync(
      resolve(artifactDirectory, "fresh-schema.sql"),
      `${freshSchema}\n`
    );
    writeFileSync(
      resolve(artifactDirectory, "upgrade-schema.sql"),
      `${upgradeSchema}\n`
    );
    if (freshSchema !== upgradeSchema) {
      throw new Error("Fresh and 011-upgrade schema/ACL dumps differ");
    }

    const schemaChecksum = createHash("sha256")
      .update(freshSchema)
      .digest("hex");
    writeFileSync(
      resolve(artifactDirectory, "schema.sha256"),
      `${schemaChecksum}\n`
    );
    writeFileSync(
      resolve(artifactDirectory, "rpc-security-snapshot.json"),
      `${securitySnapshot(databases.fresh)}\n`
    );
    writeFileSync(
      resolve(artifactDirectory, "migration-manifest.json"),
      `${JSON.stringify(
        manifest.map(entry => ({
          version: entry.versionLabel,
          filename: entry.filename,
          checksumSha256: entry.checksum,
        })),
        null,
        2
      )}\n`
    );

    summary.status = "passed";
    summary.completedAt = new Date().toISOString();
    summary.migrations = manifest.length;
    summary.schemaChecksumSha256 = schemaChecksum;
    writeFileSync(
      resolve(artifactDirectory, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`
    );
    section(
      `PASS (${manifest.length} migrations, schema ${schemaChecksum.slice(0, 12)}...)`
    );
  } catch (error) {
    summary.status = "failed";
    summary.completedAt = new Date().toISOString();
    summary.error = error instanceof Error ? error.message : String(error);
    writeFileSync(
      resolve(artifactDirectory, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`
    );
    throw error;
  }
}

await main();
