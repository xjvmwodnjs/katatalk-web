# KataTalk Privacy Notice (Draft)

**Status:** This draft describes the repository's implemented data flows. It is not a final privacy notice or legal advice.

## Data We Process

- Clerk account identifiers and profile fields supplied by the identity provider, including email and display name.
- Uploaded SGF content, filename, language, integrity metadata, analysis job status, errors, timestamps, and analysis results.
- Credit balances and ledger records, including payment-provider event, order, and checkout references needed for idempotency and audit.
- Limited technical data required to operate authenticated requests and background analysis jobs.

## Purpose and Providers

The service uses data to authenticate users, process Go-game analysis, return results, account for credits and refunds, prevent duplicate payment grants, and secure or troubleshoot the service. The current architecture uses Clerk for authentication, Supabase for application records and server-side RPCs, Lemon Squeezy for one-time credit-pack checkout and payment events, and a separate analysis Worker.

## Deletion and Retention

The authenticated owner of a completed or failed analysis can delete its SGF source, filename, integrity metadata, and result from the product. The job status, timestamps, credit cost, and credit-ledger linkage remain for audit and refund investigation.

Automatic analysis-payload expiration is opt-in for newly created jobs only. It requires explicit server configuration and a separately scheduled, service-role cleanup command. Existing analysis data is not automatically backfilled for deletion.

**[LEGAL REVIEW REQUIRED: define retention periods, legal basis, backups, deletion propagation, payment-record retention, controller identity, contact method, regional rights, and request timelines before publication.]**

## Security and Changes

Clients access application data through the Express API. Supabase service-role credentials remain server-side. Payment credit grants are processed from verified webhook events rather than a checkout redirect. These controls are not a security certification or absolute guarantee.

Material changes must be versioned and communicated before taking effect. **[LEGAL REVIEW REQUIRED: approve notice and change-notification process.]**
