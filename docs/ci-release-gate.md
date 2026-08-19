# CI Release Gate

> **Current review alignment (2026-08-12):** Review/spec commit `09e513b` PR #4 run [`31607218074`](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/31607218074) passed all four jobs: TypeScript/unit/Clerk build/secret/format, PostgreSQL migration/ACL/atomicity, production dependency audit after `nanoid >=5.1.16`, and Playwright. See [production global commentary spec](production-global-commentary-spec-v1.md) and [2026-08-12 production review](codebase-production-review-2026-08-12.md).

> **NLC-005 candidate (2026-08-19):** migration `015` adds the v2 paid
> submission idempotency contract and the database gate now requires 100 serial
> replays plus a 32-way contention race to produce one job, one usage ledger,
> and one debit. HTTP tests require 100 lost-response replays to return the same
> job. The clean feature commit `786a626` passed the local Clerk manifest and
> artifact verifier plus the Web API and Analysis Worker production bundles.
> This is still local/repository evidence only until the commit's GitHub jobs
> and protected Supabase staging evidence pass.

## Implemented local gate

`.github/workflows/ci.yml` runs these checks for pull requests and pushes to
`master`:

- locked dependency installation through Corepack and pnpm;
- committed-secret pattern scan through `pnpm ci:secrets`;
- formatting validation for CI-owned files;
- TypeScript check, unit tests, and production build;
- Chromium Playwright E2E with failure artifacts; and
- production dependency audit that fails on high or critical advisories.

The GitHub-hosted E2E job uses the Chrome Stable channel already installed on
the hosted runner image instead of running `playwright install --with-deps`.
This keeps browser automation under Playwright while removing an otherwise
unbounded `apt update` dependency from every PR gate. Local E2E continues to
use Playwright's installed Chromium.

PR #4 run [`32232659277`](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/32232659277)
motivated this boundary: type/unit/build, PostgreSQL, and dependency-audit jobs
passed, while E2E exhausted its 25-minute budget inside the runner's Ubuntu
mirror update before any browser test started.

The local secret scanner reports only a file path, line number, and rule name.
It never prints a suspected secret value.

Dependency resolution settings live in root `pnpm-workspace.yaml`, not the
deprecated `package.json#pnpm` field. `packageManager` pins pnpm `10.18.1` with
its SHA-512 digest; CI and release builds must use Corepack/the pinned version.
Both `overrides` and `patchedDependencies` must match `pnpm-lock.yaml`, and
`pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` must pass
before accepting a dependency/config change. This keeps the security overrides
effective under pnpm 10 and newer clients that no longer read the old package
field.

## Current gate status

The production client artifact gate is part of every Vite build: the Clerk provider and a syntactically valid publishable key are required. The source commit is derived from matching GitHub, Railway, or Render immutable build metadata, or from a clean Git HEAD; an optional lowercase `KATATALK_BUILD_COMMIT_SHA` must match that evidence. Git checkouts with tracked or untracked changes fail closed, and archives without platform source metadata are rejected. Vite and the verifier use the same process-over-`.env.production` precedence. Vite emits `client-build-manifest.json`; the mandatory package verifier binds its provider, source commit, Clerk test/live type, key SHA-256, index assets, and Clerk chunk without writing or printing the raw key. Manifest responses use `no-store` and `nosniff`. Operators can calculate the protected staging fingerprint with `pnpm client:clerk-key-fingerprint` after injecting the publishable key into either source.

CI-01 remains partial. The workflow and local scanner are implemented. The
GitHub-hosted release gate most recently passed on `master` in run [`30448737391`](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/30448737391), including
the secret scan, type check, unit tests, production build, browser E2E, and
production dependency audit. The private KataGo corpus gate and the protected
staging smoke gate are still required before CI-01 can be closed.

The candidate Clerk artifact gate and the targeted `ip-address@10.4.0` advisory lock refresh passed all four jobs in PR #2 run [`30923411845`](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/30923411845): type/unit/Clerk build/secret/format, PostgreSQL migrations and ACLs, production dependency audit, and Playwright.

## Release decision

The current evidence-based decision is **NO-GO for a global public paid
service**. Percentage readiness scores are intentionally retired because they
hide hard safety and correctness gates. A local or access-controlled staging
evaluation is conditional on hiding the provisional BSI/ADI loss-derived UI;
it is not production evidence. Production approval requires the release gates
in the [production global commentary spec](production-global-commentary-spec-v1.md),
including cross-axis KataGo correctness, request/payment idempotency,
capacity-before-debit, guarded multilingual commentary, protected staging,
observability, privacy/legal approval, and restore/rollback evidence.

## Staging workflow

`.github/workflows/staging-smoke.yml` is manually dispatched into the protected GitHub `staging` environment. It does not accept a target URL from the dispatcher. The target and pin both come from the protected `STAGING_BASE_URL` environment variable, while `SMOKE_AUTH_TOKEN` and `SMOKE_OPS_TOKEN` come from environment secrets. Those secrets are exposed only to the post-install smoke step. Credential-bearing requests require an exact HTTPS-origin match, reject redirects, and cap response bodies at 64 KiB. The workflow can create one staging checkout URL only when `create_checkout` is explicitly selected.

The workflow first checks `/client-build-manifest.json` without secrets against `${{ github.sha }}` and protected `STAGING_CLERK_PUBLISHABLE_KEY_SHA256`. The authenticated smoke process repeats the same check synchronously and stops before sending either token on any provider, commit, fingerprint, schema, redirect, content-type, cache-header, or body-size mismatch. The last documented check on 2026-08-04 found no GitHub environment named exactly `staging`; no newer protected-environment evidence is recorded in this repository, so this remains an external release gate rather than completed staging evidence.

The GitHub `staging` environment must allow deployments only from `master`, require an independent reviewer, prevent self-review, and disable administrator bypass. That external deployment-branch policy is the security boundary that prevents a selected feature-branch workflow from receiving staging secrets; the workflow's own `master` guard is defense in depth.

## Worker runtime gate

Run `corepack pnpm worker:preflight` inside the staging Worker image before rollout. This is intentionally separate from Web `/readyz`, because KataGo paths and GPU runtime belong only to the Worker deployment.
