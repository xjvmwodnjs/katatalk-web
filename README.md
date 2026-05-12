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

`pnpm start` 는 Express 가 빌드된 정적 파일과 API 를 함께 제공하는 형태를 가정합니다. Vercel 등에 올릴 때는 **Node 런타임**에서 동일하게 `pnpm build` 후 `pnpm start` 하거나, 프론트·API 를 분리 배포하는 경우 별도 리버스 프록시 설정이 필요합니다.

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

## 크레딧·결제·DB (확정 아키텍처 요약)

### Stripe에서 전환한 이유 (요약)

- 한국 기반 판매자에게 **Stripe 사업자 온보딩·정산**이 불확실할 수 있음.  
- **한국 유저**에게는 **Toss Payments**가 익숙함.  
- **해외 유저**에게는 **Lemon Squeezy**(글로벌 카드)를 사용.  
- Stripe에 더 깊게 묶일수록 이후 교체 비용이 커져, **초기에 provider 추상화**로 전환.  
- **Paddle** 등은 추후 fallback 후보로 문서·운영에서만 검토 (코드 미구현).

### 시스템

- **Auth = Clerk** (Supabase Auth 미사용). **`profiles.id` = Clerk `userId`(JWT `sub`)**.  
- **Payment = 현재 Lemon Squeezy 단일**(글로벌 카드). **`server/paymentProviders/`** 추상화·**`POST /api/billing/create-checkout`**. **Toss Payments** 는 코드에 스켈레톤만 두고 **향후 국내 결제 옵션**으로 검토합니다. **Clerk Billing·Stripe·구독형 결제 미사용.**  
- **DB = Supabase** — `profiles`, `credit_logs`, `analysis_jobs`. **`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용**.  
- **신규 프로필** 첫 생성 시 **2 credits** (`signup_bonus`, idempotent).  
- **SGF 분석 1회당 1 credit** — 차감은 **`spend_credit_for_analysis` RPC** 만. 부족 시 **402** `INSUFFICIENT_CREDITS`.  
- **크레딧 충전**은 **success URL이 아니라** 각 결제사 **웹훅**에서만 **`add_credits_from_payment` RPC** 로 반영 (`payment:<provider>:…` idempotency).  
- `credit_logs` 의 **`stripe_*` 컬럼은 legacy**(과거 호환). 신규 충전은 **`payment_provider` / `payment_event_id` / `payment_order_id` / `payment_checkout_id`** 를 사용합니다 ([`002_payment_provider_neutral_credit_logs.sql`](supabase/migrations/002_payment_provider_neutral_credit_logs.sql)).  
- 결제 UI: **환불 정책 동의 체크박스** 필수(운영 전 **법무 검토** TODO).  
- **Vercel·serverless** 에서 인메모리 job만으로 운영 금지 — DB-backed job/큐 필요.

상세 TODO는 [`docs/TODO.md`](docs/TODO.md) 를 참고하세요.

## Drizzle/MySQL 크레딧 (레거시)

- 과거 구현인 `user_wallets` / `credit_ledger` 기반 코드는 **`server/creditDb.legacy.ts`** 로만 보관합니다. **기본 크레딧 경로는 Supabase** 입니다.

## in-memory 분석 job 저장소 (로컬·개발 전용)

- mock 분석 파이프라인은 **인메모리 job**으로 진행 상태를 유지합니다. **완료·실패 job 은 TTL(기본 1시간) 후 삭제** 됩니다.  
- **차감·소유권 검증**은 Supabase `profiles` / `credit_logs` / `analysis_jobs` 와 연동합니다. **Vercel·serverless** 에서 인메모리만으로 운영하면 안 되며, **DB-backed 큐/워커**가 필요합니다.

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

## 아직 구현되지 않은 것

- **KataGo / LLM** 실분석 워커 (현재 mock만)  
- 분석 job **완전한 DB/큐 기반** 파이프라인 (현재는 mock + `analysis_jobs` insert 병행)

## 보안·Git

- `.env` 는 `.gitignore` 에 포함되어 있어 기본적으로 커밋되지 않습니다.  
- **Secret key·서비스 롤 키를 커밋하지 마세요.**
