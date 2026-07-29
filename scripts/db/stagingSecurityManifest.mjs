export const STAGING_EVIDENCE_SCHEMA_VERSION =
  "katatalk-staging-db-evidence/v1";
export const EXPECTED_CONTRACT_SCHEMA_VERSION =
  "katatalk-staging-db-expected-contract/v1";

export const EXPECTED_RUNTIME_ROLES = ["anon", "authenticated", "service_role"];

export const EXPECTED_SECURITY_DEFINER_FUNCTIONS = [
  {
    signature: "public.ensure_profile_with_signup_bonus(text, text, text)",
    volatility: "volatile",
  },
  {
    signature: "public.spend_credit_for_analysis(text, text, integer)",
    volatility: "volatile",
  },
  {
    signature: "public.refund_credit_for_analysis(text, text, integer)",
    volatility: "volatile",
  },
  {
    signature:
      "public.add_credits_from_stripe(text, integer, text, text, text)",
    volatility: "volatile",
  },
  {
    signature:
      "public.add_credits_from_payment(text, integer, text, text, text, text, text, text)",
    volatility: "volatile",
  },
  {
    signature: "public.claim_next_analysis_job(text, integer)",
    volatility: "volatile",
  },
  {
    signature: "public.report_analysis_worker(uuid, text, text, boolean)",
    volatility: "volatile",
  },
  {
    signature: "public.get_analysis_worker_health(text, integer)",
    volatility: "stable",
  },
  {
    signature: "public.purge_expired_analysis_job_data(integer, boolean)",
    volatility: "volatile",
  },
  {
    signature:
      "public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamp with time zone)",
    volatility: "volatile",
  },
  {
    signature:
      "public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text)",
    volatility: "volatile",
  },
];

export const OBSOLETE_FUNCTION_SIGNATURES = [
  "public.claim_next_analysis_job()",
];

export const EXPECTED_PUBLIC_FUNCTION_SIGNATURES = [
  "public.katatalk_set_updated_at()",
  ...EXPECTED_SECURITY_DEFINER_FUNCTIONS.map(entry => entry.signature),
];

export const ALL_TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

export const EXPECTED_SENSITIVE_TABLES = [
  {
    qualifiedName: "public.profiles",
    serviceRolePrivileges: ["SELECT"],
  },
  {
    qualifiedName: "public.credit_logs",
    serviceRolePrivileges: ["SELECT"],
  },
  {
    qualifiedName: "public.analysis_jobs",
    serviceRolePrivileges: ["INSERT", "SELECT", "UPDATE"],
  },
  {
    qualifiedName: "public.analysis_worker_instances",
    serviceRolePrivileges: ["SELECT"],
  },
  {
    qualifiedName: "public.analysis_job_finalization_failures",
    serviceRolePrivileges: ["INSERT", "SELECT", "UPDATE"],
  },
  {
    qualifiedName: "public.katatalk_schema_migrations",
    serviceRolePrivileges: ["SELECT"],
  },
];

export const SECURITY_CATALOG_CONTRACT = {
  formatVersion: 1,
  runtimeRoles: EXPECTED_RUNTIME_ROLES,
  functions: EXPECTED_SECURITY_DEFINER_FUNCTIONS,
  structuralFunctions: EXPECTED_PUBLIC_FUNCTION_SIGNATURES,
  obsoleteFunctions: OBSOLETE_FUNCTION_SIGNATURES,
  tables: EXPECTED_SENSITIVE_TABLES,
  tablePrivileges: ALL_TABLE_PRIVILEGES,
  schema: {
    qualifiedName: "public",
    runtimeUsage: true,
    runtimeCreate: false,
  },
};
