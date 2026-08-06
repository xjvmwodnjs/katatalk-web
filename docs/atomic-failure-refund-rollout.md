# Atomic analysis failure/refund rollout

This runbook deploys `012_atomic_failure_refund.sql`, `013_harden_security_definer_functions.sql`, and `014_reconcile_analysis_job_finalization.sql` without allowing an old
Worker to create a terminal failed job and a separate, missing refund.

## Safety rules

- Treat numbered migrations as immutable and apply them strictly in numeric order: `001` → `002` → … → `014`. If `012` or `013` is already applied, ship corrections as a later migration; never edit or reorder history.
- Stop and drain every old analysis Worker before applying the migration.
- Never repair a wallet with a direct `profiles.credits` update. Reconciliation
  must preserve an append-only ledger entry and its idempotency key.
- Do not mark a quarantine row resolved manually. The atomic finalizer records
  `resolved_at` only after the same leased failure succeeds.

## 1. Preflight audit

Run these queries against a read-only snapshot first, then against the target
database during the maintenance window. Every query must return zero rows.

```sql
-- More than one usage or refund entry for the same job.
SELECT analysis_job_id, type, count(*)
FROM public.credit_logs
WHERE analysis_job_id IS NOT NULL
  AND type IN ('usage', 'refund')
GROUP BY analysis_job_id, type
HAVING count(*) > 1;

-- Paid failed jobs without an exact matching refund.
SELECT j.id, j.user_id, j.credit_cost, j.credit_log_id
FROM public.analysis_jobs AS j
LEFT JOIN public.credit_logs AS r
  ON r.analysis_job_id = j.id
 AND r.type = 'refund'
 AND r.user_id = j.user_id
 AND r.amount = j.credit_cost
 AND r.idempotency_key = 'refund:' || j.id
WHERE j.status = 'failed'
  AND j.credit_cost > 0
  AND r.id IS NULL;

-- Refunds attached to non-failed jobs.
SELECT j.id, j.status, r.id AS refund_log_id
FROM public.analysis_jobs AS j
JOIN public.credit_logs AS r
  ON r.analysis_job_id = j.id
 AND r.type = 'refund'
WHERE j.status <> 'failed';

-- Job debit identity, owner, and amount mismatch.
SELECT j.id, j.user_id, j.credit_cost, u.id AS usage_log_id
FROM public.analysis_jobs AS j
LEFT JOIN public.credit_logs AS u ON u.id = j.credit_log_id
WHERE j.credit_cost > 0
  AND (
    u.id IS NULL
    OR u.type <> 'usage'
    OR u.user_id <> j.user_id
    OR u.analysis_job_id IS DISTINCT FROM j.id
    OR u.amount <> -j.credit_cost
  );
```

For a valid legacy `failed` job missing only its refund, use the existing
idempotent refund RPC in the maintenance window, then rerun the audit. If the
usage owner, job ID, amount, or cardinality is wrong, stop the rollout and use a
reviewed forward-only reconciliation migration.

## 2. Deployment order

1. Record a database backup, migration history, and the current Web/Worker image
   digests.
2. Stop old Workers and wait until no Worker heartbeat is active. Do not start a
   new claim while the schema changes.
3. Run the preflight audit and reconcile only verified legacy rows.
4. Apply migrations `001` → `014` in one transaction and retain the output.
5. Verify the 12 SECURITY DEFINER functions: the original 11 hardened by `013`, plus `014` reconciliation with the same owner, `search_path=pg_catalog`, and function ACL. Confirm
   `PUBLIC`, `anon`, and `authenticated` cannot execute either Worker RPC.
6. Deploy the API with `ANALYSIS_WORKER_MODE=external` and atomic enqueue
   enabled. Production startup rejects unsafe values.
7. Start the new Worker. Its startup preflight must confirm the atomic failure
   RPC contract before it claims a job.
8. Run the failure smoke cases and the post-deploy audit before reopening paid
   traffic.

## 3. Required database smoke cases

- Paid leased job failure creates exactly one refund row, restores the exact
  cost, and commits `status='failed'` in the same transaction.
- Same-lease replay after a simulated response loss changes neither balance nor
  refund row count.
- A stale/different lease and a completed job change nothing.
- Concurrent completion and failure leave exactly one terminal outcome.
- Forced errors after profile update, ledger insert, and job update roll back the
  entire transaction.
- `anon` and `authenticated` HTTP RPC calls are rejected.
- Release evidence must show fresh `001 -> 014` and upgrade `011 -> 012 -> 013 -> 014` both pass, including schema/ACL equivalence.

## 4. Quarantine monitoring

The API exposes a separate operations-only status endpoint:

```text
GET /ops/analysis-finalization-quarantine
X-Ops-Status-Token: <OPS_STATUS_TOKEN>
```

The endpoint uses the service role to count only unresolved quarantine rows and
select only the oldest `first_failed_at` value. It never selects or returns job,
user, Worker, failure-code, ledger, or database-error details. Every response is
`Cache-Control: no-store`.

- `200 {"ok":true,"status":"clear","unresolvedCount":0,"oldestFirstFailedAt":null}`
  means no unresolved row was observed.
- `503 {"ok":false,"status":"attention_required",...}` means at least one
  unresolved row exists and must page the billing/operations owner.
- `503 {"ok":false,"status":"unknown"}` means the database observation failed
  closed and must page the service owner without exposing the backend error.
- A missing, unset, or incorrect operations token returns `404` without reading
  the database.

Do not attach this endpoint to Web liveness or readiness. A quarantine alert
requires ledger investigation; restarting otherwise healthy Web instances does
not repair it. Production acceptance requires migrations `012` and `013`, the
Supabase service-role configuration, `OPS_STATUS_TOKEN`, and a monitor that
alerts on every non-200 response.

## 5. Quarantine recovery

```sql
SELECT f.*, j.status, j.credit_cost, j.credit_log_id
FROM public.analysis_job_finalization_failures AS f
JOIN public.analysis_jobs AS j ON j.id = f.analysis_job_id
WHERE f.resolved_at IS NULL
ORDER BY f.first_failed_at;
```

For the sole supported defect—an unresolved `LEDGER_INVARIANT` quarantine with a
missing canonical usage link—use the reviewed single-job command. It previews by
default and refuses wallet drift, duplicate/noncanonical ledger rows, lease
mismatch, or any different pre-existing link:

```text
pnpm credits:reconcile-finalization -- --job-id=<job-id>
pnpm credits:reconcile-finalization -- --job-id=<job-id> --apply --confirm=RECONCILE_FINALIZATION:<job-id>
```

The apply path relinks only the exact canonical usage row, calls the stored
lease-fenced finalizer in the same transaction, creates at most one refund, and
marks the quarantine resolved. Do not call the finalizer manually or directly
update `analysis_jobs.credit_log_id`. Any other corruption needs a separately
reviewed forward-only repair.

After recovery, verify one canonical usage, at most one canonical refund, the
expected wallet balance, `status='failed'`, and a non-null `resolved_at`.

## 6. Rollback and evidence

Once a new Worker has started, prefer stopping it and fixing forward. Do not
roll back to a Worker that uses split failure/refund calls. Archive the migration
log, ACL snapshot, concurrent smoke output, quarantine report, and ledger audit
with the release record.
