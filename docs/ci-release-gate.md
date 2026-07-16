# CI Release Gate

## Implemented local gate

`.github/workflows/ci.yml` runs these checks for pull requests and pushes to
`master`:

- locked dependency installation through Corepack and pnpm;
- committed-secret pattern scan through `pnpm ci:secrets`;
- formatting validation for CI-owned files;
- TypeScript check, unit tests, and production build;
- Chromium Playwright E2E with failure artifacts; and
- production dependency audit that fails on high or critical advisories.

The local secret scanner reports only a file path, line number, and rule name.
It never prints a suspected secret value.

## Current gate status

CI-01 remains partial. The workflow and local scanner are implemented, and the
local secret scan, type check, and production build passed on 2026-07-15. A
single-worker full unit-test gate passed: 74 files and 702 tests. The single-worker lane removes local file-level contention in the synced workspace without changing test assertions or timeouts.

The workflow is also uncommitted at this point. A GitHub-hosted first successful
run, the private KataGo corpus gate, and the staging smoke gate are still
required before CI-01 can be closed.

## Release decision

Commercialization readiness remains **76% for a controlled public beta** and
**57% for a formal production launch**. The immediate blockers are a GitHub-hosted CI first run, real-corpus human review, staging end-to-end verification,
production observability, payment-provider operations, and legal/privacy
readiness.
## Staging workflow

`.github/workflows/staging-smoke.yml` is manually dispatched into the protected GitHub `staging` environment. It requires the `SMOKE_AUTH_TOKEN` environment secret, runs an authenticated smoke account check, and can create one staging checkout URL only when `create_checkout` is explicitly selected.

## Worker runtime gate

Run `corepack pnpm worker:preflight` inside the staging Worker image before rollout. This is intentionally separate from Web `/readyz`, because KataGo paths and GPU runtime belong only to the Worker deployment.
