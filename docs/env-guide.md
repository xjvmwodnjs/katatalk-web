# KataTalk 환경 변수 가이드

> **값은 placeholder만 기재합니다.** 실제 API 키·시크릿·경로는 Git에 커밋하지 마세요.
> 로컬은 `.env.example`을 복사해 `.env`로 저장한 뒤 채웁니다. Web/Worker 분리 운영은 이 문서의 프로파일을 따르세요.

## 1. 개요

| 구분 | 역할 |
|------|------|
| **Local** | `localhost`에서 Web + Worker(선택) 동시 실행, mock 또는 로컬 KataGo |
| **Railway Web** | 로그인·결제·업로드·API enqueue — **KataGo 실행 금지** |
| **Railway Worker** | `analysis_jobs` claim·KataGo 실행·DB 결과 기록 |

공통 원칙:

- `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `LEMONSQUEEZY_*` secret, `JWT_SECRET` → **서버/Worker 전용**, `VITE_` 접두사 금지
- `KATAGO_BINARY_PATH` / `KATAGO_CONFIG_PATH` / `KATAGO_MODEL_PATH` → **Worker(또는 로컬 통합 dev)만** — Web Railway 서비스에는 넣지 않음
- KataGo cfg는 **analysis 전용** (`analysis_example.cfg` 계열). GTP용 `gtp_example.cfg` 혼동 금지

코드 기준 env 읽기: `server/_core/env.ts`, `server/worker/analysisEngines/config.ts`, `server/worker/analysisEngines/winrateTimelineConfig.ts`, `server/deepSearchResultsV1.ts`, `server/deepSearchPlanV1.ts`, `server/analysisWorkerMode.ts`, `server/worker/analysisWorkerId.ts`

---

## 2. Local 개발용 `.env`

**목적:** `http://localhost:3000`(또는 `PORT`)에서 Web + Worker를 로컬로 실행. Supabase/Clerk/Lemon 개발 프로젝트 사용. 필요 시 로컬 KataGo smoke.

```env
NODE_ENV=development
PORT=3000
APP_BASE_URL=http://localhost:3000

# 인증 (Clerk 권장)
AUTH_PROVIDER=clerk
VITE_AUTH_PROVIDER=clerk
VITE_CLERK_PUBLISHABLE_KEY=<placeholder>
CLERK_SECRET_KEY=<placeholder>
JWT_SECRET=<placeholder-long-random>

# Supabase (크레딧·analysis_jobs)
SUPABASE_URL=<placeholder>
SUPABASE_SERVICE_ROLE_KEY=<placeholder>
# legacy Supabase Auth만: SUPABASE_ANON_KEY / VITE_SUPABASE_*

# Lemon Squeezy (개발 스토어)
LEMONSQUEEZY_API_KEY=<placeholder>
LEMONSQUEEZY_WEBHOOK_SECRET=<placeholder>
LEMONSQUEEZY_STORE_ID=<placeholder>
LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID=<placeholder>
LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID=<placeholder>
LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID=<placeholder>

# 분석 큐
ANALYSIS_WORKER_MODE=external
ANALYSIS_ENGINE=mock
# 로컬 실 KataGo: ANALYSIS_ENGINE=katago + 아래 KATAGO_*
# production mock 테스트만: KATATALK_ALLOW_MOCK_ANALYSIS=true (로컬 NODE_ENV=development 에서는 mock 기본 허용)

# Worker lease (external 모드)
# ANALYSIS_WORKER_ID=local-dev-worker-1
ANALYSIS_CLAIM_STALE_SECONDS=900
ANALYSIS_WORKER_HEARTBEAT_SECONDS=60

# KataGo (Worker 또는 dev:worker와 동일 .env)
KATAGO_BINARY_PATH=<placeholder>
KATAGO_CONFIG_PATH=<placeholder>
KATAGO_MODEL_PATH=<placeholder>
KATAGO_MAX_VISITS=200
KATAGO_ANALYSIS_TIMEOUT_MS=120000
KATAGO_MULTI_TURN_MAX=6
# KATAGO_MULTI_TURN_MAX_VISITS=
# KATAGO_MULTI_TURN_QUERY_TIMEOUT_MS=
# KATAGO_MULTI_TURN_BATCH_TIMEOUT_MS=
# KATAGO_MULTI_TURN_BATCH=1
# KATAGO_MULTI_TURN_ALLOW_IDLESS_SEQUENTIAL_FALLBACK=false

KATAGO_DEEP_SEARCH_ENABLED=false
KATAGO_DEEP_SEARCH_MAX_CANDIDATES=2
KATAGO_DEEP_SEARCH_VISITS=800
KATAGO_DEEP_SEARCH_TIMEOUT_MS=180000

# Full-game winrate timeline v1 (기본 OFF)
KATAGO_WINRATE_TIMELINE_ENABLED=false
KATAGO_WINRATE_TIMELINE_VISITS=200
KATAGO_WINRATE_TIMELINE_MAX_TURNS=300
KATAGO_WINRATE_TIMELINE_TIMEOUT_MS=600000
KATAGO_WINRATE_TIMELINE_ANALYSIS_PV_LEN=1
KATAGO_WINRATE_TIMELINE_INCLUDE_FINAL=true
```

**로컬 실행 예:**

- Web: `pnpm dev`
- Worker: `pnpm worker:analysis` (동일 `.env`, `ANALYSIS_WORKER_MODE=external` 필수)
- Supabase **004+007**(`claim_next_analysis_job`) 적용 후 external worker 검증

### 로컬 KataGo 실분석 체크리스트

1. Web·Worker **둘 다 재시작** (env 변경 반영)
2. `ANALYSIS_ENGINE=katago`
3. `ANALYSIS_WORKER_MODE=external`
4. `KATATALK_ALLOW_MOCK_ANALYSIS=false` (또는 미설정)
5. Worker에 `KATAGO_BINARY_PATH` / `KATAGO_CONFIG_PATH` / `KATAGO_MODEL_PATH` 설정
6. **새로 업로드한 job** 과 예전 `queued` mock job 구분 (`is_mock` 다름)
7. Supabase `analysis_jobs.is_mock` — 실분석은 `false`
8. 완료 후 `result.source` — `katago-worker-v1`
9. `GET /api/analyze/:id` → `meta.mock` — `false`
10. Worker 로그 `[analysis-engine]` — `selectedPipeline: katago`, `rowIsMock: false`

---

## 3. Railway Web 서비스 env

**목적:** 사용자-facing API·정적 빌드·결제 웹훅. **KataGo 프로세스 실행 없음.**

```env
NODE_ENV=production
APP_BASE_URL=https://<your-domain>

AUTH_PROVIDER=clerk
VITE_AUTH_PROVIDER=clerk
VITE_CLERK_PUBLISHABLE_KEY=<placeholder>
CLERK_SECRET_KEY=<placeholder>
JWT_SECRET=<placeholder>

SUPABASE_URL=<placeholder>
SUPABASE_SERVICE_ROLE_KEY=<placeholder>

LEMONSQUEEZY_API_KEY=<placeholder>
LEMONSQUEEZY_WEBHOOK_SECRET=<placeholder>
LEMONSQUEEZY_STORE_ID=<placeholder>
LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID=<placeholder>
LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID=<placeholder>
LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID=<placeholder>

ANALYSIS_WORKER_MODE=external
ANALYSIS_ENGINE=katago
KATATALK_ALLOW_MOCK_ANALYSIS=false
```

**금지·주의:**

| 설정 | 이유 |
|------|------|
| `ANALYSIS_WORKER_MODE=inline` + `ANALYSIS_ENGINE=katago` | 운영 enqueue **503** (`KATAGO_INLINE_FORBIDDEN`) |
| Web에 `KATAGO_*` | 불필요·혼동. Worker 전용 |
| `KATATALK_ALLOW_MOCK_ANALYSIS=true` (공개 유료) | 내부 베타만. 공개 서비스는 **false/미설정** |
| `PORT` 덮어쓰기 | Railway가 주입하는 `PORT` 유지 |

---

## 4. Railway Worker 서비스 env

**목적:** `claim_next_analysis_job` → KataGo → `analysis_jobs` 완료/실패. **service_role** 필수.

```env
NODE_ENV=production

SUPABASE_URL=<placeholder>
SUPABASE_SERVICE_ROLE_KEY=<placeholder>

ANALYSIS_WORKER_MODE=external
ANALYSIS_ENGINE=katago
ANALYSIS_WORKER_ID=railway-worker-1
ANALYSIS_CLAIM_STALE_SECONDS=900
ANALYSIS_WORKER_HEARTBEAT_SECONDS=60

KATAGO_BINARY_PATH=<placeholder>
KATAGO_CONFIG_PATH=<placeholder>
KATAGO_MODEL_PATH=<placeholder>
KATAGO_MAX_VISITS=200
KATAGO_ANALYSIS_TIMEOUT_MS=120000
KATAGO_MULTI_TURN_MAX=6

KATAGO_DEEP_SEARCH_ENABLED=false
KATAGO_WINRATE_TIMELINE_ENABLED=false
KATAGO_WINRATE_TIMELINE_VISITS=200
KATAGO_WINRATE_TIMELINE_MAX_TURNS=300
KATAGO_WINRATE_TIMELINE_TIMEOUT_MS=600000
```

Clerk/Lemon/`APP_BASE_URL`은 Web과 **동일 Values**를 쓰는 배포를 권장(코드·검증 일관성). Worker 단독 최소 세트는 Supabase + 분석 env.

**Railway CPU Worker:** `KATAGO_DEEP_SEARCH_ENABLED=true`, `KATAGO_WINRATE_TIMELINE_ENABLED=true` 비권장(비용·타임아웃). GPU 호스트에서만 소규모 테스트.

---

## 5. Mock / internal beta 모드

Web + Worker **동일 정책:**

```env
ANALYSIS_ENGINE=mock
ANALYSIS_WORKER_MODE=external
KATATALK_ALLOW_MOCK_ANALYSIS=true
```

- Production에서 mock job enqueue·claim 허용
- **공개 유료 서비스에서 사용 금지**

---

## 6. Public analysis disabled 모드

결제·로그인·업로드는 가능, **실분석 enqueue 차단:**

```env
ANALYSIS_ENGINE=mock
KATATALK_ALLOW_MOCK_ANALYSIS=false
# 또는 미설정
ANALYSIS_WORKER_MODE=external
```

- Production `POST /api/analyze` → **503** `MOCK_ANALYSIS_DISABLED`
- Worker는 production에서 mock job claim 안 함

---

## 7. Future GPU KataGo Worker 모드

**Web:**

```env
ANALYSIS_WORKER_MODE=external
ANALYSIS_ENGINE=katago
KATATALK_ALLOW_MOCK_ANALYSIS=false
# KATAGO_* 없음
```

**GPU Worker:**

```env
ANALYSIS_ENGINE=katago
KATAGO_BINARY_PATH=...
KATAGO_CONFIG_PATH=...
KATAGO_MODEL_PATH=...
# 필요 시만:
KATAGO_DEEP_SEARCH_ENABLED=true
KATAGO_WINRATE_TIMELINE_ENABLED=true
KATAGO_WINRATE_TIMELINE_VISITS=200
# totalMoves·비용에 맞게 MAX_TURNS / TIMEOUT 조정
```

---

## 8. Deep Search / Winrate Timeline 비용 주의

| 변수 | 기본 | 비고 |
|------|------|------|
| `KATAGO_MAX_VISITS` | `200` | strict integer, 무효값 → 200, clamp 1–5000 |
| `KATAGO_ANALYSIS_TIMEOUT_MS` | `120000` | strict integer, 무효값 → 120000, clamp 30000–900000 |
| `KATAGO_MULTI_TURN_MAX` | `6` | strict integer, 무효값 → 6, clamp 0–100 (`0`이면 multi-turn 생략) |
| `KATAGO_MULTI_TURN_MAX_VISITS` | `KATAGO_MAX_VISITS` | strict integer, 무효값 → fallback, clamp 1–5000 |
| `KATAGO_MULTI_TURN_QUERY_TIMEOUT_MS` | `KATAGO_ANALYSIS_TIMEOUT_MS` | strict integer, 무효값 → fallback, clamp 30000–900000 |
| `KATAGO_MULTI_TURN_BATCH_TIMEOUT_MS` | 자동 산출 | strict integer, 무효값 → 자동 산출, clamp 30000–900000 |
| `KATAGO_DEEP_SEARCH_ENABLED` | `false` | `true` 시 plan 후보에 추가 고 visits KataGo |
| `KATAGO_DEEP_SEARCH_VISITS` | `800` | 후보별 순차 실행 |
| `KATAGO_WINRATE_TIMELINE_ENABLED` | `false` | `true` 시 `analyzeTurns` 0..N 단일 쿼리 |
| `KATAGO_WINRATE_TIMELINE_VISITS` | `200` | **clamp 1–2000** (무효값 → 200) |
| `KATAGO_WINRATE_TIMELINE_MAX_TURNS` | `300` | clamp 1–500; `totalMoves > maxTurns` 시 `TIMELINE_TURNS_CAPPED` |
| `KATAGO_WINRATE_TIMELINE_TIMEOUT_MS` | `600000` | clamp 30s–30m |

Timeline 실패는 job 실패/환불로 전파하지 않음(`winrateTimelineV1` 메타만).

---

## 9. Supabase 006 / 007 적용 체크

저장소에 SQL 파일이 있다고 **운영 DB에 자동 적용되지 않습니다.**

1. **순서(권장):** `001` → … → `005` → `004` → **`007`** → **`006`**
2. **007:** `claim_next_analysis_job(text, integer)`, `locked_at` / `locked_by` / `attempt_count` 등
3. **006:** SECURITY DEFINER RPC — `anon`/`authenticated` EXECUTE **false**, `service_role` **true**
4. **배포 순서:** 마이그레이션 적용 → Worker env 확인 → Web 배포

상세: [`docs/TODO.md`](TODO.md) 「최신 master 배포 전 smoke」

---

## 10. 절대 커밋하면 안 되는 항목

- `.env` (실제 secret 포함 파일)
- `codex-*.md` (로컬 리뷰 산출물)
- KataGo binary / model / config 실파일
- `.tmp/katago/` smoke 산출물
- 실제 API 키·웹훅 시크릿이 적힌 문서

---

## 부록: 주요 변수 빠른 참조

| 변수 | Web | Worker | 설명 |
|------|:---:|:------:|------|
| `NODE_ENV` | ✓ | ✓ | `production` 시 `validateProductionDeploymentEnv()` |
| `PORT` | ✓ | — | Railway Web만 (Worker는 별도 start command) |
| `APP_BASE_URL` | ✓ | △ | 결제 redirect; production HTTPS 필수 |
| `AUTH_PROVIDER` / `VITE_AUTH_PROVIDER` | ✓ | △ | production: `clerk` |
| `CLERK_SECRET_KEY` | ✓ | △ | 서버 전용 |
| `VITE_CLERK_PUBLISHABLE_KEY` | ✓(빌드) | — | 클라이언트 번들 |
| `SUPABASE_URL` | ✓ | ✓ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ | 서버/Worker 전용 |
| `LEMONSQUEEZY_*` | ✓ | — | 결제·웹훅 |
| `ANALYSIS_WORKER_MODE` | ✓ | ✓ | production katago: **`external`** |
| `ANALYSIS_ENGINE` | ✓ | ✓ | `mock` \| `katago` |
| `KATATALK_ALLOW_MOCK_ANALYSIS` | ✓ | ✓ | production mock 허용 플래그 |
| `ANALYSIS_WORKER_ID` | — | ○ | lease 식별(미설정 시 자동 생성) |
| `ANALYSIS_CLAIM_STALE_SECONDS` | ○ | ✓ | 기본 900 |
| `ANALYSIS_WORKER_HEARTBEAT_SECONDS` | ○ | ✓ | 기본 60 |
| `KATAGO_*` | ✗ | ✓ | Worker(또는 로컬 통합 dev) |
| `DEEP_SEARCH_PLAN_*` | ○ | ○ | plan 후보 수·임계값 |
| `DATABASE_URL` | ○ | ○ | MySQL users 동기화(선택) |
| `TOSS_*` | ○ | — | 국내 결제 스켈레톤 |

✓ 필수 · ○ 선택/조건부 · ✗ 넣지 않음 · △ Web과 동일 권장
