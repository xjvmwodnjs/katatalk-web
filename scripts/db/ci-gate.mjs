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
import { collectStagingCatalog } from "./stagingEvidenceCatalog.mjs";
import {
  buildDatabaseFixtureEvidence,
  buildExpectedContract,
  validateMigrationHistory,
  validateSecurityCatalog,
} from "./stagingEvidenceCore.mjs";

const databases = {
  maintenance: "postgres",
  fresh: "katatalk_fresh",
  upgrade: "katatalk_upgrade",
  guard: "katatalk_migration_guard",
  structureGuard: "katatalk_structure_guard",
  historyGuard: "katatalk_history_guard",
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
  for (const denied of [
    {
      label: "idempotent enqueue v2 RPC",
      name: "enqueue_paid_analysis_job_v2",
      call: `SELECT public.enqueue_paid_analysis_job_v2(
        'untrusted-user', 'untrusted-job', 'untrusted-request-0001',
        pg_catalog.repeat('a', 64), 1, NULL, 'en', '(;GM[1])',
        pg_catalog.repeat('b', 64), 8, true, NULL, NULL
      );`,
    },
    {
      label: "atomic failure RPC",
      name: "fail_analysis_job_and_refund_with_lease",
      call: "SELECT public.fail_analysis_job_and_refund_with_lease('missing-job', 'untrusted-worker', 1, 'KATAGO_TIMEOUT', 'untrusted call');",
    },
    {
      label: "finalization reconciliation RPC",
      name: "reconcile_analysis_job_finalization",
      call: "SELECT public.reconcile_analysis_job_finalization('missing-job', false);",
    },
  ]) {
    runSqlExpectingFailure({
      database,
      label: `${role} ${denied.label} denial`,
      sql: `SET ROLE ${role};\n${denied.call}`,
      match: new RegExp(
        `42501:[^\\n]*permission denied for function ${denied.name}`,
        "i"
      ),
    });
  }
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

async function verifyIdempotentEnqueueConcurrency(database) {
  section("32-way paid submission idempotency race");
  runSql({
    database,
    label: "Seed idempotent enqueue race",
    sql: `INSERT INTO public.profiles (id, credits)
VALUES ('concurrent-idempotent-enqueue', 100);`,
  });

  const results = await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      runSqlAsync({
        database,
        label: `Idempotent enqueue contender ${index + 1}`,
        sql: `SELECT public.enqueue_paid_analysis_job_v2(
  'concurrent-idempotent-enqueue',
  'concurrent-idempotent-job-${String(index + 1).padStart(2, "0")}',
  'concurrent-idempotent-request-0001',
  pg_catalog.repeat('a', 64),
  2,
  'race.sgf',
  'ko',
  '(;GM[1]SZ[19];B[pd])',
  pg_catalog.repeat('b', 64),
  20,
  false,
  NULL,
  NULL
);`,
      })
    )
  );

  const state = runSql({
    database,
    label: "Assert idempotent enqueue race",
    tuplesOnly: true,
    sql: `SELECT p.credits::text
  || '|' || pg_catalog.count(DISTINCT j.id)::text
  || '|' || pg_catalog.count(DISTINCT l.id)::text
  || '|' || pg_catalog.min(j.id)
FROM public.profiles AS p
JOIN public.analysis_jobs AS j ON j.user_id = p.id
JOIN public.credit_logs AS l
  ON l.user_id = p.id AND l.type = 'usage' AND l.analysis_job_id = j.id
WHERE p.id = 'concurrent-idempotent-enqueue'
GROUP BY p.credits;`,
  }).stdout.trim();
  const [credits, jobs, usageLogs, committedJobId] = state.split("|");
  if (
    credits !== "98" ||
    jobs !== "1" ||
    usageLogs !== "1" ||
    !committedJobId
  ) {
    throw new Error(
      `Idempotent enqueue race violated ledger invariants: ${state}`
    );
  }
  if (
    results.some(
      result =>
        !result.stdout.includes('"ok": true') ||
        !result.stdout.includes(committedJobId)
    )
  ) {
    throw new Error(
      "An idempotent enqueue contender did not receive the committed job"
    );
  }
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

function sourceCommitSha() {
  const candidate = (
    process.env.GITHUB_SHA ||
    process.env.KATATALK_EVIDENCE_COMMIT_SHA ||
    ""
  )
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{40,64}$/.test(candidate) ? candidate : null;
}

function collectDatabaseFixture(
  database,
  manifest,
  { allowedFailureCodes = [] } = {}
) {
  section(`read-only security evidence on ${database}`);
  const observation = collectStagingCatalog({ database });
  const catalogValidation = validateSecurityCatalog(observation.catalog);
  const migrationValidation = validateMigrationHistory(
    observation.history,
    manifest,
    {
      historyPresent: catalogValidation.normalized.historyPresent === true,
      applicationObjectCount:
        catalogValidation.normalized.applicationObjectCount ?? 0,
    }
  );
  const failureCodes = [
    ...catalogValidation.failureCodes,
    ...migrationValidation.failureCodes,
  ];
  const unexpectedFailureCodes = [...new Set(failureCodes)].filter(
    code => !allowedFailureCodes.includes(code)
  );
  if (unexpectedFailureCodes.length > 0) {
    throw new Error(
      `Read-only security evidence failed: ${unexpectedFailureCodes.join(", ")}`
    );
  }
  return {
    catalogValidation,
    migrationValidation,
    artifact: buildDatabaseFixtureEvidence({
      commitSha: sourceCommitSha(),
      manifest,
      catalogValidation,
      migrationValidation,
    }),
  };
}

function verifyStructuralDriftGuard(database, manifest, expectedEvidence) {
  section("application structural drift guard");
  const before = collectDatabaseFixture(database, manifest);
  if (
    before.catalogValidation.canonicalSha256 !==
      expectedEvidence.catalogValidation.canonicalSha256 ||
    before.catalogValidation.structureSha256 !==
      expectedEvidence.catalogValidation.structureSha256
  ) {
    throw new Error(
      "Structural drift fixture did not start from the expected contract"
    );
  }

  runSql({
    database,
    label: "Inject table persistence drift",
    sql: `ALTER TABLE public.analysis_worker_instances SET UNLOGGED;`,
  });
  const persistenceDrift = collectDatabaseFixture(database, manifest);
  if (
    persistenceDrift.catalogValidation.canonicalSha256 !==
    before.catalogValidation.canonicalSha256
  ) {
    throw new Error(
      "Narrow security catalog unexpectedly detected persistence-only drift"
    );
  }
  if (
    persistenceDrift.catalogValidation.structureSha256 ===
    before.catalogValidation.structureSha256
  ) {
    throw new Error(
      "Application structure fingerprint accepted table persistence drift"
    );
  }
  runSql({
    database,
    label: "Restore table persistence",
    sql: `ALTER TABLE public.analysis_worker_instances SET LOGGED;`,
  });
  const restored = collectDatabaseFixture(database, manifest);
  if (
    restored.catalogValidation.canonicalSha256 !==
      before.catalogValidation.canonicalSha256 ||
    restored.catalogValidation.structureSha256 !==
      before.catalogValidation.structureSha256
  ) {
    throw new Error(
      "Structural drift fixture did not return to the expected contract"
    );
  }

  runSql({
    database,
    label: "Inject independent composite type drift",
    sql: `CREATE TYPE public.katatalk_unexpected_composite AS (
  value text
);`,
  });
  const compositeTypeDrift = collectDatabaseFixture(database, manifest, {
    allowedFailureCodes: ["UNEXPECTED_APPLICATION_OBJECT"],
  });
  if (
    compositeTypeDrift.catalogValidation.canonicalSha256 ===
    before.catalogValidation.canonicalSha256
  ) {
    throw new Error(
      "Security catalog fingerprint accepted composite-type-only drift"
    );
  }
  if (
    compositeTypeDrift.catalogValidation.structureSha256 ===
      before.catalogValidation.structureSha256 ||
    !compositeTypeDrift.catalogValidation.failureCodes.includes(
      "UNEXPECTED_APPLICATION_OBJECT"
    ) ||
    !compositeTypeDrift.catalogValidation.normalized.structure.unexpectedTypes.includes(
      "public.katatalk_unexpected_composite"
    )
  ) {
    throw new Error(
      "Application structure fingerprint accepted independent composite type drift"
    );
  }
  runSql({
    database,
    label: "Restore independent composite type drift",
    sql: `DROP TYPE public.katatalk_unexpected_composite;`,
  });
  const compositeTypeRestored = collectDatabaseFixture(database, manifest);
  if (
    compositeTypeRestored.catalogValidation.canonicalSha256 !==
      before.catalogValidation.canonicalSha256 ||
    compositeTypeRestored.catalogValidation.structureSha256 !==
      before.catalogValidation.structureSha256
  ) {
    throw new Error(
      "Composite type drift fixture did not return to the expected contract"
    );
  }

  runSql({
    database,
    label: "Inject SECURITY DEFINER function body drift",
    sql: `CREATE OR REPLACE FUNCTION public.ensure_profile_with_signup_bonus(
  p_user_id text,
  p_email text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function_body_drift$
BEGIN
  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$function_body_drift$;`,
  });

  const after = collectDatabaseFixture(database, manifest);
  if (
    after.catalogValidation.canonicalSha256 !==
    before.catalogValidation.canonicalSha256
  ) {
    throw new Error(
      "Narrow security catalog unexpectedly detected body-only drift"
    );
  }
  if (
    after.catalogValidation.structureSha256 ===
    before.catalogValidation.structureSha256
  ) {
    throw new Error(
      "Application structure fingerprint accepted SECURITY DEFINER body drift"
    );
  }
}

function verifyMissingHistoryGuard(database, manifest) {
  section("missing migration history guard");
  runSql({
    database,
    label: "Create untracked application schema",
    sql: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.preexisting_schema_marker (
  id text PRIMARY KEY
);`,
  });
  const observation = collectStagingCatalog({ database });
  const catalogValidation = validateSecurityCatalog(observation.catalog);
  const migrationValidation = validateMigrationHistory(
    observation.history,
    manifest,
    {
      historyPresent: catalogValidation.normalized.historyPresent === true,
      applicationObjectCount:
        catalogValidation.normalized.applicationObjectCount ?? 0,
    }
  );
  if (
    !migrationValidation.failureCodes.includes("BASELINE_REQUIRED") ||
    migrationValidation.failureCodes.includes("DATABASE_UNINITIALIZED")
  ) {
    throw new Error(
      "Existing schema without migration history did not fail as baseline-required"
    );
  }
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
    migrate(databases.structureGuard);

    verifyMigrationDriftGuard(databases.guard);
    verifyMissingHistoryGuard(databases.historyGuard, manifest);

    for (const database of [databases.fresh, databases.upgrade]) {
      runFile(database, "supabase/tests/security_contract.sql");
      verifyDeniedRpc(database, "anon");
      verifyDeniedRpc(database, "authenticated");
    }

    runFile(databases.fresh, "supabase/tests/fresh_atomic_failure_refund.sql");
    runFile(databases.fresh, "supabase/tests/fault_injection.sql");
    runFile(databases.fresh, "supabase/tests/quarantine_recovery.sql");
    runFile(databases.fresh, "supabase/tests/analysis_request_idempotency.sql");
    runFile(databases.upgrade, "supabase/tests/upgrade_assertions.sql");
    await verifyConcurrency(databases.fresh);
    await verifyIdempotentEnqueueConcurrency(databases.fresh);

    const freshEvidence = collectDatabaseFixture(databases.fresh, manifest);
    const upgradeEvidence = collectDatabaseFixture(databases.upgrade, manifest);
    if (
      freshEvidence.catalogValidation.canonicalSha256 !==
      upgradeEvidence.catalogValidation.canonicalSha256
    ) {
      throw new Error(
        "Fresh and 011-upgrade security catalog fingerprints differ"
      );
    }
    if (
      freshEvidence.catalogValidation.structureSha256 !==
      upgradeEvidence.catalogValidation.structureSha256
    ) {
      throw new Error(
        "Fresh and 011-upgrade application structure fingerprints differ"
      );
    }
    verifyStructuralDriftGuard(
      databases.structureGuard,
      manifest,
      freshEvidence
    );

    section("fresh/upgrade schema equivalence");
    const freshSchema = normalizeSchemaDump(
      dumpSchema(databases.fresh, {
        schema: "public",
        noAcl: true,
      })
    );
    const upgradeSchema = normalizeSchemaDump(
      dumpSchema(databases.upgrade, {
        schema: "public",
        noAcl: true,
      })
    );
    if (freshSchema !== upgradeSchema) {
      throw new Error("Fresh and 011-upgrade schema dumps differ");
    }

    const schemaChecksum = createHash("sha256")
      .update(freshSchema)
      .digest("hex");
    writeFileSync(
      resolve(artifactDirectory, "schema.sha256"),
      `${schemaChecksum}\n`
    );
    writeFileSync(
      resolve(artifactDirectory, "fresh-staging-db-evidence.json"),
      `${JSON.stringify(freshEvidence.artifact, null, 2)}\n`
    );
    writeFileSync(
      resolve(artifactDirectory, "upgrade-staging-db-evidence.json"),
      `${JSON.stringify(upgradeEvidence.artifact, null, 2)}\n`
    );
    writeFileSync(
      resolve(artifactDirectory, "rpc-security-snapshot.json"),
      `${JSON.stringify(freshEvidence.artifact.database.security, null, 2)}\n`
    );
    writeFileSync(
      resolve(artifactDirectory, "expected-staging-db-contract.json"),
      `${JSON.stringify(
        buildExpectedContract({
          commitSha: sourceCommitSha(),
          manifest,
          securityCatalogSha256:
            freshEvidence.catalogValidation.canonicalSha256,
          applicationStructureSha256:
            freshEvidence.catalogValidation.structureSha256,
          serverMajor:
            freshEvidence.catalogValidation.normalized.transaction.serverMajor,
        }),
        null,
        2
      )}\n`
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
    summary.securityCatalogSha256 =
      freshEvidence.catalogValidation.canonicalSha256;
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
