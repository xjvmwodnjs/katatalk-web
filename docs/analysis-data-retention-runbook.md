# Analysis Data Retention Runbook

## Purpose

This runbook expires only analysis payload fields for completed or failed jobs
whose `data_retention_until` timestamp has passed. It does not delete credit
ledger records, payment references, job status, or audit timestamps.

The cleanup is intentionally manual. Do not add a schedule until the privacy
notice, retention period, backup behavior, incident procedure, and production
monitoring have been approved.

## Preconditions

1. Apply Supabase migrations `009_analysis_job_data_purge.sql` and
   `010_analysis_job_retention.sql` to the target project.
2. Configure the GitHub `production` environment with required reviewers and
   deployment-branch restrictions.
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub `production`
   environment secrets. The service role must never be exposed to clients or
   copied into workflow output.
4. Confirm `ANALYSIS_DATA_RETENTION_DAYS` is an approved value from 1 through
   3650 for newly queued jobs. An empty value disables automatic expiration.
5. Confirm the deletion policy and customer-facing notice have legal approval.

## Dry Run

1. Open the `Analysis Data Retention` workflow in GitHub Actions.
2. Select `apply = false` and a bounded batch size, starting with 25.
3. Run the workflow through the protected `production` environment.
4. Review the log summary. It reports only `eligible` and `purged` counts; it
   must not contain SGF content, user identifiers, credentials, or payment data.
5. Investigate any unexpected eligible count before proceeding.

## Apply Cleanup

1. Repeat a successful dry run using the same batch size.
2. Obtain the required production approval for this run.
3. Dispatch the workflow with `apply = true`.
4. Record the workflow URL, timestamp, batch size, eligible count, purged
   count, approver, and any incident reference in the operations log.
5. Run a final dry run. Re-run bounded apply batches only when the result is
   expected and approved.

## Safety Rules

- Never run cleanup against an unverified Supabase project.
- Never increase the batch size to work around an unexpected result.
- Stop and investigate if the apply count differs from the reviewed dry-run
  count beyond normal concurrent job completion.
- The RPC excludes queued and running jobs. Treat any evidence otherwise as a
  production incident and disable further applies.
- This process is not account deletion or legal erasure. Backups, payment
  retention, account pseudonymization, and data-subject requests require their
  own approved procedures.
