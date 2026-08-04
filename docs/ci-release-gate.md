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

The production client artifact gate is part of every Vite build: the Clerk provider and a syntactically valid publishable key are required. The source commit is derived from matching GitHub, Railway, or Render immutable build metadata, or from a clean Git HEAD; an optional lowercase `KATATALK_BUILD_COMMIT_SHA` must match that evidence. Git checkouts with tracked or untracked changes fail closed, and archives without platform source metadata are rejected. Vite and the verifier use the same process-over-`.env.production` precedence. Vite emits `client-build-manifest.json`; the mandatory package verifier binds its provider, source commit, Clerk test/live type, key SHA-256, index assets, and Clerk chunk without writing or printing the raw key. Manifest responses use `no-store` and `nosniff`. Operators can calculate the protected staging fingerprint with `pnpm client:clerk-key-fingerprint` after injecting the publishable key into either source.

CI-01 remains partial. The workflow and local scanner are implemented. The
GitHub-hosted release gate most recently passed on `master` in run [`30448737391`](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/30448737391), including
the secret scan, type check, unit tests, production build, browser E2E, and
production dependency audit. The private KataGo corpus gate and the protected
staging smoke gate are still required before CI-01 can be closed.

## Release decision

Commercialization readiness remains **76% for a controlled public beta** and
**57% for a formal production launch**. The immediate blockers are real-corpus human review, staging end-to-end verification,
production observability, payment-provider operations, and legal/privacy
readiness.

## Staging workflow

`.github/workflows/staging-smoke.yml` is manually dispatched into the protected GitHub `staging` environment. It does not accept a target URL from the dispatcher. The target and pin both come from the protected `STAGING_BASE_URL` environment variable, while `SMOKE_AUTH_TOKEN` and `SMOKE_OPS_TOKEN` come from environment secrets. Those secrets are exposed only to the post-install smoke step. Credential-bearing requests require an exact HTTPS-origin match, reject redirects, and cap response bodies at 64 KiB. The workflow can create one staging checkout URL only when `create_checkout` is explicitly selected.

The workflow first checks `/client-build-manifest.json` without secrets against `${{ github.sha }}` and protected `STAGING_CLERK_PUBLISHABLE_KEY_SHA256`. The authenticated smoke process repeats the same check synchronously and stops before sending either token on any provider, commit, fingerprint, schema, redirect, content-type, cache-header, or body-size mismatch. As of 2026-08-04 the repository has no GitHub environment named exactly `staging`, so this remains an external release gate rather than completed staging evidence.

The GitHub `staging` environment must allow deployments only from `master`, require an independent reviewer, prevent self-review, and disable administrator bypass. That external deployment-branch policy is the security boundary that prevents a selected feature-branch workflow from receiving staging secrets; the workflow's own `master` guard is defense in depth.

## Worker runtime gate

Run `corepack pnpm worker:preflight` inside the staging Worker image before rollout. This is intentionally separate from Web `/readyz`, because KataGo paths and GPU runtime belong only to the Worker deployment.
