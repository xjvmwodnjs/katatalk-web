# KataTalk

React(Vite) 프론트와 Express(tRPC) 백엔드가 한 저장소에 있는 **베타** 프로토타입입니다. **Clerk 인증**, **Supabase(DB + RPC) 크레딧**, **Toss Payments(한국) + Lemon Squeezy(해외) 결제 추상화**가 있으며, SGF 업로드 후 **mock 분석**만 제공합니다. **Stripe는 사용하지 않습니다** (한국 사업자 정산·온보딩 리스크, 국내 UX에 Toss가 적합하고 해외는 Lemon Squeezy로 분리).

## 알고리즘 기준 문서

**최종 알고리즘 기준 문서:** [`docs/algorithm/KataTalk_Algorithm_V2.5.md`](docs/algorithm/KataTalk_Algorithm_V2.5.md)

### analysis plan v1 (후보 턴만)

BSI/ADI 전 단계로, SGF 메인라인 전체 수를 파싱한 뒤 **어떤 수순을 나중에 분석할지** 후보 목록만 만든다. 스키마·빌더는 `shared/analysisPlanV1.ts`, `server/analysisPlan.ts` 이고, worker 결과 JSON에는 `analysisPlan` 필드로 포함된다(SGF 파싱만으로 생성, **추가 KataGo 없음**).

### multi-turn KataGo raw v1

`analysisPlan.candidateTurns` 중 상위 `KATAGO_MULTI_TURN_MAX` 개(기본 6, `final_position` 우선)에 대해 **해당 수를 두기 직전 국면**을 추가로 분석한다.

- **Batch mode(기본, `KATAGO_MULTI_TURN_BATCH≠0`)**: KataGo `analysis` 가 **stdin에 JSON 여러 줄**을 받고 **stdout JSONL에 요청과 동일한 `id` 필드**를 돌려준다는 전제다. **배포 전 반드시 로컬 KataGo 버전으로 smoke** 해서 이 전제를 확인할 것.
- **순차 모드(`KATAGO_MULTI_TURN_BATCH=0`)**: 디버그·호환용. 기본은 **`id` 없으면 해당 턴 failed**. `KATAGO_MULTI_TURN_ALLOW_IDLESS_SEQUENTIAL_FALLBACK=true` 일 때만 `pickPrimaryAnalysisObject` 폴백을 허용하며, 성공 시 해당 턴에 `fallbackUsed: true`.
- **`KATAGO_MULTI_TURN_MAX` / `multiTurnAnalysis.maxTurnsRequested`**: **분석 시도 상한**이지 `completedCount` 와 같지 않다. `attemptedCount`·`completedCount`·`failedCount`·`allFailed`·`partialFailure` 를 함께 본다.
- **Primary `KATAGO_MAX_VISITS`** 와 **`KATAGO_MULTI_TURN_MAX_VISITS`** 는 서로 다를 수 있다(최종 국면 1회 vs multi 쿼리).
- **최종 국면 단일 분석이 성공**하면 v1 에서는 **multi-turn 이 전부 failed여도 job 은 `completed`일 수 있다**. 이 경우 **`multiTurnAnalysis.allFailed===true`** 이며, **선택적 Deep Search 재분석이 전부 실패해도**( `deepSearchResults.allFailed` ) **job 을 failed 로 바꾸지 않는다**. **패착 단정·자연어 해설은 하지 않는다**. **`result.bsiV1`** / **`result.adiV1`** / **`result.deepSearchPlan`** 은 multi-turn **`turnAnalyses` 중 `ok` 행**이 있을 때만 수치·후보 선정 필드가 채워진다.
- `result.turnAnalyses`·`multiTurnAnalysis`·`bsiV1`·`adiV1`·`deepSearchPlan`·`deepSearchResults` 에 요약만 저장한다(raw stdout DB 저장 없음). LLM·Q&A 없음.

### BSI v1 (multi-turn 기반 수치만)

`server/bsiV1.ts`·`shared/bsiV1.ts`. **디버그·내부 signal** — `top_mistakes`·자연어 해설·UI 패착 라벨에 쓰지 말 것. `turnAnalyses[].moveSummary`·`comparisonReady`만 사용(추가 KataGo 없음).

- **KataGo `scoreLead` / `scoreMean` / `winrate` 관점**은 엔진·버전별로 다를 수 있으므로, 운영 전 **실제 샘플 JSON으로 perspective 검증** 후 `scorePerspective` / `winratePerspective` 값을 좁힐 것(현재 기본은 `katago_output` 또는 `unknown`).
- **`scoreBestMinusPlayed`**: best·played 가 **같은 score 축**(둘 다 `scoreLead` 또는 둘 다 `scoreMean`)일 때만 계산; **lead/mean 혼합 시 생략**(`scoreMetricUsed: "none"`, `components.scoreMetricMixed`). **`winrateBestMinusPlayed`** 는 양쪽 winrate 가 있으면 혼합 score 여부와 무관하게 계산 가능. 하위 호환 `scoreDelta`/`winrateDelta`는 동일 정책( mixed 시 score 쪽 생략).
- **`bsiScore`**: visits 가중과 지수 포화로 **0~100** 사용 가능; `bsiRaw`·`components.zComposite` 등 원시·블렌드 입력은 ADI·LES 전 단계용.
- **`severity` / `bsiBand`**: 내부 numerical band 별칭일 뿐 사용자 패착 판정이 아님.

### ADI v1 (multi-turn + BSI 기반 내부 signal만)

`server/adiV1.ts`·`shared/adiV1.ts`. **Adaptive Deepening Index** — 후보 `visits`/순위/PV·BSI 등으로 **0~1** 내부 값과 `deepSearchCandidate` 불리언만 저장한다. **ADI 자체는 추가 KataGo를 돌리지 않는다.** (높은 visits 재분석은 **Deep Search Execution v1**·`KATAGO_DEEP_SEARCH_ENABLED` 참고.) `turnAnalyses[].candidateMoves`(상위 N개 요약)와 `bsiV1.signals`를 사용하며, `ownershipVolatility`는 v1에서 `null`이고 가중치 재정규화한다. `top_mistakes`·자연어·LLM·Concept Tagger·Q&A 없음.

### Deep Search Candidate Selector v1 (`deep-search-plan-v1`)

`server/deepSearchPlanV1.ts`·`shared/deepSearchPlanV1.ts`. **`result.deepSearchPlan`** — ADI/BSI/`analysisPlan`/`turnAnalyses`(ok)만으로 **후보 수순(최대 3)** 을 선정한다. **이 단계만으로는 추가 KataGo를 호출하지 않는다.** 기본 정책: `analysisPlan` 에서 **`final_position` reason 턴은 후보에서 제외**. **ADI-only 후보는 v1에서 허용**한다(`bsiV1` 해당 턴에 유효한 `bsiScore` 숫자가 없으면 `minBsiScore` 임계값을 적용하지 않음).

**`DEEP_SEARCH_PLAN_*` env (clamp·기본값):** 값이 비어 있거나 숫자로 파싱되지 않으면 기본을 쓴다. `DEEP_SEARCH_PLAN_MAX_CANDIDATES`: 0 이하·NaN → 기본 **3**; 양의 정수면 **1~10**으로 clamp. `DEEP_SEARCH_PLAN_MIN_ADI_SCORE`: NaN → 기본 **0.5**; 유효하면 **0~1** clamp. `DEEP_SEARCH_PLAN_MIN_BSI_SCORE`: NaN → 기본 **30**; 유효하면 **0~100** clamp.

### Deep Search Execution v1 (`deep-search-results-v1`)

**Worker 전용** — Express/Web API 에서 KataGo 를 직접 실행하지 말고, **`ANALYSIS_WORKER_MODE=external` + `ANALYSIS_ENGINE=katago` 인 worker**(`analyzeSgfKatago`)만 실행한다.

- **기본 OFF**: `KATAGO_DEEP_SEARCH_ENABLED` 가 문자열 **`true`**(대소문자 무시)일 때만 추가 분석을 돌린다. 그 외에는 `result.deepSearchResults.enabled === false` 요약만 남기고 **추가 KataGo 프로세스를 띄우지 않는다**.
- **Railway/일반 CPU 경고:** Deep Search 는 후보마다 **높은 `maxVisits`(기본 800)** 로 KataGo 를 **순차** 추가 실행한다. **프로덕션 CPU 호스트에서 실수로 `true` 가 되면 비용·지연·부하가 크게 증가**할 수 있다. GPU 전용 worker·스테이징·로컬 검증 용도로만 켤 것.
- **대상:** `deepSearchPlan.candidates` 상위 **`KATAGO_DEEP_SEARCH_MAX_CANDIDATES`** 개(기본 2, **1~5** clamp)만. 각 턴은 multi-turn 과 동일하게 **해당 수 직전 국면**(`turnIndex` = N 이면 `movesBeforeCount = N-1`)을 분석한다.
- **정책:** `KATAGO_DEEP_SEARCH_VISITS`(기본 800, **100~5000** clamp), `KATAGO_DEEP_SEARCH_TIMEOUT_MS`(기본 180000, **30000~900000** clamp). **`KATAGO_DEEP_SEARCH_BATCH`**: v1 은 항상 순차; stdin 배치 모드는 **미구현**(TODO).
- **실패:** 한 후보가 실패해도 job 을 failed 로 만들지 않고 해당 행만 `status: "failed"` + 짧은 `error` 코드/메시지. 전 후보 실패 시 `deepSearchResults.allFailed === true` 이어도 primary/multi 가 성공했다면 **job 은 completed** 유지. Deep 실패에 **추가 환불 없음**.
- **저장:** `moveInfos` 전체·raw stdout·stderr 전문은 저장하지 않는다. `katago` 슬라이스는 multi-turn 과 유사한 요약만. `comparison` 에 `deepBestMove` / `plannedBestMoveStillTop` / `playedMoveRank` 만( **패착·악수·정답 라벨 없음** ). `top_mistakes`·LLM·해설 없음.

## 로컬 실행

```bash
pnpm install
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

`.env` 에 `JWT_SECRET` 과 Clerk 키를 넣은 뒤:

```bash
pnpm dev
```

프로덕션 빌드:

```bash
pnpm build
pnpm start
```

`pnpm start` 는 [`scripts/run-server.mjs`](scripts/run-server.mjs) 가 **`NODE_ENV=production`** 으로 **`node dist/index.js`** 를 실행합니다. `pnpm build` 는 **Vite 정적 자산**과 **esbuild 로 묶은 서버 엔트리(`dist/index.js`)** 를 함께 생성합니다.

#### Railway / Render — Build Command · Start Command

패키지 매니저는 **pnpm** 입니다. Corepack 을 켠 환경에서 아래를 권장합니다.

플랫폼이 **의존성 설치를 자동**으로 하는 경우:

- **Build Command:** `corepack pnpm build`  
- **Start Command:** `corepack pnpm start`

설치까지 한 줄로 묶고 싶거나, CI와 동일하게 맞추려면:

- **Build Command:** `corepack pnpm install --frozen-lockfile && corepack pnpm build`  
- **Start Command:** `corepack pnpm start`

Railway/Render 프로젝트 **Root directory** 는 저장소 루트( `package.json` 이 있는 디렉터리)로 두세요.

### 운영 배포 전략 (장기 실행 Node — Railway 우선)

앱은 **장시간 실행되는 Express 프로세스**(`pnpm start`) 한 개에서 정적 파일·REST API·**raw body 웹훅**을 함께 제공하는 구조를 기준으로 합니다.

| 우선순위 | 플랫폼 |
|---------|--------|
| 1순위 | **Railway** (Node Web Service) |
| 2순위 | **Render** (Web Service) |
| 추후 검토 | **Fly.io**, **일반 VPS** (Docker/systemd 등) |

#### Vercel — 현재 미사용·보류

**현재는 Vercel 배포를 사용하지 않으며(보류),** 초기 베타는 **Railway / Render 등 long-running Node** 를 전제로 합니다.

보류 이유:

- 커스텀 **Express `server.listen`** 단일 프로세스 구조
- Lemon Squeezy 등 **raw body 웹훅 서명 검증**
- **in-process mock 분석 타이머** 등 프로세스 수명에 묶인 동작
- **메모리 기반 rate limit** (인스턴스마다 별도 카운터)
- 향후 **KataGo worker** 가 Express 외부 프로세스로 붙을 가능성

**Vercel(serverless) 적합성은** 위 요소를 **serverless adapter·별도 worker/웹훅 경로**로 나눈 뒤 **별도로 재검토**합니다.

**DB**는 **Supabase**(마이그레이션 적용 프로젝트)입니다.

#### PORT 와 APP_BASE_URL (Railway / Render)

- **PORT:** Railway·Render 는 런타임에 **`PORT`** 환경 변수로 수신 포트를 지정합니다. **플랫폼이 넣어 주는 값을 그대로 쓰고**, 대시보드에서 임의로 **고정 포트에 맞춰 listen 하도록 덮어쓰지 마세요.** Production 에서는 **자동으로 다른 빈 포트로 바꿔 listen 하지 않으며**, 지정 포트 listen 에 실패하면 **프로세스가 종료**됩니다.  
- **APP_BASE_URL:** 반드시 브라우저·웹훅이 실제로 접속하는 **공개 HTTPS 도메인**(예: `https://your-app.up.railway.app`)을 넣습니다. **`PORT` 나 `http://localhost:…` 를 APP_BASE_URL 로 쓰지 마세요.** (Checkout·리다이렉트·Clerk·Lemon 설정과 불일치합니다.)

**Lemon Squeezy 웹훅**은 반드시 **공개 HTTPS** URL이어야 합니다. 예시:

`https://your-domain.com/api/billing/webhook/lemonsqueezy`

웹훅은 `server/_core/index.ts` 의 **`attachPaymentWebhooks`** 로 등록되며, **`billingRouter`에 붙은 일반 rate limit 미들웨어를 거치지 않습니다**(서명 검증으로 보호).

**멀티 인스턴스**에서는 프로세스 내 **in-memory rate limit**·mock 분석 타이머가 공유되지 않습니다. 운영에서는 **Redis/Upstash 등 외부 저장소 기반 rate limit**, **DB-backed queue/worker** 가 필요합니다.

**KataGo** 연동 시 Express와 **분리된 worker 프로세스**(큐 소비) 구성을 권장합니다.

### 로컬 Lemon Squeezy / ngrok 체크리스트

로컬에서 결제·리다이렉트·웹훅이 꼬이지 않으려면 **실제 listen 포트**와 **`APP_BASE_URL`** 포트가 **반드시 일치**해야 합니다(`pnpm dev` 가 선호 포트가 아닐 때 자동으로 다음 포트를 쓰는 경우 포함).

1. **`PORT=3000`**(또는 사용 중인 포트)로 서버를 띄운 뒤, **`.env` 의 `APP_BASE_URL`** 을 동일 포트로 맞춥니다. 예: `APP_BASE_URL=http://localhost:3000`  
2. **ngrok** 예: `ngrok http 3000` — 터널이 앞단에서 받는 포트와 위 포트가 같아야 합니다.  
3. Lemon Dashboard 웹훅 URL: `https://<ngrok-host>/api/billing/webhook/lemonsqueezy`  
4. 포트 불일치 시 `POST /api/billing/create-checkout` 는 **`APP_BASE_URL_PORT_MISMATCH`**(503)로 막을 수 있습니다.

### Lemon `order_created` idempotency·payload 검증 TODO

웹훅 **idempotency 키**는 `server/paymentProviders/lemonsqueezyProvider.ts` 의 주석 우선순위를 따릅니다. **`meta.webhook_id` 가 주문마다 안정적인지** 등은 Lemon 실제 payload 로만 확정할 수 있으므로, **ngrok Inspector 또는 Lemon Dashboard** 에서 수집한 **`order_created` JSON 을 개인정보·카드 정보 제거(redaction)한 fixture** 를 저장소에 추가하고, 그 fixture 기준으로 idempotency 우선순위·테스트를 고정하는 작업이 남아 있습니다(확실하지 않은 필드는 코드 주석으로 “확인 필요” 유지).

### API Rate limiting

주요 REST 경로에 **express-rate-limit**(메모리 저장)을 적용했습니다. **단일 인스턴스**에서만 의미가 일관되며, 초과 시 **429** 및 JSON `code: "RATE_LIMITED"` 를 반환합니다. **수평 확장** 시에는 **Redis/Upstash** 등으로 교체해야 합니다.

### Production 환경 변수·분석 enqueue 가드

`NODE_ENV=production` 이면 기동 시 **`validateServerEnv`** 가 Clerk·Supabase·Lemon·`APP_BASE_URL`(반드시 **`https://`** 로 시작, **`http://localhost` 불가**) 등을 검증합니다. 오류 메시지에는 **변수명만** 포함하고 값은 넣지 않습니다.

**Mock 분석(엔진 mock)** 은 운영에서 실수로 노출되면 안 되므로, `NODE_ENV=production` 이고 **`ANALYSIS_ENGINE` 이 mock(또는 미설정)** 이면 **`KATATALK_ALLOW_MOCK_ANALYSIS=true`** 가 아닐 때 `POST /api/analyze` 는 **503** `MOCK_ANALYSIS_DISABLED` 입니다.

**KataGo 실분석** 은 **`ANALYSIS_ENGINE=katago`** 이고 **`ANALYSIS_WORKER_MODE=external`** 일 때 production 에서도 **`KATATALK_ALLOW_MOCK_ANALYSIS` 없이** enqueue(202)가 허용됩니다. 웹/API 프로세스는 KataGo 바이너리를 실행하지 않으며, 별도 worker 가 DB 큐를 소비합니다.

**금지 조합(운영):** `ANALYSIS_ENGINE=katago` + **`ANALYSIS_WORKER_MODE=inline`** → **503** `KATAGO_INLINE_FORBIDDEN` (웹·워커 역할 혼동·오설정 방지).

### SGF 원문 저장 (MVP)

- **저장 위치:** 검증된 SGF UTF-8 텍스트는 Supabase **`analysis_jobs.sgf_content`** 컬럼에 저장됩니다.
- **사용:** worker 가 동일 행을 읽어 KataGo 분석에만 사용합니다.
- **로그:** SGF 전문은 애플리케이션 로그에 출력하지 않습니다(해시·크기 등 메타만).
- **추후:** Supabase Storage / S3 이전, **TTL·삭제 정책**, 사용자 삭제 요청, raw 디버그 산출물과의 **권한 분리**는 별도 설계 후 적용합니다(`docs/TODO.md` 참고).

### Railway 운영 프로파일 (mock 베타 / 공개 분석 비활성 / 향후 GPU KataGo)

Railway **Web** 와 **Worker** 는 별도 서비스로 두는 것을 전제로 합니다. **Web/API 프로세스는 KataGo 바이너리를 실행하지 않습니다.** `KATAGO_*` 는 **Worker(또는 향후 GPU Worker)** 에만 필요합니다. **Railway 일반 CPU**에서 KataGo 상용 부하를 돌리는 것은 **권장하지 않습니다** — GPU·전용 호스트 후보를 검토하세요.

#### 1) Railway internal beta — mock mode

내부·스테이징에서 **가짜 분석 end-to-end**(업로드·큐·완료 UI)를 검증할 때. **공개 유료 서비스에 그대로 두지 말 것.**

| 서비스 | 변수 |
|--------|------|
| **Web** | `ANALYSIS_WORKER_MODE=external`, `ANALYSIS_ENGINE=mock`, `KATATALK_ALLOW_MOCK_ANALYSIS=true` |
| **Worker** | `ANALYSIS_ENGINE=mock`, `KATATALK_ALLOW_MOCK_ANALYSIS=true` |

Worker 가 없으면 job 은 **queued** 에 남습니다. Supabase **`claim_next_analysis_job` RPC(004)** 적용 필수.

#### 2) Railway public — analysis disabled mode

**로그인·결제·크레딧·SGF 업로드** 등은 테스트하되, **가짜 분석 결과를 공개 유저에게 노출하지 않을** 때.

| 서비스 | 변수 |
|--------|------|
| **Web** | `ANALYSIS_ENGINE=mock`, `KATATALK_ALLOW_MOCK_ANALYSIS=false` **또는 미설정** (`ANALYSIS_WORKER_MODE` 는 `external` 권장 — worker 없으면 queued 만 쌓임) |
| **Worker** | 동일하게 `ANALYSIS_ENGINE=mock` + `KATATALK_ALLOW_MOCK_ANALYSIS=false`/미설정 이면 production 에서 **queued job 을 claim 하지 않음**(기존 README「Worker」절 참고) |

이때 `POST /api/analyze` 는 **503** `MOCK_ANALYSIS_DISABLED` 로 막힙니다.

#### 3) Future — GPU KataGo worker mode (binary는 Railway Web 에 올리지 않음)

GPU 서버(또는 전용 워커 호스트) 구독 후, **KataGo binary/model/config 를 Worker 측에만** 배치합니다. **Web Service Variables 에 `KATAGO_*` 를 넣을 필요 없습니다.**

| 서비스 | 변수 |
|--------|------|
| **Web** | `ANALYSIS_WORKER_MODE=external`, `ANALYSIS_ENGINE=katago`, `KATATALK_ALLOW_MOCK_ANALYSIS=false` **또는 미설정** |
| **GPU Worker** | `ANALYSIS_ENGINE=katago`, `KATAGO_BINARY_PATH=…`, `KATAGO_CONFIG_PATH=`**`analysis_example.cfg` 계열**(GTP용 `gtp_example.cfg` 금지), `KATAGO_MODEL_PATH=…`, `KATAGO_MAX_VISITS=200`, `KATAGO_ANALYSIS_TIMEOUT_MS=120000`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, production 공통(Clerk·`APP_BASE_URL` 등은 호스트 정책에 맞게) |

Worker 는 Supabase **`claim_next_analysis_job`** 로 `analysis_jobs` 를 가져와 **KataGo `analysis` 1회** 실행 후 `result.source=katago-worker-v1` 형태로 저장합니다.

### Railway / Render — Production 환경 변수 체크리스트

아래 값은 **이름만** 나열합니다. **실제 secret·API 키 값은 README에 적지 말고**, 각 플랫폼 Environment 탭과 `.env`(로컬)에만 넣으세요.

**필수 (production)**

| 변수 | 비고 |
|------|------|
| `NODE_ENV` | `production` |
| `AUTH_PROVIDER` | `clerk` |
| `VITE_AUTH_PROVIDER` | `clerk` (Vite 클라이언트 번들에 포함) |
| `VITE_CLERK_PUBLISHABLE_KEY` | 브라우저에 노출되는 Clerk Publishable key |
| `CLERK_SECRET_KEY` | **서버 전용** — 번들·Git·로그에 넣지 않음 |
| `JWT_SECRET` | **서버 전용** |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **서버 전용** — `VITE_` 접두사 금지, 클라이언트 비노출 |
| `LEMONSQUEEZY_API_KEY` | **서버 전용** |
| `LEMONSQUEEZY_STORE_ID` | |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | **서버 전용** — Lemon 대시보드 Webhook Signing secret 과 일치 |
| `LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID` | |
| `LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID` | |
| `LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID` | |
| `APP_BASE_URL` | **공개 HTTPS 도메인** (예: `https://<배포도메인>`). 포트 번호나 localhost 가 아님 |

**선택**

| 변수 | 비고 |
|------|------|
| `KATATALK_ALLOW_MOCK_ANALYSIS` | `true` 일 때만 production 에서 mock 분석 API·**worker mock 처리** 허용. **내부 베타·스테이징** 에서만 사용. **공개 유료 production** 에서는 `false` 또는 미설정 권장. |
| `ANALYSIS_WORKER_MODE` | `inline`(Express 내 타이머) / `external`(별도 worker). **production 기본값은 `external`**(미설정 시). Web 만 띄우고 worker 가 없으면 job 은 **queued** 에 남습니다. |
| `ANALYSIS_ENGINE` | `mock`(기본) / `katago`. **실 KataGo 실행은 Worker 프로세스에서만** (`pnpm worker:analysis`). Web 에 `KATAGO_*` 가 없어도 됩니다. |
| `KATAGO_BINARY_PATH` / `KATAGO_CONFIG_PATH` / `KATAGO_MODEL_PATH` | Worker(또는 로컬 smoke)에서만 필요. **binary·모델·cfg 는 Git 에 올리지 않음.** |
| `KATAGO_MAX_VISITS` / `KATAGO_ANALYSIS_TIMEOUT_MS` | 선택. 기본 `200` / `120000`. worker timeout 시 **SIGTERM → 5s 후 SIGKILL** 시도. |

`PORT` 는 Railway/Render 가 주입합니다. **대시보드에서 임의 고정할 필요 없음**(플랫폼 기본값 사용).

### Railway 배포 절차 (요약)

1. [Railway](https://railway.app/) 에서 **New Project** → **Deploy from GitHub repo** 로 이 저장소 연결  
2. **Node** 기반 **Web Service** (또는 동등한 서비스) 추가 — **Root** 는 저장소 루트  
3. **Build Command** / **Start Command** 에 상단 **「Railway / Render — Build Command · Start Command」** 절의 `corepack pnpm …` 명령을 입력  
4. **Variables** 에 상단 **「Railway / Render — Production 환경 변수 체크리스트」** 의 필수 항목 등록  
5. 배포가 끝나면 Railway 가 준 **HTTPS 도메인**(예: `*.up.railway.app`)으로 서비스가 열리는지 확인  
6. **`APP_BASE_URL`** 을 그 **공개 HTTPS URL** 로 설정한 뒤 **재배포**  
7. **Lemon Squeezy** 대시보드 Webhook URL 을 다음으로 변경:  
   `https://<railway-도메인>/api/billing/webhook/lemonsqueezy`  
8. **Clerk** Dashboard 의 **Allowed origins / redirect URLs** 에 production 도메인 추가  
9. 아래 **「배포 후 스모크 테스트」** 절 수행  

#### Railway — 분석 Worker 를 Web 과 분리할 때

**운영 목적별 권장 env 조합(내부 mock / 공개 분석 끔 / 향후 GPU)** 은 위 **「Railway 운영 프로파일」** 절을 먼저 읽으세요.

동일 저장소에서 **Web Service** 와 **Worker Service** 두 개를 두는 방식을 권장합니다. **Build Command** 는 동일하게 `corepack pnpm build` (또는 install 포함 한 줄)로 두고, **Start Command** 만 다르게 합니다.

| 서비스 | 역할 | Start Command |
|--------|------|----------------|
| **Web** | HTTP·정적·Clerk·Lemon webhook | `corepack pnpm start` |
| **Worker** | `claim_next_analysis_job` 로 queued 를 가져와 **`ANALYSIS_ENGINE`** 에 따라 mock 완료 또는 **KataGo v1** 분석 후 DB 갱신 | `corepack pnpm worker:analysis` |

**Worker 전용 — `ANALYSIS_ENGINE=katago` (v1)**  
- **Worker Service** Variables 예: `ANALYSIS_ENGINE=katago`, `KATAGO_BINARY_PATH`, `KATAGO_CONFIG_PATH`, `KATAGO_MODEL_PATH`, `KATAGO_MAX_VISITS=200`, `KATAGO_ANALYSIS_TIMEOUT_MS=120000`. **Web Service**에는 이 `KATAGO_*` 가 **없어도 됩니다**(KataGo는 worker에서만 실행).  
- **Railway 일반 CPU**에서는 분석이 **느릴 수 있습니다.** 상용 고성능은 **GPU worker**(RunPod / Fly GPU / GPU VPS 등) 후보를 검토하세요.  
- **`KATAGO_CONFIG_PATH`**는 **`katago analysis` 전용 `analysis_example.cfg` 계열**을 쓰세요. **`gtp_example.cfg`**(GTP용)를 넣으면 `numAnalysisThreads` 누락 등으로 실패하기 쉽습니다.  
- **DB `analysis_jobs.result` v1**에는 **raw stdout 전체를 저장하지 않습니다**(요약·normalized 필드만). **raw 장기 보존**은 추후 **Storage / 디버그 아티팩트 정책**을 정한 뒤 구현합니다.

두 서비스 모두 **동일한 Variables** 를 쓰는 것을 전제로 합니다(최소: `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Clerk·Lemon·`APP_BASE_URL` 등 Web 과 동일). **Supabase 에 `004_analysis_job_claim_rpc.sql` 의 `claim_next_analysis_job` RPC 가 적용되어 있어야** worker 가 job 을 가져갑니다.

mock 분석을 돌리려면 Web·Worker 모두에서 **`KATATALK_ALLOW_MOCK_ANALYSIS=true`** 가 필요합니다. production 에서 `false`/미설정이면 **API는 막히고**, worker 도 **queued job 을 claim 하지 않으며** 기존 queued 행을 failed 로 바꾸지 않습니다. **공개 유료 production** 에서는 mock 대신 추후 **KataGo 전용 worker** 로 교체하는 것이 목표입니다.

### Render 배포 절차 (요약)

1. Render 대시보드에서 **New** → **Web Service**  
2. **GitHub** 저장소 연결  
3. **Runtime:** Node  
4. **Build Command** / **Start Command** 는 위와 동일하게 `corepack pnpm build` · `corepack pnpm start` (또는 install 포함 한 줄)  
5. **Environment** 에 동일한 production 변수 등록  
6. **`APP_BASE_URL`** 을 Render 가 발급한 **HTTPS URL** 로 설정  
7. Lemon Webhook: `https://<render-도메인>/api/billing/webhook/lemonsqueezy`  
8. Clerk production URL 허용 목록에 Render 도메인 추가  
9. **주의:** Render **무료·저가 티어**는 유휴 시 **슬립** 될 수 있어, 첫 요청 지연·웹훅 수신 타이밍·UX 에 영향을 줄 수 있습니다. 결제 웹훅·상시 응답이 중요하면 **유료·상시 구동 플랜** 검토  

### 배포 후 스모크 테스트

별도 **healthcheck API** 는 두지 않습니다. 아래를 **수동**으로 확인합니다.

1. 브라우저에서 **GET /** — 정적 홈이 로드되는지  
2. **Clerk 로그인** — 세션 후 홈 복귀  
3. 인증된 상태로 **GET `/api/credits/me`** — 200 및 잔액 JSON  
4. **`/pricing`** 페이지 로드  
5. 앱에서 **Lemon checkout** 생성 후 테스트 결제(또는 스테이징 정책에 맞는 흐름)  
6. Lemon 웹훅 처리 로그·응답에서 **`action=granted`** 에 해당하는 처리 확인  
7. Supabase **`credit_logs`** 에 **refill** 유형 충전 행이 쌓였는지 SQL/대시보드로 확인  

### 운영 배포 체크리스트

- [ ] Supabase 마이그레이션 **001 / 002 / 003 / 004** 적용 (`004`: 분석 worker 용 `claim_next_analysis_job`)
- [ ] Clerk **production** 도메인·Redirect URL
- [ ] Lemon Squeezy **live** API key·store·**webhook signing secret**
- [ ] Lemon **live** variant ID 3종(Starter / Standard / Pro)
- [ ] `APP_BASE_URL` 이 production 공개 URL(`https://`)인지 확인
- [ ] Variant 실제 가격: Starter **$4.99 / 20** · Standard **$9.99 / 50** · Pro **$29.99 / 200** credits
- [ ] 결제 후 웹훅으로 **credits 증가** 수동 테스트
- [ ] `credit_logs` 충전 기록 확인
- [ ] Rate limit **429** 동작 확인
- [ ] Production 에서 **mock 분석 비활성**(또는 스테이징만 `KATATALK_ALLOW_MOCK_ANALYSIS=true`) 확인
- [ ] **KataGo·LLM 미구현** 상태 표시 확인
- [ ] 환불 정책·약관 **법무 검토**

## Clerk 환경 변수

| 변수 | 사용 위치 | 설명 |
|------|-----------|------|
| `AUTH_PROVIDER` | 서버 | `clerk` 로 설정 시 Bearer JWT 검증 경로 사용 |
| `VITE_AUTH_PROVIDER` | 클라이언트 빌드 | `clerk` 일 때 Clerk UI·토큰 헤더 사용 |
| `VITE_CLERK_PUBLISHABLE_KEY` | 클라이언트(번들) | Clerk Publishable key 만 노출 |
| `CLERK_SECRET_KEY` | 서버만 | Secret key — **저장소·프론트 번들에 포함 금지** |
| `JWT_SECRET` | 서버 | 세션 쿠키 등 (운영에서는 필수) |

`DATABASE_URL` 은 **선택**입니다. 있으면 Drizzle/MySQL `users` 동기화 등에 사용합니다. **크레딧 잔액·원장·분석 job 메타**는 **Supabase**(`profiles`, `credit_logs`, `analysis_jobs`)를 사용합니다. **운영(production)** 에서는 `SUPABASE_URL` 과 `SUPABASE_SERVICE_ROLE_KEY`(서비스 롤)가 **필수**입니다. **Supabase Auth는 사용하지 않으며**, 브라우저에서 Supabase DB에 직접 접근하지 않고 **Express 서버 API + service role** 로만 접근합니다.

## Clerk Dashboard 설정

1. [Clerk Dashboard](https://dashboard.clerk.com/) 에서 애플리케이션 생성  
2. **Paths (Development)**  
   - Development host / Application URL 은 **실제 dev 주소**와 같아야 합니다. 예: `http://localhost:3000` (`pnpm dev` 포트가 다르면 그 포트).  
   - Sign-in URL 경로: **`/login`**  
   - Sign-up URL 경로: **`/sign-up`**  
   - 이메일 verification 코드는 오는데 **404 또는 빈 화면**이면 SMTP 문제가 아니라 **`/sign-up`·`/login` 라우팅** 또는 Dashboard 의 Paths/Redirect 허용 목록 문제일 가능성이 큽니다.  
3. **Redirect / Allowed URLs**: `/login`, `/sign-up`, `/`(로그인·가입 완료 후 복귀)뿐 아니라 Clerk 이메일 인증 등으로 이동하는 **하위 경로**(예: `/sign-up/verify-email-address`, `/login/sso-callback`)가 같은 오리진에서 열리도록 Dashboard 의 Development host·Redirect/Allowed 목록을 **실제 dev URL**(포트 포함, 예: `http://localhost:3003`)과 함께 맞춥니다. 인증 메일은 오는데 404가 나면 SMTP 문제가 아니라 **앱 라우팅 또는 Dashboard URL 허용 목록**을 의심하세요.  
4. **Email** sign-up / sign-in 은 Clerk Dashboard → User & Authentication → Email 에서 **반드시 활성화**되어 있어야 합니다. 메일이 오지 않으면 Dashboard 의 제한·도메인 설정을 확인하세요.  
5. **Google** 등 소셜 로그인은 해당 제공자를 Clerk 에서 켠 뒤, 클라이언트 ID/시크릿과 리다이렉트 URI 를 제공자 콘솔과 일치시켜야 합니다.  

### 로그인·회원가입 수동 테스트(로컬)

1. 비로그인으로 `/login` 접속 → 다크 테마 로그인 카드  
2. 이메일 입력 시 글자·placeholder 가 잘 보이는지 확인  
3. 「회원가입」링크로 `/sign-up` 이동 → 가입 폼 표시  
3-1. 브라우저에서 `/sign-up/verify-email-address` 등으로 직접 열어도 404가 아니어야 합니다.  
4. 가입 또는 로그인 완료 후 `/` 로 이동하는지 확인  
5. 로그아웃 후 `/login` 또는 비로그인 상태에서 분석 시도 시 401 안내  

**코드 vs Dashboard**: 회원가입 링크·경로는 저장소에서 `/sign-up` 으로 연결합니다. 이메일 인증 메일 미수신·OAuth 오류는 대부분 **Clerk Dashboard·DNS·제공자 콘솔** 설정을 확인하세요. `CLERK_SECRET_KEY` 나 서버 시크릿은 README 나 로그에 적지 마세요.

## 인증과 mock 분석

- `Authorization: Bearer <Clerk 세션 토큰>` 으로 `POST /api/analyze` 및 `GET /api/analyze/:jobId` 호출  
- 서버 미들웨어에서 인증 실패 시 **내부 스택을 노출하지 않고** 한국어 안내 메시지로 401 응답  
- `AUTH_PROVIDER=local-dev` 는 로컬 편의용이며, **운영 배포에서는 사용하지 마세요** (기존 가드 유지)
- **Production** 에서는 `KATATALK_ALLOW_MOCK_ANALYSIS=true` 가 없으면 mock 분석 API 가 **503** 으로 차단됩니다. **KataGo/LLM 연동 전에는 유료 트래픽에 mock 결과를 노출하지 마세요.**

## 크레딧·결제·DB (확정 아키텍처 요약)

### Stripe에서 전환한 이유 (요약)

- 한국 기반 판매자에게 **Stripe 사업자 온보딩·정산**이 불확실할 수 있음.  
- **한국 유저**에게는 **Toss Payments**가 익숙함.  
- **해외 유저**에게는 **Lemon Squeezy**(글로벌 카드)를 사용.  
- Stripe에 더 깊게 묶일수록 이후 교체 비용이 커져, **초기에 provider 추상화**로 전환.  
- **Paddle** 등은 추후 fallback 후보로 문서·운영에서만 검토 (코드 미구현).

### 시스템

- **Auth = Clerk** (Supabase Auth 미사용). **`profiles.id` = Clerk `userId`(JWT `sub`)**.  
- **Payment = 현재 Lemon Squeezy 단일**(글로벌 카드, **일회성 크레딧 팩 구매**). **`server/paymentProviders/`** 추상화·**`POST /api/billing/create-checkout`**. **Toss Payments** 는 코드에 스켈레톤만 두고 **향후 국내 결제 옵션**으로 검토하며 **현재 checkout UI 에는 노출하지 않습니다**. **Clerk Billing·Stripe·구독형 결제 미사용.**  
- **DB = Supabase** — `profiles`, `credit_logs`, `analysis_jobs`. **`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용**.  
- **신규 프로필** 첫 생성 시 **2 credits** (`signup_bonus`, idempotent).  
- **SGF 분석 1회당 1 credit** — 차감은 **`spend_credit_for_analysis` RPC** 만. 부족 시 **402** `INSUFFICIENT_CREDITS`.  
- **크레딧 충전**은 **success URL이 아니라** 각 결제사 **웹훅**에서만 **`add_credits_from_payment` RPC** 로 반영 (`payment:<provider>:…` idempotency).  
- `credit_logs` 의 **`stripe_*` 컬럼은 legacy**(과거 호환). 신규 충전은 **`payment_provider` / `payment_event_id` / `payment_order_id` / `payment_checkout_id`** 를 사용합니다 ([`002_payment_provider_neutral_credit_logs.sql`](supabase/migrations/002_payment_provider_neutral_credit_logs.sql)).  
- 결제 UI: **환불 정책 동의 체크박스** 필수(운영 전 **법무 검토** TODO).  
- **수평 확장·다중 인스턴스** 환경에서는 인메모리 job만으로 운영하면 안 되며, **DB-backed job/큐** 가 필요합니다. **Vercel 배포는 현재 보류**이며, 초기 베타는 **long-running Node** 호스팅을 전제로 합니다.

상세 TODO는 [`docs/TODO.md`](docs/TODO.md) 를 참고하세요.

## Drizzle/MySQL 크레딧 (레거시)

- 과거 구현인 `user_wallets` / `credit_ledger` 기반 코드는 **`server/creditDb.legacy.ts`** 로만 보관합니다. **기본 크레딧 경로는 Supabase** 입니다.

## 분석 job (`analysis_jobs`)

- **작업 상태·결과·오류의 근원은 Supabase `analysis_jobs`** 입니다. **`GET /api/analyze/:jobId` 는 DB 행만** 조회합니다 (프로덕션에서 완료 결과를 인메모리에만 두지 않음).
- **`POST /api/analyze`** 는 크레딧 차감 후 **`status=queued`** 행만 만들고, **`ANALYSIS_WORKER_MODE`** 에 따라 mock 진행 주체가 갈립니다.  
  - **`external`**(production 기본): Express 는 **enqueue 만** 하고, 별도 프로세스 **`pnpm worker:analysis`** 가 RPC **`claim_next_analysis_job`** 으로 queued 를 잡은 뒤 **`ANALYSIS_ENGINE`** 에 따라 mock 또는 **KataGo v1** 로 DB 를 갱신합니다.  
  - **`inline`**: 로컬 편의를 위해 Express 프로세스 안 **`setTimeout`** 파이프라인을 그대로 사용할 수 있습니다.
- mock 은 여전히 **KataGo·LLM 없이** 동일 테이블만 갱신합니다. **다음 단계**는 이 worker 슬롯을 **KataGo 실행 worker** 로 바꾸는 것입니다. **Vercel(serverless) 배포는 별도 adapter/worker 분리 전까지 보류**합니다.

**로컬 수동 검증 (`external` + worker):**

1. Supabase 프로젝트에 **`004_analysis_job_claim_rpc.sql`** 이 적용되어 있어야 합니다. 미적용이면 worker 가 `claim_next_analysis_job` 호출에서 실패합니다.  
2. **Web** 이 Express 인라인 타이머를 켜지 않으려면 `.env` 에 **`ANALYSIS_WORKER_MODE=external`** 을 넣습니다.(`development`/`test` 에서는 미설정 시 기본 **inline** 이라, worker 없이도 mock 타이머가 돌아갑니다.)  
3. 터미널 A: `corepack pnpm dev`, 터미널 B: `corepack pnpm dev:worker`  
4. 로그인 후 SGF 업로드 → Supabase `analysis_jobs` 가 `queued` → `running` → `completed` 로 바뀌는지 확인합니다. Worker 를 끄면 job 은 **queued** 에 남습니다.  
5. **`corepack pnpm worker:analysis`** 는 **`dist/worker/analysisWorker.js`** 를 사용하므로, 로컬에서 이 명령만 돌릴 때는 먼저 **`corepack pnpm build`** 가 필요합니다(Railway 등은 Build 단계에서 동일하게 `pnpm build` 가 선행되면 됩니다).

## 결제 (Lemon Squeezy · Toss 는 향후 검토)

**`.env`·시크릿 키는 절대 커밋하지 마세요.**

- **베타 UI**: 크레딧 충전은 **Lemon Squeezy만** 사용합니다.  
- **Toss**: **실결제 연동 전**(스켈레톤만). 국내 결제 UX 확보 시 연동 검토. `TOSS_*` 는 서버 전용 (**`VITE_` 접두사 금지**).  
- **Lemon Squeezy 상품(표시 가격·크레딧)** — 실제 과금은 Lemon 대시보드 variant와 일치해야 합니다.  
  - Starter **$4.99** → **20** credits  
  - Standard **$9.99** → **50** credits  
  - Pro **$29.99** → **200** credits  
- **환경 변수**: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`(대시보드 **Webhook Signing secret** 과 동일해야 함), `LEMONSQUEEZY_CREDIT_PACK_*_VARIANT_ID` 3종, 결제 후 복귀 URL용 **`APP_BASE_URL`** (예: 로컬 `http://localhost:3000`).  
- **웹훅 URL**: `https://<공개호스트>/api/billing/webhook/lemonsqueezy` — 로컬에서 Lemon 대시보드가 서버에 접근하려면 **ngrok 등 터널**이 필요합니다.  
- **크레딧 증가는 success 리다이렉트가 아니라 웹훅(`order_created`)에서만** `add_credits_from_payment` 로 반영됩니다.  
- 클라이언트는 **`POST /api/billing/create-checkout`** 에 `packageId` + 선택 `provider` (+ 선택 `locale`) 만 전달합니다. **크레딧 수·variant id 는 서버 설정만 유효**합니다.  
- 크레딧 결제 UI(`/pricing`) 문구는 **`katatalk-ui-lang`** 저장값과 동일한 네 언어(`mockData` `TRANSLATIONS`)로 표시됩니다.
- **운영 체크리스트**: Lemon 대시보드 각 variant의 **실제 과금 금액**이 위 표·`shared/creditPackCatalog.ts` 와 일치하는지 배포 전에 확인합니다. **Lemon 호스팅 결제(Hosted Checkout) 화면 언어**는 이 저장소에서 제어하지 않으며, Lemon 설정에서 조정하거나 별도 검토가 필요합니다.
- **Lemon 대시보드에서 직접 연 결제 링크(앱이 아닌 URL)로 결제**하면 `checkout_data.custom` 이 전달되지 않아 웹훅에 `custom_data`가 없을 수 있으며, 이 경우 **크레딧 지급이 되지 않습니다**. 반드시 앱의 **`/pricing` → `POST /api/billing/create-checkout` 이 돌려준 URL**로 결제하세요.

### 결제·웹훅 문제 조사용 SQL (Supabase)

잔액·충전 기록 확인:

```sql
select id, credits, email, updated_at
from profiles
order by updated_at desc
limit 10;

select user_id, amount, type, payment_provider, payment_event_id, payment_order_id, idempotency_key, created_at
from credit_logs
order by created_at desc
limit 20;
```

과거 `payment:lemonsqueezy:unknown` 등 잘못된 idempotency 키가 쌓였는지 확인(필요 시 운영자가 원인 파악 후 정리):

```sql
select *
from credit_logs
where idempotency_key like '%unknown%'
order by created_at desc;
```

**수동으로 `credits` 를 올리는 SQL 은 임의로 실행하지 말고**, 먼저 웹훅 응답 `action`·서버 로그·위 쿼리로 원인을 확인하세요.

## Supabase 마이그레이션

- [`001_create_katatalk_credit_system.sql`](supabase/migrations/001_create_katatalk_credit_system.sql)  
- [`002_payment_provider_neutral_credit_logs.sql`](supabase/migrations/002_payment_provider_neutral_credit_logs.sql) — `credit_logs` provider 중립 컬럼 + `add_credits_from_payment` RPC  
- [`003_analysis_jobs_progress.sql`](supabase/migrations/003_analysis_jobs_progress.sql) — `analysis_jobs.progress`  
- [`004_analysis_job_claim_rpc.sql`](supabase/migrations/004_analysis_job_claim_rpc.sql) — **`claim_next_analysis_job`** (worker 가 queued 를 원자적으로 running 으로 claim)

## 아직 구현되지 않은 것

- **KataGo / LLM** 실분석 워커 (현재 mock worker 슬롯만 분리됨)  
- **KataGo** 를 `worker:analysis` 자리에 연결하고, 장시간·GPU 작업에 맞는 **프로세스/리소스** 설계

## KataGo 로컬 smoke·저장소 위생 (worker 실연결 전)

- **`pnpm katago:smoke` 등 로컬 smoke** 가 쓰는 **`.tmp/katago/`** 는 **raw / normalized / stderr 출력 전용**이며 **커밋하지 않습니다.** (`.gitignore` 에 디렉터리와 `raw-*`·`normalized-*`·`stderr-*` 패턴을 명시.) **실제 사용자 기보는 `samples/` 에 넣지 말고** **`.tmp/`·`.local/`** 등 ignore 되는 경로에 두세요. **`samples/test.sgf`** 는 **짧은 synthetic fixture** 로 **예외적으로** 저장소에 둘 수 있습니다.
- **KataGo binary·모델(`*.bin.gz` 등)·로컬 cfg** 는 **저장소에 올리지 마세요.** (루트 실행 파일·루트 cfg 는 `.gitignore` 로 차단.)
- **worker 에 실제 KataGo 를 붙이기 전**에는 **SIGTERM 이후 SIGKILL fallback**, **stdout 상한·streaming**, **raw 출력 저장 정책** 등을 **별도 브랜치**에서 보강할 예정입니다.  
- **worker v1(`ANALYSIS_ENGINE=katago`)**은 이미 **timeout 시 SIGTERM → 5초 후 SIGKILL** 을 시도하며, **`analysis_jobs.result` 에 raw stdout 전체는 넣지 않습니다.** 전체 raw 보존은 **추후 Storage / 디버그 아티팩트 정책** 후 구현합니다.

## 보안·Git

- `.env` 는 `.gitignore` 에 포함되어 있어 기본적으로 커밋되지 않습니다.  
- **Secret key·서비스 롤 키를 커밋하지 마세요.**
