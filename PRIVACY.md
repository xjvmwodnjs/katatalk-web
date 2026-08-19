# KataTalk Privacy Notice (Draft)

**Status:** This draft describes the repository's implemented data flows. It is not a final privacy notice or legal advice.

## Data We Process

- Clerk account identifiers and profile fields supplied by the identity provider, including email and display name.
- Uploaded SGF content, filename, language, integrity metadata, analysis job status, errors, timestamps, and analysis results.
- Credit balances and ledger records, including payment-provider event, order, and checkout references needed for idempotency and audit.
- Limited technical data required to operate authenticated requests and background analysis jobs.
- For paid-analysis retry safety, the browser keeps at most eight pending
  request records for up to 24 hours. Each record contains only the selected
  language, a one-way account-scope digest, an SGF SHA-256 digest, an opaque
  request ID, and a timestamp. It does not contain SGF text, filename, raw
  account identity, name, or email. The request is not submitted when this
  storage cannot be persisted.
- The obsolete pre-launch browser cache that contained an authentication user
  object has been removed. Current clients also delete that legacy local
  storage entry on startup.

## Purpose and Providers

The service uses data to authenticate users, process Go-game analysis, return results, account for credits and refunds, prevent duplicate payment grants, and secure or troubleshoot the service. The current architecture uses Clerk for authentication, Supabase for application records and server-side RPCs, Lemon Squeezy for one-time credit-pack checkout and payment events, and a separate analysis Worker.

The repository contains an experimental LLM provider adapter, but it is not
connected to the Worker, database, API, or user interface and should remain
disabled. The current product does not send uploaded SGF to an LLM provider.
Before natural-language commentary is enabled, this notice must identify the
provider and subprocessors, fields sent, processing regions, retention and
training-use policy, international transfers, legal basis, user controls, and
deletion propagation. The target design sends only allowlisted derived evidence,
not raw SGF, player names, filenames, account data, or payment data.

## Deletion and Retention

The authenticated owner of a completed or failed analysis can delete its SGF
source, filename, direct SGF digest, and result from the product. The job
status, timestamps, credit cost, credit-ledger linkage, opaque request ID, and
one-way request fingerprint remain for duplicate-charge prevention, ledger
audit, and refund investigation. That fingerprint is derived from the SGF
digest and selected analysis language and can therefore still be linkable to a
candidate SGF. Its finite legal retention period must be approved before paid
launch.

Automatic analysis-payload expiration is opt-in for newly created jobs only.
If the production setting is absent, retention is indefinite. Cleanup requires
an explicit, currently manual workflow and existing analysis data is not
automatically backfilled. A public service requires finite per-data-class
periods, a monitored schedule, account deletion/pseudonymization, and verified
propagation to backups and future commentary/provider artifacts.

**[LEGAL REVIEW REQUIRED: define retention periods, legal basis, backups, deletion propagation, payment-record retention, controller identity, contact method, regional rights, and request timelines before publication.]**

## Security and Changes

Clients access application data through the Express API. Supabase service-role credentials remain server-side. Payment credit grants are processed from verified webhook events rather than a checkout redirect. These controls are not a security certification or absolute guarantee.

Material changes must be versioned and communicated before taking effect. **[LEGAL REVIEW REQUIRED: approve notice and change-notification process.]**
