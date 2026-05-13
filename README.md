# KataTalk

React(Vite) 프론트와 Express(tRPC) 백엔드가 한 저장소에 있는 **베타** 프로토타입입니다. **Clerk 인증**, **Supabase(DB + RPC) 크레딧**, **Toss Payments(한국) + Lemon Squeezy(해외) 결제 추상화**가 있으며, SGF 업로드 후 **mock 분석**만 제공합니다. **Stripe는 사용하지 않습니다** (한국 사업자 정산·온보딩 리스크, 국내 UX에 Toss가 적합하고 해외는 Lemon Squeezy로 분리).

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

### Production 환경 변수·mock 분석 가드

`NODE_ENV=production` 이면 기동 시 **`validateServerEnv`** 가 Clerk·Supabase·Lemon·`APP_BASE_URL`(반드시 **`https://`** 로 시작, **`http://localhost` 불가**) 등을 검증합니다. 오류 메시지에는 **변수명만** 포함하고 값은 넣지 않습니다.

**KataGo/LLM이 연결되기 전에는 production에서 유료 공개 mock 분석을 켜면 안 됩니다.** `KATATALK_ALLOW_MOCK_ANALYSIS=true` 가 아니면 production 에서 `POST /api/analyze` 는 **503** `MOCK_ANALYSIS_DISABLED` 입니다. 스테이징·내부 베타에서만 명시적으로 켜세요.

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

동일 저장소에서 **Web Service** 와 **Worker Service** 두 개를 두는 방식을 권장합니다. **Build Command** 는 동일하게 `corepack pnpm build` (또는 install 포함 한 줄)로 두고, **Start Command** 만 다르게 합니다.

| 서비스 | 역할 | Start Command |
|--------|------|----------------|
| **Web** | HTTP·정적·Clerk·Lemon webhook | `corepack pnpm start` |
| **Worker** | `claim_next_analysis_job` 로 queued 를 가져와 mock 분석 완료까지 DB 갱신 | `corepack pnpm worker:analysis` |

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
  - **`external`**(production 기본): Express 는 **enqueue 만** 하고, 별도 프로세스 **`pnpm worker:analysis`** 가 RPC **`claim_next_analysis_job`** 으로 queued 를 잡은 뒤 동일 mock 파이프라인으로 DB 를 갱신합니다.  
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

## 보안·Git

- `.env` 는 `.gitignore` 에 포함되어 있어 기본적으로 커밋되지 않습니다.  
- **Secret key·서비스 롤 키를 커밋하지 마세요.**
