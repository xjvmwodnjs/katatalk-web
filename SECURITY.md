# KataTalk Security Policy (Draft)

## Reporting a Vulnerability

Do not publish suspected vulnerabilities, credentials, payment data, or customer SGF content in public issues. Until a dedicated security contact is approved, report through the private support channel defined for the deployment.

**[LEGAL REVIEW REQUIRED: publish a monitored security contact, response targets, safe-harbor language, and disclosure process before launch.]**

## Implemented Controls

- Clerk-backed bearer authentication protects analysis and credit APIs.
- Supabase data access and sensitive RPCs use server-side service-role credentials; browser clients do not directly invoke credit or analysis RPCs.
- Payment credit grants require verified Lemon Squeezy webhook events and use idempotency records.
- External Worker health is separately aggregated and protected by an operations token.
- Analysis payload deletion clears SGF and result data while retaining limited billing audit linkage.
- Baseline HTTP headers set HSTS on production, deny framing, restrict referrers
  and device permissions, disable MIME sniffing, and suppress `X-Powered-By`.
  API JSON and form parsers have bounded request sizes; payment raw-body parsing
  remains ahead of normal parsers.
- Release tooling includes secret scanning and a production dependency-audit
  gate. Review-start run [31367782357](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/31367782357)
  passed all other jobs but failed that gate for `nanoid 5.1.6`; the repository
  now pins `>=5.1.16`; the local production audit reports no known
  vulnerabilities, pending a new remote pass. CI is not a hosted-environment audit.
- Production Web and Worker environment validation are separate: the Worker
  requires only its Supabase/queue and KataGo settings, reducing unnecessary
  exposure of Clerk, payment, JWT, and public-URL secrets.

## Scope and Limitations

This repository has not completed a production penetration test, external security audit, staging payment end-to-end test, or production observability and alert validation. It makes no claim of SOC 2, ISO 27001, PCI DSS, or other security certification.

Natural-language commentary is not connected to the production runtime. The
experimental provider adapter must remain disabled until it receives only a
versioned allowlist evidence bundle, uses real request cancellation, and passes
locale-specific schema, claim, privacy, and adversarial tests. Raw SGF and user
PII must not be sent to an LLM provider.

Known production blockers include a shared all-powerful Supabase service-role
on the Analysis Worker, in-process rate limiting, fixed proxy-hop trust, no
enforced CSP, no durable payment webhook inbox/reversal state machine, no
client-visible analyze idempotency key, configuration-only readiness, and no
central tracing/metrics/on-call evidence. See the
[current production review](docs/codebase-production-review-2026-08-12.md) and
[target specification](docs/production-global-commentary-spec-v1.md).
