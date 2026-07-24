import { runSql } from "./postgres.mjs";
import {
  ALL_TABLE_PRIVILEGES,
  EXPECTED_PUBLIC_FUNCTION_SIGNATURES,
  EXPECTED_RUNTIME_ROLES,
  EXPECTED_SECURITY_DEFINER_FUNCTIONS,
  EXPECTED_SENSITIVE_TABLES,
  OBSOLETE_FUNCTION_SIGNATURES,
} from "./stagingSecurityManifest.mjs";

export const CATALOG_MARKER = "__KATATALK_SECURITY_CATALOG_V1__";
export const HISTORY_MARKER = "__KATATALK_MIGRATION_HISTORY_V1__";

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function valuesRows(values, project) {
  return values
    .map((value, index) => `(${index + 1}, ${project(value)})`)
    .join(",\n    ");
}

function normalizedAclSql({ aclExpression, defaultAclKind, ownerExpression }) {
  const roleCase = roleExpression => `CASE
              WHEN ${roleExpression} = 0 THEN 'PUBLIC'
              WHEN ${roleExpression} = ${ownerExpression} THEN 'OWNER'
              WHEN ${roleExpression} = roles.anon_oid THEN 'anon'
              WHEN ${roleExpression} = roles.authenticated_oid THEN 'authenticated'
              WHEN ${roleExpression} = roles.service_role_oid THEN 'service_role'
              ELSE 'OTHER'
            END`;
  return `SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantee', ${roleCase("acl.grantee")},
              'grantor', ${roleCase("acl.grantor")},
              'privilege', acl.privilege_type,
              'grantable', acl.is_grantable
            )
            ORDER BY
              ${roleCase("acl.grantee")} COLLATE "C",
              acl.privilege_type COLLATE "C",
              acl.is_grantable,
              ${roleCase("acl.grantor")} COLLATE "C"
          ),
          '[]'::pg_catalog.jsonb
        )
        FROM pg_catalog.aclexplode(
          COALESCE(
            ${aclExpression},
            pg_catalog.acldefault(${sqlLiteral(defaultAclKind)}, ${ownerExpression})
          )
        ) AS acl`;
}

export function buildStagingCatalogSql() {
  const roles = valuesRows(EXPECTED_RUNTIME_ROLES, role => sqlLiteral(role));
  const functions = valuesRows(
    EXPECTED_SECURITY_DEFINER_FUNCTIONS,
    entry => `${sqlLiteral(entry.signature)}, ${sqlLiteral(entry.volatility)}`
  );
  const tables = valuesRows(
    EXPECTED_SENSITIVE_TABLES,
    entry =>
      `${sqlLiteral(entry.qualifiedName)}, ARRAY[${entry.serviceRolePrivileges
        .map(sqlLiteral)
        .join(", ")}]::pg_catalog.text[]`
  );
  const privileges = ALL_TABLE_PRIVILEGES.map(sqlLiteral).join(", ");
  const expectedFunctionSignatures = EXPECTED_SECURITY_DEFINER_FUNCTIONS.map(
    entry => sqlLiteral(entry.signature)
  ).join(", ");
  const expectedPublicFunctionSignatures =
    EXPECTED_PUBLIC_FUNCTION_SIGNATURES.map(sqlLiteral).join(", ");
  const expectedTableNames = EXPECTED_SENSITIVE_TABLES.map(entry =>
    sqlLiteral(entry.qualifiedName.replace(/^public\./, ""))
  ).join(", ");
  const obsoleteFunctionSignatures =
    OBSOLETE_FUNCTION_SIGNATURES.map(sqlLiteral).join(", ");

  const functionAcl = normalizedAclSql({
    aclExpression: "p.proacl",
    defaultAclKind: "f",
    ownerExpression: "p.proowner",
  });
  const tableAcl = normalizedAclSql({
    aclExpression: "c.relacl",
    defaultAclKind: "r",
    ownerExpression: "c.relowner",
  });
  const schemaAcl = normalizedAclSql({
    aclExpression: "n.nspacl",
    defaultAclKind: "n",
    ownerExpression: "n.nspowner",
  });

  return `\\set ON_ERROR_STOP on
\\set QUIET on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '15s';
SET LOCAL search_path = pg_catalog;
SET LOCAL quote_all_identifiers = off;

SELECT pg_catalog.format('%I.%I', n.nspname, p.proname) AS digest_function
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_depend AS dependency
  ON dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
  AND dependency.objid = p.oid
  AND dependency.deptype = 'e'
JOIN pg_catalog.pg_extension AS extension
  ON extension.oid = dependency.refobjid
WHERE extension.extname = 'pgcrypto'
  AND p.proname = 'digest'
  AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'bytea, text'
ORDER BY p.oid
LIMIT 1
\\gset

\\if :{?digest_function}
\\else
\\echo '__KATATALK_SHA256_PROVIDER_MISSING__'
SELECT 1 / 0;
\\endif

WITH
  expected_roles(role_order, role_name) AS (
    VALUES
    ${roles}
  ),
  roles AS (
    SELECT
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
  ),
  role_catalog AS (
    SELECT
      expected.role_order,
      expected.role_name,
      role.oid IS NOT NULL AS role_exists,
      role.rolbypassrls AS bypass_rls
    FROM expected_roles AS expected
    LEFT JOIN pg_catalog.pg_roles AS role ON role.rolname = expected.role_name
  ),
  expected_functions(function_order, signature, expected_volatility) AS (
    VALUES
    ${functions}
  ),
  application_owner AS (
    SELECT c.relowner AS owner_oid
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = pg_catalog.to_regclass('public.profiles')
  ),
  function_catalog AS (
    SELECT
      expected.function_order,
      expected.signature,
      expected.expected_volatility,
      p.oid IS NOT NULL AS function_exists,
      p.proowner = owner.owner_oid AS owner_matches_application,
      language.lanname AS language,
      pg_catalog.pg_get_function_result(p.oid) AS return_type,
      CASE p.provolatile
        WHEN 'i' THEN 'immutable'
        WHEN 's' THEN 'stable'
        WHEN 'v' THEN 'volatile'
        ELSE NULL
      END AS volatility,
      p.prosecdef AS security_definer,
      p.proconfig AS config,
      CASE WHEN p.oid IS NULL THEN '[]'::pg_catalog.jsonb ELSE (
        ${functionAcl}
      ) END AS direct_acl,
      pg_catalog.jsonb_build_object(
        'anon',
          CASE WHEN roles.anon_oid IS NULL OR p.oid IS NULL THEN NULL
          ELSE pg_catalog.has_function_privilege(roles.anon_oid, p.oid, 'EXECUTE') END,
        'authenticated',
          CASE WHEN roles.authenticated_oid IS NULL OR p.oid IS NULL THEN NULL
          ELSE pg_catalog.has_function_privilege(roles.authenticated_oid, p.oid, 'EXECUTE') END,
        'serviceRole',
          CASE WHEN roles.service_role_oid IS NULL OR p.oid IS NULL THEN NULL
          ELSE pg_catalog.has_function_privilege(roles.service_role_oid, p.oid, 'EXECUTE') END
      ) AS effective_execute
    FROM expected_functions AS expected
    CROSS JOIN roles
    LEFT JOIN LATERAL (
      SELECT resolved.oid
      FROM pg_catalog.to_regprocedure(expected.signature) AS resolved(oid)
    ) AS lookup ON TRUE
    LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = lookup.oid
    LEFT JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    LEFT JOIN application_owner AS owner ON TRUE
  ),
  expected_tables(table_order, qualified_name, expected_service_privileges) AS (
    VALUES
    ${tables}
  ),
  table_catalog AS (
    SELECT
      expected.table_order,
      expected.qualified_name,
      expected.expected_service_privileges,
      c.oid IS NOT NULL AS table_exists,
      c.relowner = owner.owner_oid AS owner_matches_application,
      c.relkind::pg_catalog.text AS relation_kind,
      c.relrowsecurity AS row_security,
      c.relforcerowsecurity AS force_row_security,
      CASE WHEN c.oid IS NULL THEN '[]'::pg_catalog.jsonb ELSE (
        ${tableAcl}
      ) END AS direct_acl,
      (
        SELECT pg_catalog.jsonb_object_agg(
          role_name,
          role_privileges
          ORDER BY role_order
        )
        FROM (
          SELECT
            role_catalog.role_order,
            role_catalog.role_name,
            pg_catalog.jsonb_object_agg(
              privilege_name,
              CASE
                WHEN NOT role_catalog.role_exists OR c.oid IS NULL THEN NULL
                ELSE pg_catalog.has_table_privilege(
                  role.oid,
                  c.oid,
                  privilege_name
                )
              END
              ORDER BY privilege_order
            ) AS role_privileges
          FROM role_catalog
          LEFT JOIN pg_catalog.pg_roles AS role
            ON role.rolname = role_catalog.role_name
          CROSS JOIN unnest(
            ARRAY[${privileges}]::pg_catalog.text[]
          ) WITH ORDINALITY AS privilege(privilege_name, privilege_order)
          GROUP BY
            role_catalog.role_order,
            role_catalog.role_name,
            role_catalog.role_exists
        ) AS effective
      ) AS effective_privileges
    FROM expected_tables AS expected
    CROSS JOIN roles
    LEFT JOIN pg_catalog.pg_class AS c
      ON c.oid = pg_catalog.to_regclass(expected.qualified_name)
    LEFT JOIN application_owner AS owner ON TRUE
  ),
  schema_catalog AS (
    SELECT
      n.oid IS NOT NULL AS schema_exists,
      CASE WHEN n.oid IS NULL THEN '[]'::pg_catalog.jsonb ELSE (
        ${schemaAcl}
      ) END AS direct_acl,
      (
        SELECT pg_catalog.jsonb_object_agg(
          role_catalog.role_name,
          pg_catalog.jsonb_build_object(
            'usage',
              CASE WHEN NOT role_catalog.role_exists OR n.oid IS NULL THEN NULL
              ELSE pg_catalog.has_schema_privilege(role.oid, n.oid, 'USAGE') END,
            'create',
              CASE WHEN NOT role_catalog.role_exists OR n.oid IS NULL THEN NULL
              ELSE pg_catalog.has_schema_privilege(role.oid, n.oid, 'CREATE') END
          )
          ORDER BY role_catalog.role_order
        )
        FROM role_catalog
        LEFT JOIN pg_catalog.pg_roles AS role
          ON role.rolname = role_catalog.role_name
      ) AS effective_privileges
    FROM (SELECT oid, nspacl, nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'public') AS n
    CROSS JOIN roles
  ),
  structure_functions AS (
    SELECT
      expected.signature,
      p.oid IS NOT NULL AS function_exists,
      CASE WHEN p.oid IS NULL THEN NULL ELSE
        pg_catalog.encode(
          :digest_function(
            pg_catalog.convert_to(
              pg_catalog.pg_get_functiondef(p.oid),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      END AS definition_sha256
    FROM unnest(
      ARRAY[${expectedPublicFunctionSignatures}]::pg_catalog.text[]
    ) WITH ORDINALITY AS expected(signature, function_order)
    LEFT JOIN pg_catalog.pg_proc AS p
      ON p.oid = pg_catalog.to_regprocedure(expected.signature)
  ),
  structure_relations AS (
    SELECT
      expected.qualified_name,
      relation.oid IS NOT NULL AS relation_exists,
      relation.relkind::pg_catalog.text AS relation_kind,
      relation.relpersistence::pg_catalog.text AS persistence,
      relation.relreplident::pg_catalog.text AS replica_identity,
      access_method.amname AS access_method,
      CASE
      WHEN relation.oid IS NULL OR relation.reltablespace = 0 THEN NULL
      ELSE pg_catalog.format('%I', tablespace.spcname)
      END AS tablespace_name,
      CASE WHEN relation.oid IS NULL THEN NULL ELSE
        pg_catalog.encode(
          :digest_function(
            pg_catalog.convert_to(
              COALESCE(
                (
                  SELECT pg_catalog.string_agg(
                    option_value,
                    ',' ORDER BY option_value COLLATE "C"
                  )
                  FROM unnest(relation.reloptions)
                    AS relation_option(option_value)
                ),
                ''
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      END AS options_sha256,
      CASE WHEN relation.relpartbound IS NULL THEN NULL ELSE
        pg_catalog.encode(
          :digest_function(
            pg_catalog.convert_to(
              pg_catalog.pg_get_expr(
                relation.relpartbound,
                relation.oid
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      END AS partition_bound_sha256
    FROM expected_tables AS expected
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.oid =
        pg_catalog.to_regclass(expected.qualified_name)
    LEFT JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = relation.relam
    LEFT JOIN pg_catalog.pg_tablespace AS tablespace
      ON tablespace.oid = relation.reltablespace
  ),
  structure_columns AS (
    SELECT
      expected.qualified_name,
      attribute.attnum AS column_order,
      attribute.attname AS column_name,
      pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) AS data_type,
      attribute.attnotnull AS not_null,
      attribute.attidentity::pg_catalog.text AS identity_kind,
      attribute.attgenerated::pg_catalog.text AS generated_kind,
      CASE WHEN attribute.attcollation = 0 THEN NULL
      ELSE pg_catalog.format(
        '%I.%I',
        collation_namespace.nspname,
        collation.collname
      )
      END AS collation_name,
      CASE WHEN default_value.oid IS NULL THEN NULL ELSE
        pg_catalog.encode(
          :digest_function(
            pg_catalog.convert_to(
              pg_catalog.pg_get_expr(
                default_value.adbin,
                default_value.adrelid
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      END AS default_sha256
    FROM expected_tables AS expected
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(expected.qualified_name)
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = relation.oid
      AND default_value.adnum = attribute.attnum
    LEFT JOIN pg_catalog.pg_collation AS collation
      ON collation.oid = attribute.attcollation
    LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
      ON collation_namespace.oid = collation.collnamespace
  ),
  structure_constraints AS (
    SELECT
      expected.qualified_name,
      constraint_entry.conname AS constraint_name,
      constraint_entry.contype::pg_catalog.text AS constraint_type,
      constraint_entry.condeferrable AS deferrable,
      constraint_entry.condeferred AS initially_deferred,
      constraint_entry.convalidated AS validated,
      pg_catalog.encode(
        :digest_function(
          pg_catalog.convert_to(
            pg_catalog.pg_get_constraintdef(
              constraint_entry.oid,
              false
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) AS definition_sha256
    FROM expected_tables AS expected
    JOIN pg_catalog.pg_constraint AS constraint_entry
      ON constraint_entry.conrelid =
        pg_catalog.to_regclass(expected.qualified_name)
  ),
  structure_indexes AS (
    SELECT
      expected.qualified_name,
      index_relation.relname AS index_name,
      index_entry.indisunique AS unique_index,
      index_entry.indisprimary AS primary_index,
      index_entry.indisvalid AS valid,
      index_entry.indisready AS ready,
      access_method.amname AS access_method,
      pg_catalog.encode(
        :digest_function(
          pg_catalog.convert_to(
            pg_catalog.pg_get_indexdef(index_entry.indexrelid),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) AS definition_sha256
    FROM expected_tables AS expected
    JOIN pg_catalog.pg_index AS index_entry
      ON index_entry.indrelid =
        pg_catalog.to_regclass(expected.qualified_name)
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_entry.indexrelid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
  ),
  structure_policies AS (
    SELECT
      expected.qualified_name,
      policy.polname AS policy_name,
      policy.polpermissive AS permissive,
      policy.polcmd::pg_catalog.text AS command,
      pg_catalog.encode(
        :digest_function(
          pg_catalog.convert_to(
            COALESCE(
              (
                SELECT pg_catalog.string_agg(
                  CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid)
                  END,
                  ',' ORDER BY
                    CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid)
                    END COLLATE "C"
                )
                FROM unnest(policy.polroles) AS policy_role(role_oid)
              ),
              ''
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) AS roles_sha256,
      CASE WHEN policy.polqual IS NULL THEN NULL ELSE
        pg_catalog.encode(
          :digest_function(
            pg_catalog.convert_to(
              pg_catalog.pg_get_expr(
                policy.polqual,
                policy.polrelid
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      END AS using_sha256,
      CASE WHEN policy.polwithcheck IS NULL THEN NULL ELSE
        pg_catalog.encode(
          :digest_function(
            pg_catalog.convert_to(
              pg_catalog.pg_get_expr(
                policy.polwithcheck,
                policy.polrelid
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      END AS check_sha256
    FROM expected_tables AS expected
    JOIN pg_catalog.pg_policy AS policy
      ON policy.polrelid =
        pg_catalog.to_regclass(expected.qualified_name)
  ),
  structure_triggers AS (
    SELECT
      expected.qualified_name,
      trigger_entry.tgname AS trigger_name,
      trigger_entry.tgenabled::pg_catalog.text AS enabled,
      pg_catalog.encode(
        :digest_function(
          pg_catalog.convert_to(
            pg_catalog.pg_get_triggerdef(trigger_entry.oid, false),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) AS definition_sha256
    FROM expected_tables AS expected
    JOIN pg_catalog.pg_trigger AS trigger_entry
      ON trigger_entry.tgrelid =
        pg_catalog.to_regclass(expected.qualified_name)
      AND NOT trigger_entry.tgisinternal
  )
SELECT ${sqlLiteral(CATALOG_MARKER)} || pg_catalog.jsonb_build_object(
  'formatVersion', 1,
  'transaction', pg_catalog.jsonb_build_object(
    'readOnly', pg_catalog.current_setting('transaction_read_only') = 'on',
    'isolation', pg_catalog.current_setting('transaction_isolation'),
    'serverMajor',
      pg_catalog.current_setting('server_version_num')::pg_catalog.integer
        / 10000,
    'timeoutsApplied',
      pg_catalog.current_setting('statement_timeout') = '10s'
      AND pg_catalog.current_setting('lock_timeout') = '2s'
      AND pg_catalog.current_setting('idle_in_transaction_session_timeout') = '15s',
    'deparserSettingsApplied',
      pg_catalog.current_setting('quote_all_identifiers') = 'off'
  ),
  'applicationObjectCount', (
    SELECT pg_catalog.count(*)
    FROM (
      SELECT relation.oid
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      UNION ALL
      SELECT function_entry.oid
      FROM pg_catalog.pg_proc AS function_entry
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function_entry.pronamespace
      WHERE namespace.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid =
              'pg_catalog.pg_proc'::pg_catalog.regclass
            AND dependency.objid = function_entry.oid
            AND dependency.deptype = 'e'
        )
      UNION ALL
      SELECT type_entry.oid
      FROM pg_catalog.pg_type AS type_entry
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = type_entry.typnamespace
      WHERE namespace.nspname = 'public'
        AND type_entry.typtype IN ('b', 'c', 'd', 'e', 'm', 'r')
        AND NOT (
          type_entry.typelem <> 0
          AND type_entry.typarray = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation
          WHERE relation.reltype = type_entry.oid
            AND relation.relkind <> 'c'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid =
              'pg_catalog.pg_type'::pg_catalog.regclass
            AND dependency.objid = type_entry.oid
            AND dependency.deptype = 'e'
        )
    ) AS application_object
  ),
  'historyPresent',
    pg_catalog.to_regclass('public.katatalk_schema_migrations') IS NOT NULL,
  'roles', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'order', role_order,
        'name', role_name,
        'exists', role_exists,
        'bypassRls', bypass_rls
      )
      ORDER BY role_order
    )
    FROM role_catalog
  ),
  'schema', (
    SELECT pg_catalog.to_jsonb(schema_catalog) FROM schema_catalog
  ),
  'functions', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'order', function_order,
        'signature', signature,
        'exists', function_exists,
        'ownerMatchesApplication', owner_matches_application,
        'language', language,
        'returnType', return_type,
        'volatility', volatility,
        'securityDefiner', security_definer,
        'config', config,
        'directAcl', direct_acl,
        'effectiveExecute', effective_execute
      )
      ORDER BY function_order
    )
    FROM function_catalog
  ),
  'unexpectedSecurityDefiners', (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.format(
          '%I.%I(%s)',
          n.nspname,
          p.proname,
          pg_catalog.oidvectortypes(p.proargtypes)
        )
        ORDER BY
          pg_catalog.format(
            '%I.%I(%s)',
            n.nspname,
            p.proname,
            pg_catalog.oidvectortypes(p.proargtypes)
          ) COLLATE "C"
      ),
      '[]'::pg_catalog.jsonb
    )
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND pg_catalog.format(
        '%I.%I(%s)',
        n.nspname,
        p.proname,
        pg_catalog.oidvectortypes(p.proargtypes)
      ) <> ALL (ARRAY[${expectedFunctionSignatures}]::pg_catalog.text[])
  ),
  'obsoleteFunctions', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'signature', signature,
        'absent', pg_catalog.to_regprocedure(signature) IS NULL
      )
      ORDER BY signature COLLATE "C"
    )
    FROM unnest(
      ARRAY[${obsoleteFunctionSignatures}]::pg_catalog.text[]
    ) AS obsolete(signature)
  ),
  'tables', (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'order', table_order,
        'qualifiedName', qualified_name,
        'expectedServicePrivileges', expected_service_privileges,
        'exists', table_exists,
        'ownerMatchesApplication', owner_matches_application,
        'relationKind', relation_kind,
        'rowSecurity', row_security,
        'forceRowSecurity', force_row_security,
        'directAcl', direct_acl,
        'effectivePrivileges', effective_privileges
      )
      ORDER BY table_order
    )
    FROM table_catalog
  ),
  'structure', pg_catalog.jsonb_build_object(
    'functions', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'signature', signature,
            'exists', function_exists,
            'definitionSha256', definition_sha256
          )
          ORDER BY signature COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM structure_functions
    ),
    'relations', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'qualifiedName', qualified_name,
            'exists', relation_exists,
            'kind', relation_kind,
            'persistence', persistence,
            'replicaIdentity', replica_identity,
            'accessMethod', access_method,
            'tablespace', tablespace_name,
            'optionsSha256', options_sha256,
            'partitionBoundSha256', partition_bound_sha256
          )
          ORDER BY qualified_name COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM structure_relations
    ),
    'columns', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'qualifiedName', qualified_name,
            'order', column_order,
            'name', column_name,
            'dataType', data_type,
            'notNull', not_null,
            'identityKind', identity_kind,
            'generatedKind', generated_kind,
            'collation', collation_name,
            'defaultSha256', default_sha256
          )
          ORDER BY
            qualified_name COLLATE "C",
            column_order
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM structure_columns
    ),
    'constraints', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'qualifiedName', qualified_name,
            'name', constraint_name,
            'type', constraint_type,
            'deferrable', deferrable,
            'initiallyDeferred', initially_deferred,
            'validated', validated,
            'definitionSha256', definition_sha256
          )
          ORDER BY
            qualified_name COLLATE "C",
            constraint_name COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM structure_constraints
    ),
    'indexes', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'qualifiedName', qualified_name,
            'name', index_name,
            'unique', unique_index,
            'primary', primary_index,
            'valid', valid,
            'ready', ready,
            'accessMethod', access_method,
            'definitionSha256', definition_sha256
          )
          ORDER BY
            qualified_name COLLATE "C",
            index_name COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM structure_indexes
    ),
    'policies', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'qualifiedName', qualified_name,
            'name', policy_name,
            'permissive', permissive,
            'command', command,
            'rolesSha256', roles_sha256,
            'usingSha256', using_sha256,
            'checkSha256', check_sha256
          )
          ORDER BY
            qualified_name COLLATE "C",
            policy_name COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM structure_policies
    ),
    'triggers', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'qualifiedName', qualified_name,
            'name', trigger_name,
            'enabled', enabled,
            'definitionSha256', definition_sha256
          )
          ORDER BY
            qualified_name COLLATE "C",
            trigger_name COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM structure_triggers
    ),
    'unexpectedFunctions', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.format(
            '%I.%I(%s)',
            namespace.nspname,
            function_entry.proname,
            pg_catalog.oidvectortypes(function_entry.proargtypes)
          )
          ORDER BY
            pg_catalog.format(
              '%I.%I(%s)',
              namespace.nspname,
              function_entry.proname,
              pg_catalog.oidvectortypes(function_entry.proargtypes)
            ) COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM pg_catalog.pg_proc AS function_entry
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function_entry.pronamespace
      WHERE namespace.nspname = 'public'
        AND pg_catalog.format(
          '%I.%I(%s)',
          namespace.nspname,
          function_entry.proname,
          pg_catalog.oidvectortypes(function_entry.proargtypes)
        ) <> ALL (
          ARRAY[${expectedPublicFunctionSignatures}]::pg_catalog.text[]
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid =
              'pg_catalog.pg_proc'::pg_catalog.regclass
            AND dependency.objid = function_entry.oid
            AND dependency.deptype = 'e'
        )
    ),
    'unexpectedTypes', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.format(
            '%I.%I',
            namespace.nspname,
            type_entry.typname
          )
          ORDER BY
            pg_catalog.format(
              '%I.%I',
              namespace.nspname,
              type_entry.typname
            ) COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM pg_catalog.pg_type AS type_entry
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = type_entry.typnamespace
      WHERE namespace.nspname = 'public'
        AND type_entry.typtype IN ('b', 'c', 'd', 'e', 'm', 'r')
        AND NOT (
          type_entry.typelem <> 0
          AND type_entry.typarray = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation
          WHERE relation.reltype = type_entry.oid
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid =
              'pg_catalog.pg_type'::pg_catalog.regclass
            AND dependency.objid = type_entry.oid
            AND dependency.deptype = 'e'
        )
    ),
    'unexpectedRelations', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.format(
            '%I.%I',
            namespace.nspname,
            relation.relname
          )
          ORDER BY
            pg_catalog.format(
              '%I.%I',
              namespace.nspname,
              relation.relname
            ) COLLATE "C"
        ),
        '[]'::pg_catalog.jsonb
      )
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND relation.relname <> ALL (
          ARRAY[${expectedTableNames}]::pg_catalog.text[]
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid =
              'pg_catalog.pg_class'::pg_catalog.regclass
            AND dependency.objid = relation.oid
            AND dependency.deptype = 'e'
        )
    )
  )
)::pg_catalog.text;

SELECT (
  pg_catalog.to_regclass('public.katatalk_schema_migrations') IS NOT NULL
) AS history_present \\gset

\\if :history_present
SELECT ${sqlLiteral(HISTORY_MARKER)} || COALESCE(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'version', version,
      'filename', filename,
      'checksumSha256', checksum_sha256
    )
    ORDER BY version
  ),
  '[]'::pg_catalog.jsonb
)::pg_catalog.text
FROM public.katatalk_schema_migrations;
\\else
SELECT ${sqlLiteral(HISTORY_MARKER)} || '[]';
\\endif

ROLLBACK;
`;
}

function parseMarkedJson(stdout, marker) {
  const matches = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith(marker));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${marker} record`);
  }
  try {
    return JSON.parse(matches[0].slice(marker.length));
  } catch {
    throw new Error(`Malformed ${marker} record`);
  }
}

export function parseStagingCatalogOutput(stdout) {
  return {
    catalog: parseMarkedJson(stdout, CATALOG_MARKER),
    history: parseMarkedJson(stdout, HISTORY_MARKER),
  };
}

export function collectStagingCatalog({ database } = {}) {
  const result = runSql({
    database,
    sql: buildStagingCatalogSql(),
    label: "Read-only staging security catalog collection",
    capture: true,
    tuplesOnly: true,
  });
  return parseStagingCatalogOutput(result.stdout);
}
