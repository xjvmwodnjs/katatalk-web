#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  defaultMigrationDirectory,
  loadMigrationManifest,
  repositoryRoot,
} from "./migrationRunner.mjs";
import { collectStagingCatalog } from "./stagingEvidenceCatalog.mjs";
import {
  buildStagingEvidenceArtifact,
  probeSupabaseRpcDenials,
  sha256,
  validateExpectedContract,
  validateMigrationHistory,
  validateSecurityCatalog,
  validateSupabaseTargetBinding,
} from "./stagingEvidenceCore.mjs";

const CONFIRMATION = "read-only-staging";

function safeFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveCommitSha() {
  const claimedCommit = (
    process.env.KATATALK_EVIDENCE_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    ""
  )
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(claimedCommit)) {
    throw safeFailure(
      "SOURCE_COMMIT_CLAIM_REQUIRED",
      "Set GITHUB_SHA or KATATALK_EVIDENCE_COMMIT_SHA to the checked-out commit."
    );
  }

  const gitCommand = process.env.GIT_BIN?.trim() || "git";
  const gitEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      [
        "COMSPEC",
        "GIT_CONFIG_NOSYSTEM",
        "HOME",
        "LANG",
        "LC_ALL",
        "PATH",
        "PATHEXT",
        "Path",
        "SystemRoot",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
      ].includes(name)
    )
  );
  const commonArguments = [
    "-c",
    `safe.directory=${repositoryRoot.replaceAll("\\", "/")}`,
  ];
  const head = spawnSync(
    gitCommand,
    [...commonArguments, "rev-parse", "HEAD"],
    {
      cwd: repositoryRoot,
      env: gitEnvironment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  );
  const actualCommit = (head.stdout || "").trim().toLowerCase();
  if (head.status !== 0 || !/^[0-9a-f]{40,64}$/.test(actualCommit)) {
    throw safeFailure(
      "SOURCE_COMMIT_UNAVAILABLE",
      "The staging collector requires an accessible Git checkout."
    );
  }
  if (actualCommit !== claimedCommit) {
    throw safeFailure(
      "SOURCE_COMMIT_MISMATCH",
      "The claimed source commit does not match Git HEAD."
    );
  }
  const status = spawnSync(
    gitCommand,
    [...commonArguments, "status", "--porcelain", "--untracked-files=no"],
    {
      cwd: repositoryRoot,
      env: gitEnvironment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  );
  if (status.status !== 0 || (status.stdout || "").trim()) {
    throw safeFailure(
      "SOURCE_TREE_DIRTY",
      "Tracked source changes are not allowed during staging evidence collection."
    );
  }
  return actualCommit;
}

function requirePreflight() {
  if (process.env.KATATALK_DB_EVIDENCE_CONFIRM !== CONFIRMATION) {
    throw safeFailure(
      "CONFIRMATION_REQUIRED",
      `Set KATATALK_DB_EVIDENCE_CONFIRM=${CONFIRMATION} only for the selected staging database.`
    );
  }
  if (process.env.POSTGRES_CONTAINER_ID?.trim()) {
    throw safeFailure(
      "CONTAINER_TARGET_FORBIDDEN",
      "The staging collector does not accept POSTGRES_CONTAINER_ID."
    );
  }
  const expectedContractPath =
    process.env.KATATALK_EXPECTED_DB_CONTRACT?.trim();
  if (!expectedContractPath) {
    throw safeFailure(
      "EXPECTED_CONTRACT_REQUIRED",
      "Set KATATALK_EXPECTED_DB_CONTRACT to the same-commit CI contract artifact."
    );
  }
  const expectedContractSha256 =
    process.env.KATATALK_EXPECTED_DB_CONTRACT_SHA256?.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedContractSha256 || "")) {
    throw safeFailure(
      "EXPECTED_CONTRACT_DIGEST_REQUIRED",
      "Set KATATALK_EXPECTED_DB_CONTRACT_SHA256 from the same workflow's expected-contract job."
    );
  }
  const expectedTargetSha256 =
    process.env.KATATALK_EXPECTED_TARGET_SHA256?.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedTargetSha256 || "")) {
    throw safeFailure(
      "EXPECTED_TARGET_REQUIRED",
      "Set KATATALK_EXPECTED_TARGET_SHA256 from the protected staging environment."
    );
  }
  return {
    expectedContractPath: resolve(expectedContractPath),
    expectedContractSha256,
    expectedTargetSha256,
  };
}

function applyReadOnlyConnectionDefaults() {
  const required =
    "-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000";
  process.env.PGOPTIONS = [process.env.PGOPTIONS?.trim(), required]
    .filter(Boolean)
    .join(" ");
  process.env.PGAPPNAME = "katatalk-read-only-staging-evidence";
  process.env.PGCONNECT_TIMEOUT = "10";
}

async function main() {
  const { expectedContractPath, expectedContractSha256, expectedTargetSha256 } =
    requirePreflight();
  const httpConfiguration = {
    baseUrl: process.env.STAGING_SUPABASE_URL,
    publishableKey: process.env.STAGING_SUPABASE_PUBLISHABLE_KEY,
    authenticatedJwt: process.env.STAGING_SUPABASE_AUTH_JWT,
  };
  delete process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.STAGING_SUPABASE_AUTH_JWT;

  const commitSha = resolveCommitSha();
  const manifest = loadMigrationManifest({
    directory: defaultMigrationDirectory,
  });

  let expectedContract;
  try {
    const expectedContractSource = readFileSync(expectedContractPath, "utf8");
    if (sha256(expectedContractSource) !== expectedContractSha256) {
      throw new Error("digest mismatch");
    }
    expectedContract = JSON.parse(expectedContractSource);
  } catch {
    throw safeFailure(
      "EXPECTED_CONTRACT_UNREADABLE",
      "The expected database contract artifact is missing or invalid JSON."
    );
  }
  const expectedValidation = validateExpectedContract(expectedContract, {
    commitSha,
    manifest,
  });
  if (expectedValidation.status !== "pass") {
    throw safeFailure(
      "EXPECTED_CONTRACT_REJECTED",
      `Expected contract rejected: ${expectedValidation.failureCodes.join(", ")}`
    );
  }

  const targetValidation = validateSupabaseTargetBinding({
    baseUrl: httpConfiguration.baseUrl,
    pgHost: process.env.PGHOST,
    pgUser: process.env.PGUSER,
    pgDatabase: process.env.PGDATABASE,
    pgSslMode: process.env.PGSSLMODE,
    pgHostAddr: process.env.PGHOSTADDR,
    pgService: process.env.PGSERVICE,
    pgServiceFile: process.env.PGSERVICEFILE,
    expectedTargetSha256,
  });
  if (targetValidation.status !== "pass") {
    throw safeFailure(
      "TARGET_BINDING_REJECTED",
      `Staging target binding rejected: ${targetValidation.failureCodes.join(", ")}`
    );
  }

  applyReadOnlyConnectionDefaults();
  let observation;
  try {
    observation = collectStagingCatalog();
  } catch {
    throw safeFailure(
      "DATABASE_COLLECTION_FAILED",
      "Read-only database evidence collection failed."
    );
  }
  const catalogValidation = validateSecurityCatalog(observation.catalog);
  const migrationValidation = validateMigrationHistory(
    observation.history,
    manifest,
    {
      historyPresent: catalogValidation.normalized.historyPresent === true,
      applicationObjectCount: observation.catalog.applicationObjectCount ?? 0,
    }
  );

  const httpEvidence = await probeSupabaseRpcDenials(httpConfiguration);
  const artifact = buildStagingEvidenceArtifact({
    commitSha,
    manifest,
    catalogValidation,
    migrationValidation,
    expectedCatalogSha256: expectedContract.database.securityCatalogSha256,
    expectedStructureSha256:
      expectedContract.database.applicationStructureSha256,
    expectedServerMajor: expectedContract.database.serverMajor,
    targetBinding: targetValidation.binding,
    httpEvidence,
  });
  const outputPath = resolve(
    process.env.KATATALK_STAGING_EVIDENCE_PATH ||
      resolve(
        repositoryRoot,
        ".tmp",
        `staging-database-evidence-${commitSha.slice(0, 12)}-${Date.now()}.json`
      )
  );
  if (existsSync(outputPath)) {
    throw safeFailure(
      "EVIDENCE_OUTPUT_EXISTS",
      "Refusing to overwrite an existing staging evidence artifact."
    );
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporaryPath, outputPath);

  if (artifact.result.status !== "pass") {
    throw safeFailure(
      "STAGING_EVIDENCE_FAILED",
      `Staging evidence failed: ${artifact.result.failureCodes.join(", ")}`
    );
  }
  console.log(`[staging-evidence] PASS (${artifact.evidenceSha256})`);
  console.log(`[staging-evidence] Artifact: ${outputPath}`);
}

try {
  await main();
} catch (error) {
  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "UNEXPECTED_FAILURE";
  const message =
    error instanceof Error && error.code
      ? error.message
      : "Staging evidence collection failed without exposing raw output.";
  console.error(`[staging-evidence] ${code}: ${message}`);
  process.exitCode = 1;
}
