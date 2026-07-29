import { createHash } from "node:crypto";

import {
  ALL_TABLE_PRIVILEGES,
  EXPECTED_CONTRACT_SCHEMA_VERSION,
  EXPECTED_PUBLIC_FUNCTION_SIGNATURES,
  EXPECTED_RUNTIME_ROLES,
  EXPECTED_SECURITY_DEFINER_FUNCTIONS,
  EXPECTED_SENSITIVE_TABLES,
  SECURITY_CATALOG_CONTRACT,
  STAGING_EVIDENCE_SCHEMA_VERSION,
} from "./stagingSecurityManifest.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_HTTP_BODY_BYTES = 64 * 1024;
const HTTP_TIMEOUT_MS = 10_000;

function compareText(left, right) {
  return Buffer.compare(
    Buffer.from(String(left), "utf8"),
    Buffer.from(String(right), "utf8")
  );
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function sortedAcl(acl) {
  if (!Array.isArray(acl)) return [];
  return [...acl]
    .map(entry => ({
      grantee: entry?.grantee ?? null,
      grantor: entry?.grantor ?? null,
      privilege: entry?.privilege ?? null,
      grantable: entry?.grantable ?? null,
    }))
    .sort((left, right) =>
      compareText(
        [left.grantee, left.privilege, left.grantable, left.grantor].join(
          "\u0000"
        ),
        [right.grantee, right.privilege, right.grantable, right.grantor].join(
          "\u0000"
        )
      )
    );
}

function sortedStructureEntries(entries, fields, sortFields) {
  const sortValue = value =>
    typeof value === "number"
      ? String(value).padStart(12, "0")
      : String(value ?? "");
  return [...(Array.isArray(entries) ? entries : [])]
    .map(entry =>
      Object.fromEntries(fields.map(field => [field, entry?.[field] ?? null]))
    )
    .sort((left, right) =>
      compareText(
        sortFields.map(field => sortValue(left[field])).join("\u0000"),
        sortFields.map(field => sortValue(right[field])).join("\u0000")
      )
    );
}

function normalizeStructure(structure) {
  return {
    functions: sortedStructureEntries(
      structure?.functions,
      ["signature", "exists", "definitionSha256"],
      ["signature"]
    ),
    relations: sortedStructureEntries(
      structure?.relations,
      [
        "qualifiedName",
        "exists",
        "kind",
        "persistence",
        "replicaIdentity",
        "accessMethod",
        "tablespace",
        "optionsSha256",
        "partitionBoundSha256",
      ],
      ["qualifiedName"]
    ),
    columns: sortedStructureEntries(
      structure?.columns,
      [
        "qualifiedName",
        "order",
        "name",
        "dataType",
        "notNull",
        "identityKind",
        "generatedKind",
        "collation",
        "defaultSha256",
      ],
      ["qualifiedName", "order", "name"]
    ),
    constraints: sortedStructureEntries(
      structure?.constraints,
      [
        "qualifiedName",
        "name",
        "type",
        "deferrable",
        "initiallyDeferred",
        "validated",
        "definitionSha256",
      ],
      ["qualifiedName", "name"]
    ),
    indexes: sortedStructureEntries(
      structure?.indexes,
      [
        "qualifiedName",
        "name",
        "unique",
        "primary",
        "valid",
        "ready",
        "accessMethod",
        "definitionSha256",
      ],
      ["qualifiedName", "name"]
    ),
    policies: sortedStructureEntries(
      structure?.policies,
      [
        "qualifiedName",
        "name",
        "permissive",
        "command",
        "rolesSha256",
        "usingSha256",
        "checkSha256",
      ],
      ["qualifiedName", "name"]
    ),
    triggers: sortedStructureEntries(
      structure?.triggers,
      ["qualifiedName", "name", "enabled", "definitionSha256"],
      ["qualifiedName", "name"]
    ),
    unexpectedFunctions: [
      ...(Array.isArray(structure?.unexpectedFunctions)
        ? structure.unexpectedFunctions
        : []),
    ].sort(compareText),
    unexpectedTypes: [
      ...(Array.isArray(structure?.unexpectedTypes)
        ? structure.unexpectedTypes
        : []),
    ].sort(compareText),
    unexpectedRelations: [
      ...(Array.isArray(structure?.unexpectedRelations)
        ? structure.unexpectedRelations
        : []),
    ].sort(compareText),
  };
}

export function normalizeSecurityCatalog(catalog) {
  return {
    formatVersion: catalog?.formatVersion ?? null,
    transaction: {
      readOnly: catalog?.transaction?.readOnly ?? null,
      isolation: catalog?.transaction?.isolation ?? null,
      serverMajor: catalog?.transaction?.serverMajor ?? null,
      timeoutsApplied: catalog?.transaction?.timeoutsApplied ?? null,
      deparserSettingsApplied:
        catalog?.transaction?.deparserSettingsApplied ?? null,
    },
    applicationObjectCount: catalog?.applicationObjectCount ?? null,
    historyPresent: catalog?.historyPresent ?? null,
    roles: [...(Array.isArray(catalog?.roles) ? catalog.roles : [])]
      .map(role => ({
        order: role?.order ?? null,
        name: role?.name ?? null,
        exists: role?.exists ?? null,
        bypassRls: role?.bypassRls ?? null,
      }))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    schema: {
      schemaExists: catalog?.schema?.schema_exists ?? null,
      directAcl: sortedAcl(catalog?.schema?.direct_acl),
      effectivePrivileges:
        catalog?.schema?.effective_privileges &&
        typeof catalog.schema.effective_privileges === "object"
          ? catalog.schema.effective_privileges
          : {},
    },
    functions: [...(Array.isArray(catalog?.functions) ? catalog.functions : [])]
      .map(entry => ({
        order: entry?.order ?? null,
        signature: entry?.signature ?? null,
        exists: entry?.exists ?? null,
        ownerMatchesApplication: entry?.ownerMatchesApplication ?? null,
        language: entry?.language ?? null,
        returnType: entry?.returnType ?? null,
        volatility: entry?.volatility ?? null,
        securityDefiner: entry?.securityDefiner ?? null,
        config: Array.isArray(entry?.config)
          ? [...entry.config]
          : entry?.config,
        directAcl: sortedAcl(entry?.directAcl),
        effectiveExecute:
          entry?.effectiveExecute && typeof entry.effectiveExecute === "object"
            ? entry.effectiveExecute
            : {},
      }))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    unexpectedSecurityDefiners: [
      ...(Array.isArray(catalog?.unexpectedSecurityDefiners)
        ? catalog.unexpectedSecurityDefiners
        : []),
    ].sort(compareText),
    obsoleteFunctions: [
      ...(Array.isArray(catalog?.obsoleteFunctions)
        ? catalog.obsoleteFunctions
        : []),
    ]
      .map(entry => ({
        signature: entry?.signature ?? null,
        absent: entry?.absent ?? null,
      }))
      .sort((left, right) =>
        compareText(left.signature ?? "", right.signature ?? "")
      ),
    tables: [...(Array.isArray(catalog?.tables) ? catalog.tables : [])]
      .map(entry => ({
        order: entry?.order ?? null,
        qualifiedName: entry?.qualifiedName ?? null,
        expectedServicePrivileges: [
          ...(Array.isArray(entry?.expectedServicePrivileges)
            ? entry.expectedServicePrivileges
            : []),
        ].sort(compareText),
        exists: entry?.exists ?? null,
        ownerMatchesApplication: entry?.ownerMatchesApplication ?? null,
        relationKind: entry?.relationKind ?? null,
        rowSecurity: entry?.rowSecurity ?? null,
        forceRowSecurity: entry?.forceRowSecurity ?? null,
        directAcl: sortedAcl(entry?.directAcl),
        effectivePrivileges:
          entry?.effectivePrivileges &&
          typeof entry.effectivePrivileges === "object"
            ? entry.effectivePrivileges
            : {},
      }))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    structure: normalizeStructure(catalog?.structure),
  };
}

function addFailure(failures, code) {
  failures.add(code);
}

function nonOwnerAcl(acl) {
  return acl.filter(entry => entry.grantee !== "OWNER");
}

function expectedDirectAcl(privileges) {
  return [...privileges].sort(compareText).map(privilege => ({
    grantee: "service_role",
    privilege,
    grantable: false,
  }));
}

function comparableDirectAcl(acl) {
  return nonOwnerAcl(acl).map(entry => ({
    grantee: entry.grantee,
    privilege: entry.privilege,
    grantable: entry.grantable,
  }));
}

function exactJsonEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function fingerprintAcl(acl) {
  return nonOwnerAcl(acl).map(entry => ({
    grantee: entry.grantee,
    privilege: entry.privilege,
    grantable: entry.grantable,
  }));
}

function securityCatalogFingerprint(normalized) {
  return {
    formatVersion: normalized.formatVersion,
    applicationObjectCount: normalized.applicationObjectCount,
    roles: normalized.roles,
    schema: {
      schemaExists: normalized.schema.schemaExists,
      directAcl: fingerprintAcl(normalized.schema.directAcl).filter(
        entry => entry.privilege === "CREATE"
      ),
      effectivePrivileges: normalized.schema.effectivePrivileges,
    },
    functions: normalized.functions.map(entry => ({
      order: entry.order,
      signature: entry.signature,
      exists: entry.exists,
      ownerMatchesApplication: entry.ownerMatchesApplication,
      language: entry.language,
      returnType: entry.returnType,
      volatility: entry.volatility,
      securityDefiner: entry.securityDefiner,
      config: entry.config,
      directAcl: fingerprintAcl(entry.directAcl),
      effectiveExecute: entry.effectiveExecute,
    })),
    unexpectedSecurityDefiners: normalized.unexpectedSecurityDefiners,
    obsoleteFunctions: normalized.obsoleteFunctions,
    tables: normalized.tables.map(entry => ({
      order: entry.order,
      qualifiedName: entry.qualifiedName,
      expectedServicePrivileges: entry.expectedServicePrivileges,
      exists: entry.exists,
      ownerMatchesApplication: entry.ownerMatchesApplication,
      relationKind: entry.relationKind,
      rowSecurity: entry.rowSecurity,
      forceRowSecurity: entry.forceRowSecurity,
      directAcl: fingerprintAcl(entry.directAcl),
      effectivePrivileges: entry.effectivePrivileges,
    })),
  };
}

export function validateSecurityCatalog(catalog) {
  const normalized = normalizeSecurityCatalog(catalog);
  const failures = new Set();

  if (normalized.formatVersion !== 1) addFailure(failures, "FORMAT_INVALID");
  if (normalized.transaction.readOnly !== true)
    addFailure(failures, "TRANSACTION_NOT_READ_ONLY");
  if (normalized.transaction.isolation !== "repeatable read")
    addFailure(failures, "TRANSACTION_ISOLATION_MISMATCH");
  if (
    !Number.isInteger(normalized.transaction.serverMajor) ||
    normalized.transaction.serverMajor < 10 ||
    normalized.transaction.serverMajor > 99
  ) {
    addFailure(failures, "SERVER_MAJOR_INVALID");
  }
  if (normalized.transaction.timeoutsApplied !== true)
    addFailure(failures, "TRANSACTION_TIMEOUT_MISMATCH");
  if (normalized.transaction.deparserSettingsApplied !== true)
    addFailure(failures, "DEPARSE_SETTINGS_MISMATCH");

  for (const roleName of EXPECTED_RUNTIME_ROLES) {
    const role = normalized.roles.find(entry => entry.name === roleName);
    if (!role || role.exists !== true) addFailure(failures, "ROLE_MISSING");
    if (
      role?.exists === true &&
      role.bypassRls !== (roleName === "service_role")
    ) {
      addFailure(failures, "ROLE_BYPASS_RLS_MISMATCH");
    }
  }

  if (normalized.schema.schemaExists !== true)
    addFailure(failures, "PUBLIC_SCHEMA_MISSING");
  for (const roleName of EXPECTED_RUNTIME_ROLES) {
    const privileges = normalized.schema.effectivePrivileges?.[roleName];
    if (privileges?.usage !== true)
      addFailure(failures, "SCHEMA_USAGE_MISSING");
    if (privileges?.create !== false)
      addFailure(failures, "SCHEMA_CREATE_FORBIDDEN");
  }
  if (
    normalized.schema.directAcl.some(
      entry => entry.grantee !== "OWNER" && entry.privilege === "CREATE"
    )
  ) {
    addFailure(failures, "SCHEMA_CREATE_GRANT_FORBIDDEN");
  }

  EXPECTED_SECURITY_DEFINER_FUNCTIONS.forEach((expected, index) => {
    const observed = normalized.functions.find(
      entry => entry.signature === expected.signature
    );
    if (!observed || observed.exists !== true) {
      addFailure(failures, "FUNCTION_MISSING");
      return;
    }
    if (observed.order !== index + 1)
      addFailure(failures, "FUNCTION_ORDER_MISMATCH");
    if (observed.ownerMatchesApplication !== true)
      addFailure(failures, "FUNCTION_OWNER_MISMATCH");
    if (observed.language !== "plpgsql")
      addFailure(failures, "FUNCTION_LANGUAGE_MISMATCH");
    if (observed.volatility !== expected.volatility)
      addFailure(failures, "FUNCTION_VOLATILITY_MISMATCH");
    if (observed.securityDefiner !== true)
      addFailure(failures, "FUNCTION_SECURITY_DEFINER_DISABLED");
    if (!exactJsonEqual(observed.config, ["search_path=pg_catalog"]))
      addFailure(failures, "FUNCTION_CONFIG_MISMATCH");
    if (
      !exactJsonEqual(
        comparableDirectAcl(observed.directAcl),
        expectedDirectAcl(["EXECUTE"])
      )
    ) {
      addFailure(failures, "FUNCTION_DIRECT_ACL_MISMATCH");
    }
    if (
      observed.effectiveExecute?.anon !== false ||
      observed.effectiveExecute?.authenticated !== false
    ) {
      addFailure(failures, "FUNCTION_EXECUTE_FORBIDDEN");
    }
    if (observed.effectiveExecute?.serviceRole !== true)
      addFailure(failures, "FUNCTION_SERVICE_EXECUTE_MISSING");
  });

  if (
    normalized.functions.length !== EXPECTED_SECURITY_DEFINER_FUNCTIONS.length
  )
    addFailure(failures, "FUNCTION_CATALOG_INCOMPLETE");
  if (normalized.unexpectedSecurityDefiners.length > 0)
    addFailure(failures, "UNEXPECTED_SECURITY_DEFINER");
  if (normalized.obsoleteFunctions.some(entry => entry.absent !== true))
    addFailure(failures, "OBSOLETE_FUNCTION_PRESENT");

  EXPECTED_SENSITIVE_TABLES.forEach((expected, index) => {
    const observed = normalized.tables.find(
      entry => entry.qualifiedName === expected.qualifiedName
    );
    if (!observed || observed.exists !== true) {
      addFailure(failures, "TABLE_MISSING");
      return;
    }
    if (observed.order !== index + 1)
      addFailure(failures, "TABLE_ORDER_MISMATCH");
    if (observed.ownerMatchesApplication !== true)
      addFailure(failures, "TABLE_OWNER_MISMATCH");
    if (observed.relationKind !== "r")
      addFailure(failures, "TABLE_KIND_MISMATCH");
    if (observed.rowSecurity !== true)
      addFailure(failures, "TABLE_RLS_DISABLED");
    if (observed.forceRowSecurity !== false)
      addFailure(failures, "TABLE_FORCE_RLS_MISMATCH");
    if (
      !exactJsonEqual(
        comparableDirectAcl(observed.directAcl),
        expectedDirectAcl(expected.serviceRolePrivileges)
      )
    ) {
      addFailure(failures, "TABLE_DIRECT_ACL_MISMATCH");
    }

    for (const roleName of ["anon", "authenticated"]) {
      const privileges = observed.effectivePrivileges?.[roleName] ?? {};
      if (
        ALL_TABLE_PRIVILEGES.some(privilege => privileges[privilege] !== false)
      ) {
        addFailure(failures, "TABLE_PRIVILEGE_FORBIDDEN");
      }
    }
    const servicePrivileges = observed.effectivePrivileges?.service_role ?? {};
    for (const privilege of ALL_TABLE_PRIVILEGES) {
      const expectedValue = expected.serviceRolePrivileges.includes(privilege);
      if (servicePrivileges[privilege] !== expectedValue) {
        addFailure(failures, "TABLE_SERVICE_PRIVILEGE_MISMATCH");
      }
    }
  });

  if (normalized.tables.length !== EXPECTED_SENSITIVE_TABLES.length)
    addFailure(failures, "TABLE_CATALOG_INCOMPLETE");

  for (const signature of EXPECTED_PUBLIC_FUNCTION_SIGNATURES) {
    const entry = normalized.structure.functions.find(
      candidate => candidate.signature === signature
    );
    if (!entry || entry.exists !== true) {
      addFailure(failures, "STRUCTURE_FUNCTION_MISSING");
    } else if (!SHA256_PATTERN.test(entry.definitionSha256 ?? "")) {
      addFailure(failures, "STRUCTURE_FUNCTION_HASH_INVALID");
    }
  }
  if (
    normalized.structure.functions.length !==
    EXPECTED_PUBLIC_FUNCTION_SIGNATURES.length
  ) {
    addFailure(failures, "STRUCTURE_FUNCTION_CATALOG_INCOMPLETE");
  }
  for (const table of EXPECTED_SENSITIVE_TABLES) {
    const relation = normalized.structure.relations.find(
      candidate => candidate.qualifiedName === table.qualifiedName
    );
    if (!relation || relation.exists !== true) {
      addFailure(failures, "STRUCTURE_RELATION_MISSING");
    } else {
      if (!["r", "p"].includes(relation.kind))
        addFailure(failures, "STRUCTURE_RELATION_KIND_INVALID");
      if (!["p", "u", "t"].includes(relation.persistence))
        addFailure(failures, "STRUCTURE_RELATION_PERSISTENCE_INVALID");
      if (!["d", "n", "f", "i"].includes(relation.replicaIdentity))
        addFailure(failures, "STRUCTURE_REPLICA_IDENTITY_INVALID");
      if (!SHA256_PATTERN.test(relation.optionsSha256 ?? ""))
        addFailure(failures, "STRUCTURE_RELATION_OPTIONS_HASH_INVALID");
      if (
        relation.partitionBoundSha256 !== null &&
        !SHA256_PATTERN.test(relation.partitionBoundSha256 ?? "")
      ) {
        addFailure(failures, "STRUCTURE_PARTITION_BOUND_HASH_INVALID");
      }
    }
    if (
      !normalized.structure.columns.some(
        column => column.qualifiedName === table.qualifiedName
      )
    ) {
      addFailure(failures, "STRUCTURE_TABLE_COLUMNS_MISSING");
    }
  }
  if (
    normalized.structure.relations.length !== EXPECTED_SENSITIVE_TABLES.length
  ) {
    addFailure(failures, "STRUCTURE_RELATION_CATALOG_INCOMPLETE");
  }
  for (const column of normalized.structure.columns) {
    if (
      column.defaultSha256 !== null &&
      !SHA256_PATTERN.test(column.defaultSha256 ?? "")
    ) {
      addFailure(failures, "STRUCTURE_DEFAULT_HASH_INVALID");
    }
  }
  for (const entry of [
    ...normalized.structure.constraints,
    ...normalized.structure.indexes,
    ...normalized.structure.triggers,
  ]) {
    if (!SHA256_PATTERN.test(entry.definitionSha256 ?? "")) {
      addFailure(failures, "STRUCTURE_DEFINITION_HASH_INVALID");
    }
  }
  for (const policy of normalized.structure.policies) {
    if (!SHA256_PATTERN.test(policy.rolesSha256 ?? "")) {
      addFailure(failures, "STRUCTURE_POLICY_HASH_INVALID");
    }
    for (const field of ["usingSha256", "checkSha256"]) {
      if (policy[field] !== null && !SHA256_PATTERN.test(policy[field] ?? "")) {
        addFailure(failures, "STRUCTURE_POLICY_HASH_INVALID");
      }
    }
  }
  if (
    normalized.structure.unexpectedFunctions.length > 0 ||
    normalized.structure.unexpectedTypes.length > 0 ||
    normalized.structure.unexpectedRelations.length > 0
  ) {
    addFailure(failures, "UNEXPECTED_APPLICATION_OBJECT");
  }

  return {
    normalized,
    status: failures.size === 0 ? "pass" : "fail",
    failureCodes: [...failures].sort(compareText),
    canonicalSha256: sha256(
      canonicalJson(securityCatalogFingerprint(normalized))
    ),
    structureSha256: sha256(canonicalJson(normalized.structure)),
  };
}

export function migrationManifestProjection(manifest) {
  return manifest.map(entry => ({
    version: entry.version,
    versionLabel: entry.versionLabel,
    filename: entry.filename,
    checksumSha256: entry.checksum,
  }));
}

export function migrationManifestSha256(manifest) {
  return sha256(canonicalJson(migrationManifestProjection(manifest)));
}

export function securityManifestSha256() {
  return sha256(canonicalJson(SECURITY_CATALOG_CONTRACT));
}

export function validateMigrationHistory(
  history,
  manifest,
  { historyPresent = true, applicationObjectCount = 0 } = {}
) {
  const failures = new Set();
  const observed = Array.isArray(history) ? history : [];
  if (!historyPresent) {
    addFailure(
      failures,
      applicationObjectCount > 0
        ? "BASELINE_REQUIRED"
        : "DATABASE_UNINITIALIZED"
    );
  }

  const expectedVersions = new Set(manifest.map(entry => entry.version));
  const entries = manifest.map(entry => {
    const match = observed.find(row => row?.version === entry.version);
    const filenameMatches = match?.filename === entry.filename;
    const checksumMatches = match?.checksumSha256 === entry.checksum;
    if (!match) addFailure(failures, "MIGRATION_MISSING");
    if (match && !filenameMatches)
      addFailure(failures, "MIGRATION_FILENAME_MISMATCH");
    if (match && !checksumMatches)
      addFailure(failures, "MIGRATION_CHECKSUM_MISMATCH");
    return {
      version: entry.versionLabel,
      filename: entry.filename,
      expectedChecksumSha256: entry.checksum,
      present: Boolean(match),
      filenameMatches,
      checksumMatches,
    };
  });
  const unexpected = observed
    .filter(row => !expectedVersions.has(row?.version))
    .map(row => ({
      version: row?.version ?? null,
      filename: row?.filename ?? null,
      checksumSha256: row?.checksumSha256 ?? null,
    }));
  if (unexpected.length > 0) addFailure(failures, "MIGRATION_UNEXPECTED");

  return {
    status: failures.size === 0 ? "pass" : "fail",
    failureCodes: [...failures].sort(compareText),
    historyPresent,
    expectedFirst: manifest.at(0)?.versionLabel ?? null,
    expectedLast: manifest.at(-1)?.versionLabel ?? null,
    entries,
    unexpected: {
      count: unexpected.length,
      sha256: sha256(canonicalJson(unexpected)),
    },
  };
}

export function buildExpectedContract({
  commitSha,
  manifest,
  securityCatalogSha256,
  applicationStructureSha256,
  serverMajor,
}) {
  if (commitSha !== null && !/^[0-9a-f]{40,64}$/.test(commitSha)) {
    throw new Error("Expected contract commit SHA is invalid");
  }
  if (!SHA256_PATTERN.test(securityCatalogSha256)) {
    throw new Error("Expected security catalog SHA-256 is invalid");
  }
  if (!SHA256_PATTERN.test(applicationStructureSha256)) {
    throw new Error("Expected application structure SHA-256 is invalid");
  }
  if (!Number.isInteger(serverMajor) || serverMajor < 10 || serverMajor > 99) {
    throw new Error("Expected PostgreSQL server major is invalid");
  }
  return {
    schemaVersion: EXPECTED_CONTRACT_SCHEMA_VERSION,
    source: {
      commitSha,
      migrationManifestSha256: migrationManifestSha256(manifest),
      securityManifestSha256: securityManifestSha256(),
      migrationCount: manifest.length,
    },
    database: {
      serverMajor,
      securityCatalogSha256,
      applicationStructureSha256,
    },
  };
}

export function validateExpectedContract(contract, { commitSha, manifest }) {
  const failures = new Set();
  if (contract?.schemaVersion !== EXPECTED_CONTRACT_SCHEMA_VERSION)
    addFailure(failures, "EXPECTED_CONTRACT_FORMAT_INVALID");
  if (!commitSha || contract?.source?.commitSha !== commitSha)
    addFailure(failures, "EXPECTED_CONTRACT_COMMIT_MISMATCH");
  if (
    contract?.source?.migrationManifestSha256 !==
    migrationManifestSha256(manifest)
  ) {
    addFailure(failures, "EXPECTED_CONTRACT_MIGRATION_MANIFEST_MISMATCH");
  }
  if (contract?.source?.securityManifestSha256 !== securityManifestSha256()) {
    addFailure(failures, "EXPECTED_CONTRACT_SECURITY_MANIFEST_MISMATCH");
  }
  if (!SHA256_PATTERN.test(contract?.database?.securityCatalogSha256 ?? "")) {
    addFailure(failures, "EXPECTED_CONTRACT_CATALOG_HASH_INVALID");
  }
  if (
    !Number.isInteger(contract?.database?.serverMajor) ||
    contract.database.serverMajor < 10 ||
    contract.database.serverMajor > 99
  ) {
    addFailure(failures, "EXPECTED_CONTRACT_SERVER_MAJOR_INVALID");
  }
  if (
    !SHA256_PATTERN.test(contract?.database?.applicationStructureSha256 ?? "")
  ) {
    addFailure(failures, "EXPECTED_CONTRACT_STRUCTURE_HASH_INVALID");
  }
  return {
    status: failures.size === 0 ? "pass" : "fail",
    failureCodes: [...failures].sort(compareText),
  };
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function validateSupabaseProbeConfiguration({
  baseUrl,
  publishableKey,
  authenticatedJwt,
}) {
  const failures = new Set();
  let origin = null;
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid origin");
    }
    origin = url.origin;
  } catch {
    addFailure(failures, "HTTP_ORIGIN_INVALID");
  }

  const keyPayload = decodeJwtPayload(publishableKey);
  const publishableKeyValid =
    typeof publishableKey === "string" &&
    publishableKey.length >= 20 &&
    !publishableKey.startsWith("sb_secret_") &&
    (publishableKey.startsWith("sb_publishable_") ||
      keyPayload?.role === "anon");
  if (!publishableKeyValid)
    addFailure(failures, "HTTP_PUBLISHABLE_KEY_INVALID");

  const jwtPayload = decodeJwtPayload(authenticatedJwt);
  let expectedIssuer = null;
  if (origin) expectedIssuer = `${origin}/auth/v1`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !jwtPayload ||
    jwtPayload.role !== "authenticated" ||
    typeof jwtPayload.sub !== "string" ||
    jwtPayload.sub.length === 0 ||
    typeof jwtPayload.iat !== "number" ||
    jwtPayload.iat > nowSeconds + 30 ||
    jwtPayload.iat < nowSeconds - 3_600 ||
    typeof jwtPayload.exp !== "number" ||
    jwtPayload.exp <= nowSeconds + 300 ||
    jwtPayload.exp - jwtPayload.iat > 7_200 ||
    jwtPayload.iss !== expectedIssuer
  ) {
    addFailure(failures, "HTTP_AUTH_JWT_INVALID");
  }

  return {
    status: failures.size === 0 ? "pass" : "fail",
    failureCodes: [...failures].sort(compareText),
    origin,
  };
}

export function validateSupabaseTargetBinding({
  baseUrl,
  pgHost,
  pgUser,
  pgDatabase,
  pgSslMode,
  pgHostAddr,
  pgService,
  pgServiceFile,
  expectedTargetSha256,
}) {
  const failures = new Set();
  let projectRef = null;
  try {
    const url = new URL(baseUrl);
    const match = /^([a-z0-9-]+)\.supabase\.co$/.exec(
      url.hostname.toLowerCase()
    );
    if (
      url.protocol !== "https:" ||
      !match ||
      url.username ||
      url.password ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid Supabase project origin");
    }
    projectRef = match[1];
  } catch {
    addFailure(failures, "TARGET_HTTP_PROJECT_INVALID");
  }

  const normalizedHost =
    typeof pgHost === "string"
      ? pgHost.trim().toLowerCase().replace(/\.$/, "")
      : "";
  const normalizedUser =
    typeof pgUser === "string" ? pgUser.trim().toLowerCase() : "";
  let connectionMode = null;
  if (projectRef && normalizedHost === `db.${projectRef}.supabase.co`) {
    connectionMode = "direct";
  } else if (
    projectRef &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(normalizedHost) &&
    normalizedUser === `postgres.${projectRef}`
  ) {
    connectionMode = "pooler";
  } else {
    addFailure(failures, "TARGET_DATABASE_PROJECT_MISMATCH");
  }

  if (pgDatabase !== "postgres")
    addFailure(failures, "TARGET_DATABASE_NAME_INVALID");
  if (pgSslMode !== "verify-full")
    addFailure(failures, "TARGET_DATABASE_TLS_INVALID");
  if (pgHostAddr?.trim() || pgService?.trim() || pgServiceFile?.trim()) {
    addFailure(failures, "TARGET_DATABASE_INDIRECTION_FORBIDDEN");
  }

  const targetSha256 = projectRef
    ? sha256(`supabase-project:${projectRef}`)
    : null;
  if (
    !SHA256_PATTERN.test(expectedTargetSha256 ?? "") ||
    targetSha256 !== expectedTargetSha256
  ) {
    addFailure(failures, "TARGET_APPROVAL_MISMATCH");
  }

  return {
    status: failures.size === 0 ? "pass" : "fail",
    failureCodes: [...failures].sort(compareText),
    binding: {
      matches: failures.size === 0,
      connectionMode,
      targetSha256,
    },
  };
}

async function readResponseJson(response, maxBytes = SAFE_HTTP_BODY_BYTES) {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("HTTP_RESPONSE_BODY_UNAVAILABLE");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new Error("HTTP_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString(
    "utf8"
  );
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("HTTP_RESPONSE_JSON_INVALID");
  }
}

async function performDeniedRpcProbe({
  url,
  publishableKey,
  authenticatedJwt,
  authenticated,
  fetchImpl,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
        ...(authenticated
          ? { authorization: `Bearer ${authenticatedJwt}` }
          : {}),
      },
      body: JSON.stringify({
        p_engine: "katago",
        p_stale_seconds: 60,
      }),
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        httpStatus: response.status,
        errorCode: null,
        denied: false,
        failureCode: "HTTP_REDIRECT_REJECTED",
      };
    }
    const payload = await readResponseJson(response);
    const expectedStatus = authenticated ? 403 : 401;
    const denied =
      response.status === expectedStatus && payload?.code === "42501";
    return {
      httpStatus: response.status,
      errorCode: payload?.code === "42501" ? "42501" : null,
      denied,
      failureCode: denied ? null : "HTTP_PERMISSION_DENIAL_MISMATCH",
    };
  } catch (error) {
    const safeCode =
      error instanceof Error &&
      [
        "HTTP_RESPONSE_BODY_UNAVAILABLE",
        "HTTP_RESPONSE_TOO_LARGE",
        "HTTP_RESPONSE_JSON_INVALID",
      ].includes(error.message)
        ? error.message
        : "HTTP_REQUEST_FAILED";
    return {
      httpStatus: null,
      errorCode: null,
      denied: false,
      failureCode: safeCode,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSupabaseRpcDenials(
  { baseUrl, publishableKey, authenticatedJwt },
  fetchImpl = globalThis.fetch
) {
  const configuration = validateSupabaseProbeConfiguration({
    baseUrl,
    publishableKey,
    authenticatedJwt,
  });
  if (configuration.status !== "pass") {
    return {
      status: "fail",
      failureCodes: configuration.failureCodes,
      probe: null,
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      status: "fail",
      failureCodes: ["HTTP_FETCH_UNAVAILABLE"],
      probe: null,
    };
  }

  const url = new URL(
    "/rest/v1/rpc/get_analysis_worker_health",
    configuration.origin
  );
  const [anonymous, authenticated] = await Promise.all([
    performDeniedRpcProbe({
      url,
      publishableKey,
      authenticatedJwt,
      authenticated: false,
      fetchImpl,
    }),
    performDeniedRpcProbe({
      url,
      publishableKey,
      authenticatedJwt,
      authenticated: true,
      fetchImpl,
    }),
  ]);
  const failureCodes = [anonymous.failureCode, authenticated.failureCode]
    .filter(Boolean)
    .sort(compareText);
  return {
    status: failureCodes.length === 0 ? "pass" : "fail",
    failureCodes: [...new Set(failureCodes)],
    probe: {
      rpc: "get_analysis_worker_health",
      sideEffectClass: "read-only",
      anonymous: {
        httpStatus: anonymous.httpStatus,
        errorCode: anonymous.errorCode,
        denied: anonymous.denied,
      },
      authenticated: {
        httpStatus: authenticated.httpStatus,
        errorCode: authenticated.errorCode,
        denied: authenticated.denied,
      },
    },
  };
}

function sanitizedFunctionEvidence(validation) {
  return validation.normalized.functions.map(entry => {
    const unexpectedDirectGranteeCount = nonOwnerAcl(entry.directAcl).filter(
      acl =>
        acl.grantee !== "service_role" ||
        acl.privilege !== "EXECUTE" ||
        acl.grantable !== false
    ).length;
    return {
      signature: entry.signature,
      exists: entry.exists === true,
      securityDefiner: entry.securityDefiner === true,
      ownerMatchesApplication: entry.ownerMatchesApplication === true,
      searchPathExact: exactJsonEqual(entry.config, ["search_path=pg_catalog"]),
      anonExecute: entry.effectiveExecute?.anon ?? null,
      authenticatedExecute: entry.effectiveExecute?.authenticated ?? null,
      serviceRoleExecute: entry.effectiveExecute?.serviceRole ?? null,
      unexpectedDirectExecuteGranteeCount: unexpectedDirectGranteeCount,
    };
  });
}

function sanitizedTableEvidence(validation) {
  return validation.normalized.tables.map(entry => ({
    qualifiedName: entry.qualifiedName,
    exists: entry.exists === true,
    ownerMatchesApplication: entry.ownerMatchesApplication === true,
    rowSecurity: entry.rowSecurity === true,
    forceRowSecurity: entry.forceRowSecurity === true,
    serviceRolePrivileges: ALL_TABLE_PRIVILEGES.filter(
      privilege => entry.effectivePrivileges?.service_role?.[privilege] === true
    ).sort(compareText),
    anonHasPrivilege: ALL_TABLE_PRIVILEGES.some(
      privilege => entry.effectivePrivileges?.anon?.[privilege] === true
    ),
    authenticatedHasPrivilege: ALL_TABLE_PRIVILEGES.some(
      privilege =>
        entry.effectivePrivileges?.authenticated?.[privilege] === true
    ),
    unexpectedDirectGranteeCount: nonOwnerAcl(entry.directAcl).filter(
      acl => acl.grantee !== "service_role"
    ).length,
  }));
}

const HTTP_FAILURE_CODES = new Set([
  "HTTP_AUTH_JWT_INVALID",
  "HTTP_FETCH_UNAVAILABLE",
  "HTTP_ORIGIN_INVALID",
  "HTTP_PERMISSION_DENIAL_MISMATCH",
  "HTTP_PUBLISHABLE_KEY_INVALID",
  "HTTP_REDIRECT_REJECTED",
  "HTTP_REQUEST_FAILED",
  "HTTP_RESPONSE_BODY_UNAVAILABLE",
  "HTTP_RESPONSE_JSON_INVALID",
  "HTTP_RESPONSE_TOO_LARGE",
]);

function sanitizedHttpEndpoint(endpoint) {
  return {
    httpStatus:
      Number.isInteger(endpoint?.httpStatus) &&
      endpoint.httpStatus >= 100 &&
      endpoint.httpStatus <= 599
        ? endpoint.httpStatus
        : null,
    errorCode: endpoint?.errorCode === "42501" ? "42501" : null,
    denied: endpoint?.denied === true,
  };
}

function sanitizeHttpEvidence(httpEvidence) {
  if (!httpEvidence) {
    return {
      status: "not-run",
      failureCodes: ["HTTP_EVIDENCE_MISSING"],
      probe: null,
    };
  }
  const anonymous = sanitizedHttpEndpoint(httpEvidence.probe?.anonymous);
  const authenticated = sanitizedHttpEndpoint(
    httpEvidence.probe?.authenticated
  );
  const contractMatches =
    anonymous.httpStatus === 401 &&
    anonymous.errorCode === "42501" &&
    anonymous.denied &&
    authenticated.httpStatus === 403 &&
    authenticated.errorCode === "42501" &&
    authenticated.denied;
  const suppliedFailureCodes = Array.isArray(httpEvidence.failureCodes)
    ? httpEvidence.failureCodes.filter(code => HTTP_FAILURE_CODES.has(code))
    : [];
  const successful = contractMatches && httpEvidence.status === "pass";
  const failureCodes = successful
    ? []
    : [...new Set([...suppliedFailureCodes, "HTTP_EVIDENCE_INVALID"])].sort(
        compareText
      );
  return {
    status: successful ? "pass" : "fail",
    failureCodes,
    probe: {
      rpc: "get_analysis_worker_health",
      sideEffectClass: "read-only",
      anonymous,
      authenticated,
    },
  };
}

export function buildStagingEvidenceArtifact({
  commitSha,
  manifest,
  catalogValidation,
  migrationValidation,
  expectedCatalogSha256,
  expectedStructureSha256,
  expectedServerMajor,
  targetBinding,
  httpEvidence,
  generatedAt = new Date().toISOString(),
}) {
  const sanitizedHttp = sanitizeHttpEvidence(httpEvidence);
  const safeObservedStructureSha256 = SHA256_PATTERN.test(
    catalogValidation.structureSha256 ?? ""
  )
    ? catalogValidation.structureSha256
    : null;
  const safeExpectedStructureSha256 = SHA256_PATTERN.test(
    expectedStructureSha256 ?? ""
  )
    ? expectedStructureSha256
    : null;
  const failureCodes = new Set([
    ...catalogValidation.failureCodes,
    ...migrationValidation.failureCodes,
    ...(catalogValidation.canonicalSha256 === expectedCatalogSha256
      ? []
      : ["CATALOG_BASELINE_MISMATCH"]),
    ...(safeObservedStructureSha256 !== null &&
    safeObservedStructureSha256 === safeExpectedStructureSha256
      ? []
      : ["APPLICATION_STRUCTURE_BASELINE_MISMATCH"]),
    ...(Number.isInteger(expectedServerMajor) &&
    catalogValidation.normalized.transaction.serverMajor === expectedServerMajor
      ? []
      : ["SERVER_MAJOR_BASELINE_MISMATCH"]),
    ...(targetBinding?.matches === true ? [] : ["TARGET_BINDING_MISMATCH"]),
    ...sanitizedHttp.failureCodes,
  ]);
  const status = failureCodes.size === 0 ? "pass" : "fail";
  const artifact = {
    schemaVersion: STAGING_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    target: {
      kind: "staging",
      label: "staging",
      bindingMatches: targetBinding?.matches === true,
      connectionMode:
        targetBinding?.connectionMode === "direct" ||
        targetBinding?.connectionMode === "pooler"
          ? targetBinding.connectionMode
          : null,
      targetSha256: SHA256_PATTERN.test(targetBinding?.targetSha256 ?? "")
        ? targetBinding.targetSha256
        : null,
    },
    source: {
      commitSha,
      migrationManifestSha256: migrationManifestSha256(manifest),
      securityManifestSha256: securityManifestSha256(),
      migrationCount: manifest.length,
    },
    database: {
      transaction: {
        readOnly: catalogValidation.normalized.transaction.readOnly === true,
        isolation: catalogValidation.normalized.transaction.isolation,
        serverMajor: catalogValidation.normalized.transaction.serverMajor,
        expectedServerMajor: Number.isInteger(expectedServerMajor)
          ? expectedServerMajor
          : null,
        timeoutsApplied:
          catalogValidation.normalized.transaction.timeoutsApplied === true,
        deparserSettingsApplied:
          catalogValidation.normalized.transaction.deparserSettingsApplied ===
          true,
      },
      history: {
        status: migrationValidation.status,
        historyPresent: migrationValidation.historyPresent,
        expectedFirst: migrationValidation.expectedFirst,
        expectedLast: migrationValidation.expectedLast,
        entries: migrationValidation.entries,
        unexpected: migrationValidation.unexpected,
      },
      security: {
        status:
          catalogValidation.status === "pass" &&
          catalogValidation.canonicalSha256 === expectedCatalogSha256
            ? "match"
            : "drift",
        expectedFunctionCount: EXPECTED_SECURITY_DEFINER_FUNCTIONS.length,
        observedFunctionCount: catalogValidation.normalized.functions.filter(
          entry => entry.exists === true
        ).length,
        functions: sanitizedFunctionEvidence(catalogValidation),
        unexpectedSecurityDefiners: {
          count: catalogValidation.normalized.unexpectedSecurityDefiners.length,
          sha256: sha256(
            canonicalJson(
              catalogValidation.normalized.unexpectedSecurityDefiners
            )
          ),
        },
        tables: sanitizedTableEvidence(catalogValidation),
        canonicalCatalogSha256: catalogValidation.canonicalSha256,
        expectedCatalogSha256,
      },
      structure: {
        status:
          safeObservedStructureSha256 !== null &&
          safeObservedStructureSha256 === safeExpectedStructureSha256
            ? "match"
            : "drift",
        applicationStructureSha256: safeObservedStructureSha256,
        expectedApplicationStructureSha256: safeExpectedStructureSha256,
        expectedFunctionCount: EXPECTED_PUBLIC_FUNCTION_SIGNATURES.length,
        unexpectedFunctionCount:
          catalogValidation.normalized.structure.unexpectedFunctions.length,
        unexpectedTypeCount:
          catalogValidation.normalized.structure.unexpectedTypes.length,
        unexpectedRelationCount:
          catalogValidation.normalized.structure.unexpectedRelations.length,
      },
    },
    http: {
      status: sanitizedHttp.status,
      probe: sanitizedHttp.probe,
    },
    result: {
      status,
      failureCodes: [...failureCodes].sort(compareText),
    },
  };
  const { generatedAt: _generatedAt, ...hashInput } = artifact;
  return {
    ...artifact,
    evidenceSha256: sha256(canonicalJson(hashInput)),
  };
}

export function buildDatabaseFixtureEvidence({
  commitSha,
  manifest,
  catalogValidation,
  migrationValidation,
  generatedAt = new Date().toISOString(),
}) {
  if (!SHA256_PATTERN.test(catalogValidation.structureSha256 ?? "")) {
    throw new Error("Fixture application structure SHA-256 is invalid");
  }
  const failureCodes = [
    ...catalogValidation.failureCodes,
    ...migrationValidation.failureCodes,
  ].sort(compareText);
  const artifact = {
    schemaVersion: STAGING_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    target: {
      kind: "disposable-postgres",
      label: "ci-expected",
    },
    source: {
      commitSha,
      migrationManifestSha256: migrationManifestSha256(manifest),
      securityManifestSha256: securityManifestSha256(),
      migrationCount: manifest.length,
    },
    database: {
      transaction: catalogValidation.normalized.transaction,
      history: {
        status: migrationValidation.status,
        historyPresent: migrationValidation.historyPresent,
        expectedFirst: migrationValidation.expectedFirst,
        expectedLast: migrationValidation.expectedLast,
        entries: migrationValidation.entries,
        unexpected: migrationValidation.unexpected,
      },
      security: {
        status: catalogValidation.status,
        functions: sanitizedFunctionEvidence(catalogValidation),
        unexpectedSecurityDefiners: {
          count: catalogValidation.normalized.unexpectedSecurityDefiners.length,
          sha256: sha256(
            canonicalJson(
              catalogValidation.normalized.unexpectedSecurityDefiners
            )
          ),
        },
        tables: sanitizedTableEvidence(catalogValidation),
        canonicalCatalogSha256: catalogValidation.canonicalSha256,
      },
      structure: {
        status: "expected",
        applicationStructureSha256: catalogValidation.structureSha256,
        expectedFunctionCount: EXPECTED_PUBLIC_FUNCTION_SIGNATURES.length,
        unexpectedFunctionCount:
          catalogValidation.normalized.structure.unexpectedFunctions.length,
        unexpectedTypeCount:
          catalogValidation.normalized.structure.unexpectedTypes.length,
        unexpectedRelationCount:
          catalogValidation.normalized.structure.unexpectedRelations.length,
      },
    },
    http: {
      status: "not-applicable",
      probe: null,
    },
    result: {
      status: failureCodes.length === 0 ? "pass" : "fail",
      failureCodes,
    },
  };
  const { generatedAt: _generatedAt, ...hashInput } = artifact;
  return {
    ...artifact,
    evidenceSha256: sha256(canonicalJson(hashInput)),
  };
}
