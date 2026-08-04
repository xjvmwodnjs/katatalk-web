# Master / Railway Staging Smoke v1

## Production Clerk 클라이언트 산출물 게이트 (COM-106 진행 중)

staging smoke는 credential 요청 전에 `STAGING_CLERK_PUBLISHABLE_KEY_SHA256`와 `/client-build-manifest.json`의 provider·source SHA·Clerk test/live 구분·publishable-key 지문을 검사한다. 이후 인증 smoke 프로세스가 같은 검사를 동기적으로 다시 통과해야만 Clerk/Ops token을 전송한다. publishable key가 프로세스 환경에 주입된 운영 터미널에서 `pnpm client:clerk-key-fingerprint`를 실행하면 원문을 출력하지 않고 지문만 계산한다. 실제 GitHub `staging` 환경·보호 규칙·실제 Clerk 로그인·publishable/secret key tenant 일치 검증은 외부 게이트로 남으므로 COM-106 전체 완료로 표시하지 않는다.

목적: `master` 기준으로 로컬 KataGo 실분석과 Railway Web/Worker staging 동작을 수동 검증한다. 이 문서는 절차와 기록 항목만 정의하며, 실제 secret/API key/KataGo binary/model/config 경로를 저장하지 않는다.

금지:

- 실제 LLM API 호출 금지. `KATATALK_LLM_COMMENTARY_ENABLED=false` 유지.
- 실제 결제 live 호출 금지. checkout/webhook live 검증은 별도 승인 전까지 제외.
- DB schema 변경 금지. migration 적용 여부만 확인.
- Worker/KataGo 분석 로직, Product selector scoring, UI 구조 변경 금지.
- `.env`, secret, API key, KataGo binary/model/config 경로, `codex-*.md`, `.tmp/katago` output 커밋 금지.

## 1. Local Smoke Profiles

아래 profile은 Web/Worker를 모두 재시작한 뒤 적용한다. KataGo path 값은 각 로컬 환경에서만 설정하고 문서/로그에 남기지 않는다. 모든 실분석 Worker에는 실제 cfg의 `reportAnalysisWinratesAs`와 같은 `KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED` 값을 설정한다.

### 1.1 빠른 UI Smoke

목적: 업로드, 완료 job, result deep link, Product Review UI 렌더링을 빠르게 확인한다.

```env
ANALYSIS_ENGINE=katago
ANALYSIS_WORKER_MODE=external
KATATALK_ALLOW_MOCK_ANALYSIS=false
KATATALK_LLM_COMMENTARY_ENABLED=false
KATAGO_MAX_VISITS=25
KATAGO_MULTI_TURN_MAX=2
KATAGO_WINRATE_TIMELINE_ENABLED=false
KATAGO_DEEP_SEARCH_ENABLED=false
```

### 1.2 균형 분석

목적: 기본 후보 chip, deterministic memo, 참고도 표시를 안정적으로 확인한다.

```env
ANALYSIS_ENGINE=katago
ANALYSIS_WORKER_MODE=external
KATATALK_ALLOW_MOCK_ANALYSIS=false
KATATALK_LLM_COMMENTARY_ENABLED=false
KATAGO_MAX_VISITS=200
KATAGO_MULTI_TURN_MAX=6
KATAGO_MULTI_TURN_MAX_VISITS=200
KATAGO_WINRATE_TIMELINE_ENABLED=false
KATAGO_DEEP_SEARCH_ENABLED=false
```

### 1.3 품질 우선

목적: winrate timeline, Deep Search 1개 후보, PV overlay를 더 깊게 확인한다.

주의: 이 profile은 GPU 또는 충분한 timeout을 확보한 환경에서만 실행한다. Railway CPU Worker에서는 기본 금지이며, timeline/Deep Search ON은 비용과 시간이 크게 증가할 수 있다.

```env
ANALYSIS_ENGINE=katago
ANALYSIS_WORKER_MODE=external
KATATALK_ALLOW_MOCK_ANALYSIS=false
KATATALK_LLM_COMMENTARY_ENABLED=false
KATAGO_MAX_VISITS=400
KATAGO_MULTI_TURN_MAX=8
KATAGO_WINRATE_TIMELINE_ENABLED=true
KATAGO_WINRATE_TIMELINE_VISITS=100
KATAGO_DEEP_SEARCH_ENABLED=true
KATAGO_DEEP_SEARCH_MAX_CANDIDATES=1
KATAGO_DEEP_SEARCH_VISITS=800
```

### 1.4 공유 KataGo C4 용량 Gate

목적: 한 Worker/KataGo process가 서로 다른 job 4개를 공유 처리할 때 queue p95 30초, engine/E2E p95 120초, 품질 warning/failure 0을 확인한다. Deep Search와 timeline을 켜면 Worker startup guard가 C4를 거부한다.

```env
ANALYSIS_ENGINE=katago
ANALYSIS_WORKER_MODE=external
ANALYSIS_WORKER_CONCURRENCY=4
KATATALK_ALLOW_MOCK_ANALYSIS=false
KATAGO_MAX_VISITS=200
KATAGO_MULTI_TURN_MAX=6
KATAGO_PERSISTENT_ROOT_ENABLED=true
KATAGO_PERSISTENT_ROOT_STRICT=true
KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS=600000
KATAGO_PERSISTENT_MULTI_TURN_ENABLED=true
KATAGO_PERSISTENT_MULTI_TURN_STRICT=true
KATAGO_PERSISTENT_MULTI_TURN_PER_JOB_CONCURRENCY=1
KATAGO_WINRATE_TIMELINE_ENABLED=false
KATAGO_DEEP_SEARCH_ENABLED=false
```

```bash
corepack pnpm katago:product-suite -- --customer-fixtures --concurrency 4 --strict-warnings --max-successful-p95-ms 120000 --max-queue-p95-ms 30000 --max-end-to-end-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --max-product-review-category-quality-failure-rows 0
```

두 wave mini-soak와 whole-system memory/throughput gate도 실행한다. 실제 staging에서는 30~60분 반복과 Worker RSS/GPU VRAM telemetry로 확장한다.

```bash
corepack pnpm katago:product-suite -- --customer-fixtures --repeat 2 --concurrency 4 --strict-warnings --max-successful-p95-ms 120000 --max-queue-p95-ms 120000 --max-end-to-end-p95-ms 180000 --min-throughput-jobs-per-minute 1 --max-peak-used-delta-mib 4096 --min-free-memory-mib 1024 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --max-product-review-category-quality-failure-rows 0
```

실제 staging에서는 합성 fixture 명령에 더해 실제 manifest corpus를 burst로 실행하고 Worker CPU/RSS/GPU memory, Supabase claim wait, 실패·환불을 함께 기록한다.

## 2. Local Smoke Procedure

### 2.0 SGF metadata and initial-player admission fixtures

Run accepted root fixtures for `SZ[9]KM[0]`, `SZ[13]KM[6.5]`, `SZ[19]KM[7.5]`, and missing `SZ`/`KM` (expected 19/6.5 with default provenance). Confirm root, multi-turn, Deep Search, timeline, persisted analysis plan, and UI use the same board/komi; both KataGo dimensions must equal the normalized square size.

Run invalid/duplicate/multi-value/unclosed/non-root mainline `SZ` and `KM`, unsupported square/rectangular sizes, comma/exponent/prefix-junk komi, quarter-points, and values outside [-150,150]. Also run comments, unknown-property values, and a closed variation containing parentheses plus `SZ`/`KM`; these must not override or reject the selected mainline.

Run an ordinary `B` start, a pre-move `PL[W]` start, and `HA[2]` with two matching final `AB` stones followed by a `W` first move. Also run invalid/duplicate `PL`, `PL` mixed with a move in the same node, post-move `PL`, invalid/duplicate `HA`, HA/setup-count mismatch, out-of-board setup coordinates, and setup+move mixing fixtures. For accepted fixtures, confirm root/timeline/UI agree on the side to move. Each invalid fixture must return the exact fixed non-reflective HTTP 400 code/message before wallet/debit/enqueue; assert Clerk identity authentication still ran, wallet/job/queue and credit-ledger deltas are zero, and raw SGF/request content is not exposed in responses or logs. For a valid fixture, assert wallet provisioning runs exactly once after admission.

`sgf-game-info-v1` 검증에는 root `PB/PW/DT/RE`가 모두 있는 fixture, 네 필드가 모두 없는 fixture, 일부만 있는 fixture를 각각 사용한다. 화면과 저장 결과에는 안전한 SGF 작성값 또는 `null`만 있어야 하며 `Black`/`White`, 실행 날짜, pipeline 설명문을 합성해서는 안 된다. 유효한 FF4 부분 날짜와 쉼표 단축 `DT`, `B+`/`W+` generic win, resign/time/forfeit/draw/void, 최대 1000이면서 JavaScript decimal exact round-trip이 되는 숫자 `RE`를 확인한다. 잘못된 단축 상태, 중복·다중값·비root 값, 길이·제어문자 위반, 1000 초과 또는 정밀도 손실 숫자는 admission 전체를 거절하지 않고 해당 선택 필드만 warning과 `null`로 축소해야 한다.

marker가 있는 저장 결과의 변조값은 UI 재검증으로 숨겨야 한다. marker가 없는 legacy `katago-worker-v1`는 snake_case `sgf_content`와 camelCase `sgfContent`를 각각 재파싱하고, SGF가 없으면 과거 합성 placeholder를 숨겨야 한다. malformed UTF-8 업로드는 고정 `SGF_INVALID_ENCODING` 400을 반환하고 wallet 준비·debit·enqueue가 모두 0회인지 확인한다. root-only 배치는 FF4 일반 `game-info` 배치보다 좁은 출시 계약이며, 실제 corpus에서는 아래 익명화 규칙을 계속 적용한다.

먼저 선택한 profile env와 로컬 `KATAGO_*` path 를 적용한 터미널에서 제품 경로 스모크를 실행한다. 이 명령은 raw stdout 확인을 넘어 실제 `analyzeSgfKatago` 결과, BSI/ADI 요약, Deep Search 요약, `qualityGate` 를 포함한 JSON 을 `.tmp/katago/product-result-*.json` 로 남긴다.

```bash
corepack pnpm katago:product-smoke -- <local-smoke-game.sgf>
corepack pnpm katago:product-smoke -- <local-smoke-game.sgf> --strict-warnings
corepack pnpm katago:product-suite -- --default-fixtures
corepack pnpm katago:product-suite -- --extended-fixtures
corepack pnpm katago:product-suite -- --customer-fixtures --strict-warnings
corepack pnpm katago:product-suite -- --extended-fixtures --repeat 3
corepack pnpm katago:persistent-benchmark -- --customer-fixtures
corepack pnpm katago:product-suite -- --corpus-dir .local/katago-corpus --strict-warnings
corepack pnpm katago:product-suite -- --corpus-dir .local/katago-corpus --strict-warnings --max-successful-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --max-product-review-category-quality-failure-rows 0
corepack pnpm katago:product-suite -- <local-smoke-game-1.sgf> <local-smoke-game-2.sgf>
```

2026-07-09 기준 로컬 product suite 결과는 `docs/katago-product-benchmark-2026-07-09.md`에 기록되어 있고, 런타임 구조 결정은 `docs/katago-runtime-architecture-2026-07-09.md`에 별도 기록되어 있다. `.tmp/katago-suite/` 산출물과 `.local/katago-corpus/` 실제 SGF corpus는 커밋하지 않는다.

신규 product suite report는 성공 분석 duration `p50`/`p90`/`p95`, expected-pass failure rate, quality warning/failure row count를 포함한다. `--max-*` gate 옵션을 지정하면 기준 초과 시 suite가 실패(exit code 1)한다. staging 또는 private corpus 측정에서는 이 요약값과 gate 통과 여부를 smoke report에 함께 남긴다.

1. 기존 Web/Worker 프로세스를 모두 종료한다.
2. Web 터미널에서 선택한 profile env를 설정하고 `corepack pnpm dev`를 실행한다.
3. Worker 터미널에서 동일한 분석 policy env와 로컬 KataGo path env를 설정하고 `corepack pnpm dev:worker`를 실행한다.
4. Web/Worker 로그에서 `ANALYSIS_ENGINE=katago`, `ANALYSIS_WORKER_MODE=external`이 반영됐는지 확인한다.
5. Worker startup log에서 정규화된 승률 관점과 `source=config`를 확인한다. cfg와 기대값이 다를 때 startup 실패가 정상이다.
6. `KATATALK_ALLOW_MOCK_ANALYSIS=false` 또는 미설정 상태를 확인한다.
7. `KATATALK_LLM_COMMENTARY_ENABLED=false` 또는 미설정 상태를 확인한다.
8. 일반 SGF를 업로드한다.
9. `analysis_jobs`에 completed job이 생성되는지 확인한다.
10. DB result에서 `result.source=katago-worker-v1`과 검증된 `result.engine.winratePerspective`를 확인한다.
11. `GET /api/analyze/:jobId` 또는 화면 응답에서 `meta.mock=false`를 확인한다.
12. `/?jobId=<completedJobId>`로 deep link 접속한다.
13. board가 표시되는지 확인한다.
14. winrate graph의 흑/백 토글과 축 라벨이 함께 전환되는지 확인한다.
15. Product Review 후보 chip이 표시되는지 확인한다.
16. 후보 선택 시 AI memo가 deterministic Product Review 문구를 표시하는지 확인한다.
17. 참고도 보기 / PV overlay를 확인한다.
18. try-play 진입, 착수, undo, reset을 확인한다.
19. viewport `390x844`, `430x932`, `1440x900`에서 깨짐이 없는지 확인한다.

권장 SGF fixture는 `docs/smoke-checklist.md`의 "LearningEvents Smoke SGF Fixture"를 우선 사용한다. 너무 짧은 SGF는 후보가 final position만 남을 수 있어 Product Review chip 확인에 부적합하다.

### 2.1 Product Review Mobile E2E

CI 또는 로컬에서 실제 KataGo 없이 Product Review 결과 화면 기본 smoke를 확인할 수 있다.

실행 전 기존 `3200` 포트 개발 서버를 종료한다. stale server가 남아 있으면 Playwright가 현재 브랜치가 아닌 이전 서버를 재사용할 수 있다.

```bash
corepack pnpm exec playwright install chromium
corepack pnpm e2e
```

동일한 설치 절차는 보조 script로도 실행할 수 있다.

```bash
corepack pnpm e2e:install
corepack pnpm e2e
```

CI/Linux runner에서 브라우저 OS dependency가 없으면 아래 명령을 먼저 사용한다.

```bash
corepack pnpm exec playwright install --with-deps chromium
```

이 E2E는 synthetic `katago-worker-v1` completed result fixture를 사용하며 실제 LLM, 결제, KataGo, DB schema/migration을 호출하지 않는다. 검증 viewport는 `390x844`, `430x932`, `1440x900`이며 검증된 흑/백 승률 토글과 SVG 축 라벨 전환을 포함한다.

## 3. Product Review UI Deep Link Smoke

대상: completed job의 결과 화면.

체크:

1. `/?jobId=<completedJobId>` 접속 시 결과가 자동 로드된다.
2. `productReviewV1`이 있는 경우 후보 chip이 learningEvents fallback보다 우선 표시된다.
3. decisive 후보는 "결정적 장면 후보" 계열의 중립 label을 사용한다.
4. review 후보는 "검토 장면 후보" 또는 "학습 장면 후보" 계열의 중립 label을 사용한다.
5. AI memo는 ExplanationPlan 기반 deterministic 문구만 표시한다.
6. LLM 실행 상태나 provider 호출 문구가 표시되지 않는다.
7. 금지 표현이 UI에 보이지 않는다: "패착 확정", "완착 확정", "악수", "정답", "best move", "blunder".
8. Product Review가 비어 있으면 기존 learningEvents 기반 UI가 유지된다.
9. mock-legacy / unknown / SGF placeholder 경로는 안전하게 fallback된다.

## 4. Railway Staging Checklist

### 4.1 Web Service

1. Web에는 `KATAGO_*`를 넣지 않는다.
2. `ANALYSIS_ENGINE=katago`.
3. `ANALYSIS_WORKER_MODE=external`.
4. `KATATALK_ALLOW_MOCK_ANALYSIS=false` 또는 미설정.
5. `KATATALK_LLM_COMMENTARY_ENABLED=false` 또는 미설정.
6. live 결제 호출은 하지 않는다. 결제 smoke는 라우팅/비노출 확인까지만 한다.
7. `APP_BASE_URL`은 staging 도메인이다. localhost 값이면 production 검증에 막힐 수 있다.

### 4.2 Automated Web/API Smoke

대상: 배포된 Web/API 공개 HTTPS URL.

기본 smoke는 live 결제나 분석 job을 생성하지 않는다. `/healthz`, `/readyz`, 익명 크레딧 조회 차단, 익명 checkout 생성 차단, 익명 분석 결과 조회 차단만 확인한다.

```bash
corepack pnpm deploy:smoke -- --base-url=https://<staging-domain>
```

인증된 staging 전용 계정의 잔액 조회까지 확인하려면 아래처럼 실행한다. 이 단계도 checkout은 만들지 않는다.

```bash
SMOKE_BASE_URL=https://<staging-domain> \
SMOKE_EXPECTED_ORIGIN=https://<staging-domain> \
SMOKE_AUTH_TOKEN=<redacted> \
corepack pnpm deploy:smoke
```

Lemon checkout URL 생성까지 확인하는 smoke는 실제 결제 세션을 만들 수 있으므로 staging 전용 계정과 별도 승인 하에서만 실행한다. 카드 결제 완료나 webhook grant 검증은 이 자동 smoke에 포함하지 않는다.

```bash
SMOKE_BASE_URL=https://<staging-domain> \
SMOKE_EXPECTED_ORIGIN=https://<staging-domain> \
SMOKE_AUTH_TOKEN=<redacted> \
SMOKE_CREATE_CHECKOUT=true \
corepack pnpm deploy:smoke
```

credential을 포함한 smoke는 `SMOKE_EXPECTED_ORIGIN`과 대상 HTTPS origin이 정확히 같을 때만 시작한다. redirect는 따라가지 않고 실패 처리하며 응답에서 가져온 값이나 `Location`을 오류에 출력하지 않는다. 응답 본문은 64KiB를 넘으면 읽기를 중단하고 실패 처리한다. GitHub `Staging Smoke` workflow의 대상은 임의 dispatch 입력이 아니라 보호된 `staging` environment 변수 `STAGING_BASE_URL`로 고정한다. 같은 environment에 `SMOKE_AUTH_TOKEN`, `SMOKE_OPS_TOKEN` secret을 두되 두 secret은 설치 후 smoke step에만 주입한다.

GitHub `staging` environment의 deployment branch는 `master`만 허용하고, required reviewer를 지정하며, self-review와 administrator bypass를 금지한다. 이 environment 정책이 실제 secret 경계다. workflow의 `master` ref guard는 우회나 오설정을 조기에 실패시키는 보조 방어일 뿐 environment 정책을 대신하지 않는다.

로컬 공개 endpoint만 확인할 때는 `SMOKE_ALLOW_INSECURE_LOOPBACK=true`로 literal loopback HTTP를 허용할 수 있다. 이 예외에 credential을 결합할 수 없으며 `0.0.0.0`, 사설 IP, 일반 hostname은 허용하지 않는다.

### 4.3 Worker Service

1. Worker에만 `KATAGO_BINARY_PATH`, `KATAGO_CONFIG_PATH`, `KATAGO_MODEL_PATH`, `KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED`를 설정한다.
2. `ANALYSIS_ENGINE=katago`.
3. `ANALYSIS_WORKER_MODE=external`.
4. `KATATALK_ALLOW_MOCK_ANALYSIS=false` 또는 미설정.
5. `KATATALK_LLM_COMMENTARY_ENABLED=false` 또는 미설정.
6. Worker 로그에 secret/path 원문이 출력되지 않고 정규화된 승률 관점과 `source=config`만 기록되는지 확인한다.
7. queued job을 claim한 뒤 `queued -> running -> completed` 상태 전이가 되는지 확인한다.
8. failed job 발생 시 기존 refund 경로가 동작하는지 staging 전용 결제/credit 데이터로만 확인한다.

### 4.4 Supabase Migration 006/007 확인

대상 파일:

- `supabase/migrations/006_lock_down_security_definer_rpc.sql`
- `supabase/migrations/007_analysis_job_lease_retry.sql`

확인 절차:

1. Supabase project가 staging인지 확인한다.
2. migration history에서 006/007이 적용됐는지 확인한다.
3. `claim_next_analysis_job` RPC가 존재하는지 확인한다.
4. lease 관련 컬럼과 retry 관련 컬럼이 `analysis_jobs`에 존재하는지 확인한다.
5. service-role 권한으로 Worker가 claim/lease 갱신/completed/failed update를 수행할 수 있는지 확인한다.
6. anon/client 권한에서 보안상 불필요한 RPC 실행이 차단되는지 확인한다.
7. schema를 수정하지 않는다. 누락이 있으면 smoke를 중단하고 migration 적용 절차를 별도로 진행한다.

007 기준 heartbeat는 별도 `heartbeat_at` 컬럼이 아니라 `locked_at` 갱신으로 동작한다. smoke 중 running job의 `locked_at`이 Worker lease 갱신 주기에 맞춰 갱신되는지 확인한다.

예시 확인 SQL은 staging 콘솔에서만 실행한다. 결과에는 secret이 포함되지 않아야 한다.

```sql
select proname
from pg_proc
where proname in ('claim_next_analysis_job', 'refund_credit_for_analysis');

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'analysis_jobs'
  and column_name in (
    'status',
    'locked_at',
    'locked_by',
    'attempt_count',
    'max_attempts',
    'next_retry_at',
    'last_error_code'
  )
order by column_name;
```

## 5. Result Recording

각 smoke run은 `docs/internal-beta-smoke-report.template.md`를 복사해 별도 파일로 기록한다. 실제 secret/API key/path, full request body, raw private SGF는 기록하지 않는다. 커밋이 필요한 보고서는 사용자 승인 후 별도 요청으로만 진행한다.

최소 기록:

- branch / commit
- local profile 또는 Railway service
- Web/Worker env policy 확인 결과
- completed job id 일부 마스킹
- `result.source`, `meta.mock`
- Product Review UI 확인 결과
- viewport 결과
- 실패 원인과 재시도 여부


### 4.5 Worker Preflight

Run this command inside the staging Worker runtime before starting `worker:analysis`. It does not claim jobs or connect to the queue. It validates required KataGo paths as regular files, parses the configured winrate perspective, probes the KataGo backend, and enforces the GPU policy.

```bash
corepack pnpm worker:preflight
```
### 4.6 Worker Liveness

Apply Supabase migrations through `008_analysis_worker_observability.sql` before deploying the external Worker. Configure the same high-entropy `OPS_STATUS_TOKEN` on Web and protected `SMOKE_OPS_TOKEN` in the staging GitHub Environment. With the Worker running, verify authenticated `GET /ops/analysis-worker-health` reports `status: "live"` for the expected engine. Stop the Worker and verify it becomes `stale` only after `ANALYSIS_WORKER_STATUS_STALE_SECONDS`; this must not change `/healthz` or `/readyz`.
