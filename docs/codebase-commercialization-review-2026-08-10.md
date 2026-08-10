# KataTalk codebase and commercialization review — 2026-08-10

## Executive conclusion

**Public paid launch: NO-GO.** The repository has a substantial, testable beta
foundation, including owner-scoped analysis, an atomic credit/job path, a
separate KataGo Worker, ledger controls, and CI database contracts. It does not
yet contain the external evidence required to sell the service: a real staging
deployment, Clerk/JWKS login, Supabase migration evidence, payment webhook and
refund rehearsal, real-user SGF corpus, and an operating/alert drill.

This review is code-and-repository evidence only. It does not assert that a
third-party account, production database, payment store, GPU host, or legal
policy is configured.

## Scope and evidence

- Repository: `xjvmwodnjs/katatalk-web`
- Reviewed branch: `agent/finalization-reconciliation`, head `f8a0d3e` before
  this review update; draft PR #4 targets `master`.
- Master baseline: `5c0123b`.
- Existing GitHub Actions evidence: run
  [31093929840](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/31093929840)
  passed type/unit/build/secret scan, PostgreSQL migration/ACL/atomicity,
  Playwright, and production dependency audit.
- Repository inventory at review: 379 source/documentation files; roughly
  5.6k client, 39.2k server, 10.1k shared, 5.5k script, and 1.7k migration SQL
  lines. Counts are context, not quality proof.
- Local environment has no Docker-backed PostgreSQL run. The database gate is
  therefore supported by the recorded GitHub Actions run, not a new local
  container execution.

## Architecture assessment

| Domain                | Code evidence                                                            | Assessment                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client and identity   | `client/src`, `server/_core/context.ts`, Clerk integration               | Browser access is mediated by the Express API and Clerk is fail-closed in production. The identity migration includes read-only polling paths.                                           |
| Credits and payments  | `server/billingRoute.ts`, `server/creditService.ts`, Supabase migrations | The webhook/idempotency/ledger design is appropriately safer than granting on redirects. Live provider verification and refund/chargeback policy remain unproven.                        |
| Analysis queue        | `server/analyzeRoute.ts`, `server/worker/*`, migrations 004–014          | Enqueue, lease, heartbeat, finalization, refund and narrow reconciliation have clear boundaries. Real queue/GPU soak and failure drills are still absent.                                |
| KataGo result product | `shared/*`, worker engines, result view model                            | Signals and UI are explicitly deterministic/provisional; the code avoids presenting unimplemented LLM explanation as verified advice. Full rules/exporter compatibility is not complete. |
| Database safety       | `supabase/migrations`, `scripts/db/ci-gate.mjs`                          | Contract/ACL/atomicity gates are strong repository controls. They cannot establish that a hosted project applied all migrations.                                                         |
| Release engineering   | `.github/workflows`, build provenance verifier                           | The gate set is mature for a beta. There is no deployment manifest or configured staging evidence in this repository.                                                                    |

## Strengths to retain

1. **Server-side authority:** browser clients do not invoke sensitive credit or
   analysis RPCs with service-role credentials.
2. **Atomic accounting direction:** the enqueue/refund/finalization design uses
   database procedures and a ledger rather than trusting UI state.
3. **Explicit Worker lifecycle:** external mode, leases, heartbeats, bounded
   concurrency, persistent-session guards, and health reporting are all
   represented in code and tests.
4. **Safe claims:** mock, legacy, provisional, and unimplemented explanation
   paths are differentiated instead of being marketed as engine-verified facts.
5. **Auditable release gates:** source provenance, secret scan, dependency
   audit, browser tests, and PostgreSQL contract checks are wired into CI.

## Launch blockers and risks

| Priority | Finding                                              | Why it matters                                                                                                                                                                                                                                       | Required evidence / remediation                                                                                                                       |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | No real staging E2E evidence                         | CI cannot prove Clerk login, Supabase grants/RPCs, Lemon webhook delivery, or deployed Worker ownership.                                                                                                                                             | Configure least-privilege staging and record the smoke report described in `docs/master-staging-smoke-v1.md`.                                         |
| P0       | Payment reversals and legal terms are incomplete     | Selling credits without approved refund, chargeback, support, retention, and jurisdiction rules creates product and compliance risk.                                                                                                                 | Decide policy, integrate provider event handling where needed, approve `PRIVACY.md`, `TERMS.md`, and `SECURITY.md`.                                   |
| P1       | Web/Worker secret over-provisioning                  | Earlier Worker startup used the Web environment validator, requiring Clerk/Lemon/JWT/public URL secrets on a GPU Worker.                                                                                                                             | This branch separates the production Worker validator; deploy the Worker with only its Supabase/queue and KataGo variables, then prove it in staging. |
| P1       | In-process rate limiting                             | `server/middleware/apiRateLimit.ts` is per Web instance, so it does not provide one budget after horizontal scale.                                                                                                                                   | Move public endpoint limits to Redis/Upstash or an edge/WAF store; test shared-key behavior and observe 429s.                                         |
| P1       | Shared rate-limit and edge byte cap are still absent | Generic API parsers are now scoped to `/api` (1 MB JSON, 32 KB forms), raw payment webhooks remain first, and baseline headers are set. Per-instance rate limits and reverse-proxy/WAF byte limits still do not protect horizontally scaled traffic. | Add a shared limiter and ingress byte budget; test multi-instance keys and alert on 429/413.                                                          |
| P1       | Queue and recovery only contract-tested              | Lease/finalization logic is sophisticated but has no demonstrated restart, stale reclaim, webhook, and KataGo fault drill against hosted Supabase.                                                                                                   | Run a 30–60 minute staging soak with deliberate kill/restart, timeout, duplicate webhook, and reconciliation checks.                                  |
| P2       | SGF compatibility is intentionally partial           | Playback/parser contracts do not yet cover full Go legality, every ruleset, compressed setup, all exporters, or legacy charset handling.                                                                                                             | Build a licensed corpus plus real-exporter matrix; keep product wording conservative until then.                                                      |
| P2       | Artifact/data lifecycle remains unsettled            | SGF/result data is stored with opt-in deletion/retention, but storage, TTL, backup propagation, and subject-rights policy lack final evidence.                                                                                                       | Define data classes, retention/deletion SLOs, and object-storage migration plan; complete legal review.                                               |

## Completed next implementation: Worker least-privilege environment contract

The current branch now introduces `validateProductionAnalysisWorkerEnv()` in
`server/_core/env.ts` and uses it from both Worker startup and preflight. A
production Worker requires only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ANALYSIS_WORKER_MODE=external`, and the existing atomic-enqueue fail-closed
guard, plus its KataGo settings checked by Worker preflight. It no longer needs
Clerk, Lemon Squeezy, `JWT_SECRET`, or `APP_BASE_URL` merely to start.

This reduces secret blast radius; it does **not** reduce Supabase service-role
power. Use a separate Worker secret set, rotate independently, and do not add
Web-only values to its deployment.

## Recommended sequence

1. **Merge only after CI passes**, then deploy a staging Web and Worker with
   distinct secret sets. Apply migrations 001–014 in the hosted project and
   capture catalog/ACL evidence.
2. Complete the staging smoke: Clerk session/JWKS, upload, one KataGo job,
   owner result, worker health, Lemon webhook idempotency, ledger/debit/refund,
   failure/reclaim/reconciliation, and delete/retention path.
3. Add distributed rate limiting plus conservative HTTP body/header policy.
4. Run the real SGF corpus/exporter and GPU capacity/recovery experiments.
5. Finish payment/refund/privacy/security/legal approval, alert routing, and
   on-call ownership before converting the launch decision from NO-GO.

## Document changes made with this review

- `ARCHITECTURE.md` was rewritten to describe the present Web/Worker/Supabase
  boundary rather than legacy platform assumptions.
- `README.md` and `SECURITY.md` link the current decision and Worker-secret
  contract. `docs/env-guide.md`, `review.md`, and `docs/TODO.md` remain useful
  historical/operational detail and should be read alongside this dated review.

Historical documents remain historical evidence; their dates are not silently
rewritten into claims about live deployment.
