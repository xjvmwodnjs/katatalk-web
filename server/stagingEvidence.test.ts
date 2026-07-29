import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_MARKER,
  HISTORY_MARKER,
  buildStagingCatalogSql,
  parseStagingCatalogOutput,
} from "../scripts/db/stagingEvidenceCatalog.mjs";
import {
  buildExpectedContract,
  buildStagingEvidenceArtifact,
  canonicalJson,
  probeSupabaseRpcDenials,
  validateExpectedContract,
  validateMigrationHistory,
  validateSecurityCatalog,
  validateSupabaseProbeConfiguration,
  validateSupabaseTargetBinding,
} from "../scripts/db/stagingEvidenceCore.mjs";
import {
  ALL_TABLE_PRIVILEGES,
  EXPECTED_PUBLIC_FUNCTION_SIGNATURES,
  EXPECTED_RUNTIME_ROLES,
  EXPECTED_SECURITY_DEFINER_FUNCTIONS,
  EXPECTED_SENSITIVE_TABLES,
  OBSOLETE_FUNCTION_SIGNATURES,
} from "../scripts/db/stagingSecurityManifest.mjs";
import { loadMigrationManifest } from "../scripts/db/migrationRunner.mjs";

function ownerAcl(privilege: string) {
  return {
    grantee: "OWNER",
    grantor: "OWNER",
    privilege,
    grantable: true,
  };
}

function serviceAcl(privilege: string) {
  return {
    grantee: "service_role",
    grantor: "OWNER",
    privilege,
    grantable: false,
  };
}

function privilegeMap(enabled: string[] = []) {
  return Object.fromEntries(
    ALL_TABLE_PRIVILEGES.map(privilege => [
      privilege,
      enabled.includes(privilege),
    ])
  );
}

function fakeHash(index: number) {
  return index.toString(16).padStart(64, "0");
}

function validCatalog() {
  return {
    formatVersion: 1,
    transaction: {
      readOnly: true,
      isolation: "repeatable read",
      serverMajor: 16,
      timeoutsApplied: true,
      deparserSettingsApplied: true,
    },
    historyPresent: true,
    applicationObjectCount: 3,
    roles: EXPECTED_RUNTIME_ROLES.map((name, index) => ({
      order: index + 1,
      name,
      exists: true,
      bypassRls: name === "service_role",
    })),
    schema: {
      schema_exists: true,
      direct_acl: [
        ownerAcl("USAGE"),
        ownerAcl("CREATE"),
        {
          grantee: "PUBLIC",
          grantor: "OWNER",
          privilege: "USAGE",
          grantable: false,
        },
      ],
      effective_privileges: Object.fromEntries(
        EXPECTED_RUNTIME_ROLES.map(role => [
          role,
          { usage: true, create: false },
        ])
      ),
    },
    functions: EXPECTED_SECURITY_DEFINER_FUNCTIONS.map((entry, index) => ({
      order: index + 1,
      signature: entry.signature,
      exists: true,
      ownerMatchesApplication: true,
      language: "plpgsql",
      returnType: "jsonb",
      volatility: entry.volatility,
      securityDefiner: true,
      config: ["search_path=pg_catalog"],
      directAcl: [ownerAcl("EXECUTE"), serviceAcl("EXECUTE")],
      effectiveExecute: {
        anon: false,
        authenticated: false,
        serviceRole: true,
      },
    })),
    unexpectedSecurityDefiners: [],
    obsoleteFunctions: OBSOLETE_FUNCTION_SIGNATURES.map(signature => ({
      signature,
      absent: true,
    })),
    tables: EXPECTED_SENSITIVE_TABLES.map((entry, index) => ({
      order: index + 1,
      qualifiedName: entry.qualifiedName,
      expectedServicePrivileges: entry.serviceRolePrivileges,
      exists: true,
      ownerMatchesApplication: true,
      relationKind: "r",
      rowSecurity: true,
      forceRowSecurity: false,
      directAcl: [
        ...ALL_TABLE_PRIVILEGES.map(ownerAcl),
        ...entry.serviceRolePrivileges.map(serviceAcl),
      ],
      effectivePrivileges: {
        anon: privilegeMap(),
        authenticated: privilegeMap(),
        service_role: privilegeMap(entry.serviceRolePrivileges),
      },
    })),
    structure: {
      functions: EXPECTED_PUBLIC_FUNCTION_SIGNATURES.map(
        (signature, index) => ({
          signature,
          exists: true,
          definitionSha256: fakeHash(index + 1),
        })
      ),
      relations: EXPECTED_SENSITIVE_TABLES.map(entry => ({
        qualifiedName: entry.qualifiedName,
        exists: true,
        kind: "r",
        persistence: "p",
        replicaIdentity: "d",
        accessMethod: "heap",
        tablespace: null,
        optionsSha256: fakeHash(50),
        partitionBoundSha256: null,
      })),
      columns: EXPECTED_SENSITIVE_TABLES.map((entry, index) => ({
        qualifiedName: entry.qualifiedName,
        order: 1,
        name: "id",
        dataType: "text",
        notNull: true,
        identityKind: "",
        generatedKind: "",
        collation: "pg_catalog.default",
        defaultSha256: index === 0 ? fakeHash(100) : null,
      })),
      constraints: [],
      indexes: [],
      policies: [],
      triggers: [],
      unexpectedFunctions: [],
      unexpectedTypes: [],
      unexpectedRelations: [],
    },
  };
}

function validHistory() {
  return loadMigrationManifest().map(entry => ({
    version: entry.version,
    filename: entry.filename,
    checksumSha256: entry.checksum,
  }));
}

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function validProbeConfiguration() {
  const origin = "https://staging-project.supabase.co";
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    baseUrl: origin,
    publishableKey: `sb_publishable_${"a".repeat(32)}`,
    authenticatedJwt: jwt({
      role: "authenticated",
      sub: "staging-evidence-user",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
      iss: `${origin}/auth/v1`,
    }),
  };
}

describe("read-only staging catalog collector", () => {
  it("builds one bounded read-only transaction without DDL, DML, or RPC calls", () => {
    const sql = buildStagingCatalogSql();

    expect(sql).toContain(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    expect(sql).toContain("SET LOCAL statement_timeout = '10s'");
    expect(sql).toContain("SET LOCAL lock_timeout = '2s'");
    expect(sql).toContain(
      "SET LOCAL idle_in_transaction_session_timeout = '15s'"
    );
    expect(sql).toContain("SET LOCAL search_path = pg_catalog");
    expect(sql).toContain("SET LOCAL quote_all_identifiers = off");
    expect(sql.match(/AND relation\.relkind <> 'c'/g)).toHaveLength(2);
    expect(sql).toContain("'deferrable', is_deferrable");
    expect(sql).toContain("::pg_catalog.int4");
    expect(sql).not.toContain("::pg_catalog.integer");
    expect(sql).toContain(CATALOG_MARKER);
    expect(sql).toContain(HISTORY_MARKER);
    expect(sql).toContain("\\if :history_present");
    expect(sql.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(sql).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|DO|CALL)\b/im
    );
    expect(sql).not.toContain("SELECT public.get_analysis_worker_health");
  });

  it("parses exactly one catalog and history marker across CRLF output", () => {
    const result = parseStagingCatalogOutput(
      `BEGIN\r\n${CATALOG_MARKER}{"formatVersion":1}\r\n${HISTORY_MARKER}[{"version":1}]\r\nROLLBACK\r\n`
    );

    expect(result).toEqual({
      catalog: { formatVersion: 1 },
      history: [{ version: 1 }],
    });
    expect(() =>
      parseStagingCatalogOutput(
        `${CATALOG_MARKER}{}\n${CATALOG_MARKER}{}\n${HISTORY_MARKER}[]`
      )
    ).toThrow(/exactly one/);
    expect(() =>
      parseStagingCatalogOutput(`${CATALOG_MARKER}{bad}\n${HISTORY_MARKER}[]`)
    ).toThrow(/Malformed/);
  });
});

describe("staging security catalog contract", () => {
  it("accepts the exact 11-function, 6-table, and schema contract", () => {
    const validation = validateSecurityCatalog(validCatalog());

    expect(validation.status).toBe("pass");
    expect(validation.failureCodes).toEqual([]);
    expect(validation.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the canonical hash stable when ACL input ordering changes", () => {
    const left = validCatalog();
    const right = structuredClone(left);
    right.functions.forEach(entry => entry.directAcl.reverse());
    right.tables.forEach(entry => entry.directAcl.reverse());
    right.schema.direct_acl.reverse();

    expect(validateSecurityCatalog(left).canonicalSha256).toBe(
      validateSecurityCatalog(right).canonicalSha256
    );
  });

  it("detects function-body drift through the separate structural hash", () => {
    const baseline = validateSecurityCatalog(validCatalog());
    const changedCatalog = validCatalog();
    changedCatalog.structure.functions[0].definitionSha256 = fakeHash(999);
    const changed = validateSecurityCatalog(changedCatalog);

    expect(changed.canonicalSha256).toBe(baseline.canonicalSha256);
    expect(changed.structureSha256).not.toBe(baseline.structureSha256);
  });

  it("detects table persistence drift through the structural hash", () => {
    const baseline = validateSecurityCatalog(validCatalog());
    const changedCatalog = validCatalog();
    changedCatalog.structure.relations[0].persistence = "u";
    const changed = validateSecurityCatalog(changedCatalog);

    expect(changed.canonicalSha256).toBe(baseline.canonicalSha256);
    expect(changed.structureSha256).not.toBe(baseline.structureSha256);
  });

  it.each([
    [
      "FUNCTION_MISSING",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.functions[0].exists = false;
      },
    ],
    [
      "FUNCTION_OWNER_MISMATCH",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.functions[0].ownerMatchesApplication = false;
      },
    ],
    [
      "FUNCTION_SECURITY_DEFINER_DISABLED",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.functions[0].securityDefiner = false;
      },
    ],
    [
      "FUNCTION_CONFIG_MISMATCH",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.functions[0].config = ["search_path=public"];
      },
    ],
    [
      "FUNCTION_EXECUTE_FORBIDDEN",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.functions[0].effectiveExecute.anon = true;
      },
    ],
    [
      "UNEXPECTED_SECURITY_DEFINER",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.unexpectedSecurityDefiners.push(
          "public.rogue_security_definer()"
        );
      },
    ],
    [
      "TABLE_RLS_DISABLED",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.tables[0].rowSecurity = false;
      },
    ],
    [
      "TABLE_PRIVILEGE_FORBIDDEN",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.tables[0].effectivePrivileges.authenticated.SELECT = true;
      },
    ],
    [
      "TABLE_SERVICE_PRIVILEGE_MISMATCH",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.tables[2].effectivePrivileges.service_role.UPDATE = false;
      },
    ],
    [
      "SCHEMA_CREATE_FORBIDDEN",
      (catalog: ReturnType<typeof validCatalog>) => {
        catalog.schema.effective_privileges.anon.create = true;
      },
    ],
  ])("fails closed with %s", (expectedCode, mutate) => {
    const catalog = validCatalog();
    mutate(catalog);

    expect(validateSecurityCatalog(catalog).failureCodes).toContain(
      expectedCode
    );
  });
});

describe("staging migration and expected-contract evidence", () => {
  it("matches all repository migration filenames and checksums", () => {
    const manifest = loadMigrationManifest();
    const validation = validateMigrationHistory(validHistory(), manifest, {
      historyPresent: true,
      applicationObjectCount: 3,
    });

    expect(validation.status).toBe("pass");
    expect(validation.entries).toHaveLength(13);
    expect(validation.unexpected.count).toBe(0);
  });

  it("distinguishes missing history on an existing schema from an empty database", () => {
    const manifest = loadMigrationManifest();

    expect(
      validateMigrationHistory([], manifest, {
        historyPresent: false,
        applicationObjectCount: 3,
      }).failureCodes
    ).toContain("BASELINE_REQUIRED");
    expect(
      validateMigrationHistory([], manifest, {
        historyPresent: false,
        applicationObjectCount: 0,
      }).failureCodes
    ).toContain("DATABASE_UNINITIALIZED");
  });

  it("rejects checksum drift and unexpected future migrations", () => {
    const manifest = loadMigrationManifest();
    const history = validHistory();
    history[0].checksumSha256 = "0".repeat(64);
    history.push({
      version: 999,
      filename: "999_unreviewed.sql",
      checksumSha256: "1".repeat(64),
    });

    const validation = validateMigrationHistory(history, manifest);
    expect(validation.failureCodes).toEqual(
      expect.arrayContaining([
        "MIGRATION_CHECKSUM_MISMATCH",
        "MIGRATION_UNEXPECTED",
      ])
    );
  });

  it("binds the expected catalog to the same commit and source manifests", () => {
    const manifest = loadMigrationManifest();
    const commitSha = "a".repeat(40);
    const catalogHash = validateSecurityCatalog(validCatalog()).canonicalSha256;
    const contract = buildExpectedContract({
      commitSha,
      manifest,
      securityCatalogSha256: catalogHash,
      applicationStructureSha256:
        validateSecurityCatalog(validCatalog()).structureSha256,
      serverMajor: 16,
    });

    expect(
      validateExpectedContract(contract, { commitSha, manifest }).status
    ).toBe("pass");
    expect(
      validateExpectedContract(contract, {
        commitSha: "b".repeat(40),
        manifest,
      }).failureCodes
    ).toContain("EXPECTED_CONTRACT_COMMIT_MISMATCH");
  });
});

describe("safe Supabase HTTP permission evidence", () => {
  it("binds direct and pooler DB identities to the approved HTTP project", () => {
    const targetSha256 =
      "7d02038766123377779096f4e6fcdedacc35fb44723c23bfb2e8c68a8ad15e93";
    const direct = validateSupabaseTargetBinding({
      baseUrl: "https://staging-project.supabase.co",
      pgHost: "db.staging-project.supabase.co",
      pgUser: "postgres",
      pgDatabase: "postgres",
      pgSslMode: "verify-full",
      expectedTargetSha256: targetSha256,
    });
    const pooler = validateSupabaseTargetBinding({
      baseUrl: "https://staging-project.supabase.co",
      pgHost: "aws-0-ap-northeast-2.pooler.supabase.com",
      pgUser: "postgres.staging-project",
      pgDatabase: "postgres",
      pgSslMode: "verify-full",
      expectedTargetSha256: targetSha256,
    });

    expect(direct.status).toBe("pass");
    expect(direct.binding.connectionMode).toBe("direct");
    expect(pooler.status).toBe("pass");
    expect(pooler.binding.connectionMode).toBe("pooler");
    expect(
      validateSupabaseTargetBinding({
        baseUrl: "https://staging-project.supabase.co",
        pgHost: "db.other-project.supabase.co",
        pgUser: "postgres",
        pgDatabase: "postgres",
        pgSslMode: "verify-full",
        expectedTargetSha256: targetSha256,
      }).failureCodes
    ).toContain("TARGET_DATABASE_PROJECT_MISMATCH");
  });

  it("requires an exact HTTPS origin, publishable/anon key, and staging Supabase user JWT", () => {
    const valid = validProbeConfiguration();
    expect(validateSupabaseProbeConfiguration(valid).status).toBe("pass");

    expect(
      validateSupabaseProbeConfiguration({
        ...valid,
        baseUrl: "https://staging-project.supabase.co/rest/v1",
      }).failureCodes
    ).toContain("HTTP_ORIGIN_INVALID");
    expect(
      validateSupabaseProbeConfiguration({
        ...valid,
        publishableKey: "sb_secret_never-accepted",
      }).failureCodes
    ).toContain("HTTP_PUBLISHABLE_KEY_INVALID");
    expect(
      validateSupabaseProbeConfiguration({
        ...valid,
        authenticatedJwt: jwt({
          role: "service_role",
          sub: "wrong",
          exp: Math.floor(Date.now() / 1000) + 3_600,
          iss: "https://staging-project.supabase.co/auth/v1",
        }),
      }).failureCodes
    ).toContain("HTTP_AUTH_JWT_INVALID");
  });

  it("rejects stale or long-lived authenticated JWT evidence credentials", () => {
    const valid = validProbeConfiguration();
    const origin = valid.baseUrl;
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const payload of [
      {
        role: "authenticated",
        sub: "staging-evidence-user",
        iat: nowSeconds - 7_200,
        exp: nowSeconds + 3_600,
        iss: `${origin}/auth/v1`,
      },
      {
        role: "authenticated",
        sub: "staging-evidence-user",
        iat: nowSeconds,
        exp: nowSeconds + 86_400,
        iss: `${origin}/auth/v1`,
      },
    ]) {
      expect(
        validateSupabaseProbeConfiguration({
          ...valid,
          authenticatedJwt: jwt(payload),
        }).failureCodes
      ).toContain("HTTP_AUTH_JWT_INVALID");
    }
  });

  it("accepts only anon 401/42501 and authenticated 403/42501", async () => {
    const configuration = validProbeConfiguration();
    const fetchImpl = vi.fn(async (_url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const authenticated = headers.has("authorization");
      return new Response(JSON.stringify({ code: "42501" }), {
        status: authenticated ? 403 : 401,
        headers: { "content-type": "application/json" },
      });
    });

    const evidence = await probeSupabaseRpcDenials(configuration, fetchImpl);
    expect(evidence.status).toBe("pass");
    expect(evidence.probe?.anonymous).toEqual({
      httpStatus: 401,
      errorCode: "42501",
      denied: true,
    });
    expect(evidence.probe?.authenticated).toEqual({
      httpStatus: 403,
      errorCode: "42501",
      denied: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const anonymousCall = fetchImpl.mock.calls.find(
      ([, init]) => !new Headers(init.headers).has("authorization")
    );
    expect(anonymousCall).toBeDefined();
  });

  it.each([
    [200, "42501"],
    [404, "PGRST202"],
    [401, "42501"],
    [500, "XX000"],
  ])(
    "rejects non-contract authenticated response %i/%s",
    async (status, code) => {
      const configuration = validProbeConfiguration();
      const fetchImpl = vi.fn(async (_url: URL, init: RequestInit) => {
        const authenticated = new Headers(init.headers).has("authorization");
        return new Response(JSON.stringify({ code }), {
          status: authenticated ? status : 401,
        });
      });

      const evidence = await probeSupabaseRpcDenials(configuration, fetchImpl);
      expect(evidence.status).toBe("fail");
      expect(evidence.failureCodes).toContain(
        "HTTP_PERMISSION_DENIAL_MISMATCH"
      );
    }
  );

  it("does not preserve an attacker-controlled error code", async () => {
    const configuration = validProbeConfiguration();
    const fetchImpl = vi.fn(async (_url: URL, init: RequestInit) => {
      const authenticated = new Headers(init.headers).has("authorization");
      return new Response(
        JSON.stringify({
          code: authenticated ? "LEAKEDTOKEN12345" : "42501",
        }),
        { status: authenticated ? 403 : 401 }
      );
    });

    const evidence = await probeSupabaseRpcDenials(configuration, fetchImpl);
    expect(evidence.status).toBe("fail");
    expect(evidence.probe?.authenticated.errorCode).toBeNull();
    expect(canonicalJson(evidence)).not.toContain("LEAKEDTOKEN12345");
  });
});

describe("sanitized staging artifact", () => {
  it("contains only allowlisted evidence and a stable evidence hash", () => {
    const manifest = loadMigrationManifest();
    const catalogValidation = validateSecurityCatalog(validCatalog());
    const migrationValidation = validateMigrationHistory(
      validHistory(),
      manifest
    );
    const artifact = buildStagingEvidenceArtifact({
      commitSha: "a".repeat(40),
      manifest,
      catalogValidation,
      migrationValidation,
      expectedCatalogSha256: catalogValidation.canonicalSha256,
      expectedStructureSha256: catalogValidation.structureSha256,
      expectedServerMajor: 16,
      targetBinding: {
        matches: true,
        connectionMode: "direct",
        targetSha256: "d".repeat(64),
      },
      httpEvidence: {
        status: "pass",
        failureCodes: [],
        probe: {
          rpc: "get_analysis_worker_health",
          sideEffectClass: "read-only",
          anonymous: {
            httpStatus: 401,
            errorCode: "42501",
            denied: true,
          },
          authenticated: {
            httpStatus: 403,
            errorCode: "42501",
            denied: true,
          },
        },
      },
      generatedAt: "2026-07-24T00:00:00.000Z",
    });
    const serialized = canonicalJson(artifact);

    expect(artifact.result.status).toBe("pass");
    expect(artifact.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("supabase.co");
    expect(serialized).not.toContain("rogue_security_definer");
    expect(serialized).not.toContain("function body");
  });

  it("reconstructs HTTP evidence instead of serializing supplied fields", () => {
    const manifest = loadMigrationManifest();
    const catalogValidation = validateSecurityCatalog(validCatalog());
    const artifact = buildStagingEvidenceArtifact({
      commitSha: "a".repeat(40),
      manifest,
      catalogValidation,
      migrationValidation: validateMigrationHistory(validHistory(), manifest),
      expectedCatalogSha256: catalogValidation.canonicalSha256,
      expectedStructureSha256: catalogValidation.structureSha256,
      expectedServerMajor: 16,
      targetBinding: {
        matches: true,
        connectionMode: "direct",
        targetSha256: "d".repeat(64),
      },
      httpEvidence: {
        status: "fail",
        failureCodes: ["LEAKEDTOKEN12345"],
        probe: {
          rpc: "attacker-controlled",
          sideEffectClass: "write",
          secret: "LEAKEDTOKEN12345",
          anonymous: {
            httpStatus: 401,
            errorCode: "42501",
            denied: true,
          },
          authenticated: {
            httpStatus: 403,
            errorCode: "LEAKEDTOKEN12345",
            denied: false,
          },
        },
      },
      generatedAt: "2026-07-24T00:00:00.000Z",
    });
    const serialized = canonicalJson(artifact);

    expect(artifact.result.status).toBe("fail");
    expect(artifact.http.probe?.rpc).toBe("get_analysis_worker_health");
    expect(serialized).not.toContain("LEAKEDTOKEN12345");
    expect(serialized).not.toContain("attacker-controlled");
  });

  it("fails when the live application structure differs from the expected baseline", () => {
    const manifest = loadMigrationManifest();
    const expectedValidation = validateSecurityCatalog(validCatalog());
    const changedCatalog = validCatalog();
    changedCatalog.structure.functions[0].definitionSha256 = fakeHash(999);
    const changedValidation = validateSecurityCatalog(changedCatalog);

    const artifact = buildStagingEvidenceArtifact({
      commitSha: "a".repeat(40),
      manifest,
      catalogValidation: changedValidation,
      migrationValidation: validateMigrationHistory(validHistory(), manifest),
      expectedCatalogSha256: expectedValidation.canonicalSha256,
      expectedStructureSha256: expectedValidation.structureSha256,
      expectedServerMajor: 16,
      targetBinding: {
        matches: true,
        connectionMode: "direct",
        targetSha256: "d".repeat(64),
      },
      httpEvidence: {
        status: "pass",
        failureCodes: [],
        probe: {
          rpc: "get_analysis_worker_health",
          sideEffectClass: "read-only",
          anonymous: {
            httpStatus: 401,
            errorCode: "42501",
            denied: true,
          },
          authenticated: {
            httpStatus: 403,
            errorCode: "42501",
            denied: true,
          },
        },
      },
      generatedAt: "2026-07-24T00:00:00.000Z",
    });

    expect(artifact.result.status).toBe("fail");
    expect(artifact.result.failureCodes).toContain(
      "APPLICATION_STRUCTURE_BASELINE_MISMATCH"
    );
  });
});
