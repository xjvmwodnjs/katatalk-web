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
- Release tooling includes secret scanning and a production dependency-audit
  gate. GitHub Actions run [31093929840](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/31093929840)
  passed the repository gates; this is not a hosted-environment security audit.
- Production Web and Worker environment validation are separate: the Worker
  requires only its Supabase/queue and KataGo settings, reducing unnecessary
  exposure of Clerk, payment, JWT, and public-URL secrets.

## Scope and Limitations

This repository has not completed a production penetration test, external security audit, staging payment end-to-end test, or production observability and alert validation. It makes no claim of SOC 2, ISO 27001, PCI DSS, or other security certification.
