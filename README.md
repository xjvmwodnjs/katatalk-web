# KataTalk

KataTalk is a React/Vite + Express/tRPC prototype for a future SGF Go game analysis SaaS. The target product is an authenticated service where users upload SGF files, a backend worker analyzes them with KataGo, and the app returns natural-language baduk commentary.

## Current Status

This repository is currently a local mock analysis demo. The UI is preserved from the Manus-generated prototype, but the commercial analysis pipeline is not implemented yet.

Implemented enough for local development:

- React/Vite UI for upload, language selection, pricing display, and mock result viewing
- Express server with tRPC
- Drizzle/MySQL schema draft for users and analysis history
- Local development auth provider
- Explicit mock `/api/analyze` response

Not implemented yet:

- Real SGF multipart upload
- SGF parsing and validation
- KataGo worker or analysis server integration
- LLM-generated commentary
- Stripe checkout, billing portal, and webhooks
- Server-enforced production subscription quota

## Local Setup

Install dependencies:

```bash
pnpm install
```

Create your local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Set `JWT_SECRET` in `.env` before starting the server. The server refuses to start without it.

Run the app:

```bash
pnpm dev
```

The dev script is cross-platform and sets `NODE_ENV=development` through `scripts/run-server.mjs`, so it also works in Windows PowerShell.

Build and run production output:

```bash
pnpm build
pnpm start
```

`AUTH_PROVIDER=local-dev` can run built output for local smoke testing, but it must not be used for a public deployment.

## Environment Variables

Required:

- `JWT_SECRET`: server session signing secret. Required even in local mock mode.

Recommended for local development:

- `AUTH_PROVIDER=local-dev`: enables the built-in local mock user.
- `VITE_AUTH_PROVIDER=local-dev`: keeps client login buttons from trying Manus OAuth.
- `LOCAL_DEV_USER_EMAIL`: optional local mock user email.
- `LOCAL_DEV_USER_NAME`: optional local mock user display name.
- `PORT`: optional server port, default `3000`.

Optional:

- `DATABASE_URL`: MySQL connection string for Drizzle. If omitted, the app runs with fallback subscription data.

Legacy Manus variables:

- `VITE_APP_ID`
- `OAUTH_SERVER_URL`
- `VITE_OAUTH_PORTAL_URL`
- `BUILT_IN_FORGE_API_URL`
- `BUILT_IN_FORGE_API_KEY`
- `ENABLE_LEGACY_MANUS_STORAGE`

These are not required for local development. Keep them disabled unless you are intentionally testing the old Manus adapter.

## Auth Architecture

Authentication now goes through `server/_core/authProvider.ts`.

- `local-dev`: returns a fixed local user for independent local development.
- `legacy-manus`: keeps the old Manus OAuth adapter available behind a provider boundary.

TODO: Replace `legacy-manus` with Supabase Auth or another production auth provider before commercial deployment.

## Mock Analysis Flow

`POST /api/analyze` is explicitly mock-only. It accepts JSON with:

```json
{
  "fileName": "example.sgf",
  "language": "ko"
}
```

It does not parse SGF, upload files, call KataGo, call an LLM, or enforce quota. The endpoint returns `meta.mock: true` and sets `X-KataTalk-Mock: true`.

The route has a small function boundary, `runMockSgfAnalysis`, so the next step can replace it with:

- multipart/form-data SGF upload parsing
- SGF validation
- job creation
- KataGo worker queue
- result persistence
- LLM commentary generation

## Template Audit

Likely safe to delete later after a second pass:

- `client/src/pages/ComponentShowcase.tsx`
- `client/src/components/Map.tsx`
- `client/src/components/ManusDialog.tsx`
- `client/src/components/DashboardLayout.tsx`
- `client/src/components/DashboardLayoutSkeleton.tsx`
- `client/src/components/AIChatBox.tsx`
- unused generic Manus/Forge helper modules under `server/_core/` such as `dataApi.ts`, `heartbeat.ts`, `imageGeneration.ts`, `map.ts`, `notification.ts`, and `voiceTranscription.ts`

Keep for now:

- `client/src/components/ui/*`, because active pages use these primitives.
- `server/_core/sdk.ts`, because it is still referenced by the deprecated `legacy-manus` provider.
- `server/storage.ts` and `server/_core/storageProxy.ts`, because they document the old storage path and are disabled by default.

## Next Development Steps

1. Replace `/api/analyze` JSON mock with authenticated SGF upload.
2. Add SGF parser and server-side validation.
3. Add analysis jobs table/status API.
4. Add KataGo analysis worker with a queue.
5. Normalize and persist KataGo output.
6. Generate commentary with an LLM using structured output.
7. Add Stripe subscription, webhook handling, and server-enforced quota.
8. Add rate limiting, CSRF protection, upload limits, audit logging, and production tests.
