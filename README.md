# KataTalk

React(Vite) 프론트와 Express(tRPC) 백엔드가 한 저장소에 있는 **베타** 프로토타입입니다. 현재 SGF 업로드 후 **mock 분석**만 제공하며, Clerk 로그인으로 `/api/analyze` 가 보호됩니다.

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

`DATABASE_URL` 은 **로컬 개발** 에서는 없어도 Clerk 로그인·mock 분석(메모리 크레딧)이 동작할 수 있습니다. **운영(production)** 에서는 크레딧·사용자 영속화를 위해 **필수**입니다(서버 기동 시 검증).

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

## 크레딧 지갑·분석 차감 (BM: 구독제 아님)

- KataTalk 비즈니스 모델은 **월 구독이 아니라 “충전 후 분석 1회당 크레딧 차감”** 입니다.  
- **첫 인증 요청 시**(Clerk `sub` 기준) `user_wallets` + `credit_ledger` 에 **가입 보너스 2 크레딧**이 **idempotent** 하게 한 번만 지급됩니다. (`idempotencyKey = signup_bonus:<clerkSub>`)  
- `POST /api/analyze` 는 SGF 검증 후 **서버에서만** 잔액을 확인하고, **원자적 `UPDATE … WHERE balance >= 1`** 으로 1 크레딧을 차감한 뒤 mock 분석 job 을 만듭니다. 부족하면 **HTTP 402**, `code: INSUFFICIENT_CREDITS` 입니다.  
- `GET /api/analyze/:jobId` 는 **job 소유자(Clerk sub)** 와 요청자가 다르면 **403** 입니다.  
- **운영(production)** 에서는 `DATABASE_URL` 과 `AUTH_PROVIDER=clerk` 등이 **필수**이며, 크레딧은 **DB + ledger** 로만 관리합니다. **프론트 잔액만으로는 절대 신뢰하지 마세요.**  
- `DATABASE_URL` 이 없는 **로컬 개발** 에서는 Clerk 인증은 유지하되, 크레딧은 **프로세스 내 메모리 구현**으로만 동작합니다(운영에서 in-memory 크레딧 사용 금지).

## 현재 DB 구현과 향후 Supabase 로드맵

1. **크레딧 모델**은 **충전식**이며, 월 정액 구독이 아닙니다.  
2. **회원가입/첫 인증 요청** 시 서버가 wallet 을 만들고 **2 credits** 를 한 번만 지급합니다.  
3. **SGF 분석 1회당 1 credit** 을 서버에서 차감합니다.  
4. **현재 구현**은 **Drizzle + MySQL** 의 `user_wallets`, `credit_ledger` 테이블입니다.  
5. **최종 운영 DB** 는 **Supabase** 를 전제로 하며, 예: **`profiles`**(사용자·크레딧 잔액 등), **`credit_logs`**(원장) 형태로 **전환 예정**입니다. (이 저장소의 MySQL 스키마는 과도기 구현입니다.)  
6. Supabase 전환 시 **`profiles.id` 는 Clerk `userId`(JWT `sub`)** 와 정렬하는 것을 권장합니다.  
7. `credit_logs` 는 **refill**(충전) / **usage**(차감) / **refund** / **admin_adjustment** 등 유형을 기록합니다.  
8. **Stripe 결제 완료 후 크레딧 증가**는 success 페이지가 아니라 **반드시 webhook** 에서만 처리해야 합니다(클라이언트 조작 방지).  
9. **Vercel·serverless** 환경에서는 **in-memory job store** 를 사용하면 안 됩니다(인스턴스 간 공유 불가).  
10. **운영**에서는 **DB-backed job 테이블** 또는 **메시지 큐 + 워커** 가 필요합니다.

상세 TODO 목록은 [`docs/TODO.md`](docs/TODO.md) 를 참고하세요.

## in-memory 분석 job 저장소 (로컬·개발 전용)

- 현재 분석 job 은 **인메모리** 로만 보관되며, **완료·실패 job 은 TTL(기본 1시간) 후 삭제** 됩니다. SGF 원문은 job 레코드에 **저장하지 않습니다**(검증 후 mock 결과만 생성).  
- **Vercel·serverless** 등 인스턴스가 자주 바뀌는 환경에서는 **이 구조를 사용하면 안 됩니다.** 운영에서는 **DB 기반 job 테이블 + 워커/큐** 가 필요합니다.

## Stripe 결제(Checkout) 테스트 골격

현재 저장소에는 **Stripe Checkout 구독 세션 생성**과 **webhook 수신 골격**만 있습니다. **실제 quota 차감·구독 상태 DB 반영은 다음 단계**이며, test mode 기준으로 설정합니다. **`.env`·시크릿 키는 절대 커밋하지 마세요.**

1. [Stripe Dashboard](https://dashboard.stripe.com/) → **Developers**에서 **Test mode** 인지 확인합니다.  
2. **Product**를 만들고 각 플랜(Basic/Premium)에 **Recurring Price**를 만듭니다. Price ID(`price_...`)를 복사합니다.  
3. 로컬 `.env`에 다음을 채웁니다(값은 README에 적지 마세요).  
   - `STRIPE_SECRET_KEY` — **Secret key**, 서버 전용  
   - `STRIPE_WEBHOOK_SECRET` — Webhook 엔드포인트 서명용 **Signing secret**, 서버 전용  
   - `STRIPE_BASIC_PRICE_ID` / `STRIPE_PREMIUM_PRICE_ID` — 위에서 만든 **Price ID** (서버가 `plan`에 따라 선택)  
   - `APP_BASE_URL` — 실제 앱 오리진(예: `http://localhost:3000`). Checkout 완료/취소 리다이렉트에 사용됩니다.  
4. Webhook 로컬 검증: [Stripe CLI](https://stripe.com/docs/stripe-cli) 설치 후 예시처럼 포워딩합니다.  
   `stripe listen --forward-to localhost:3000/api/billing/webhook`  
   CLI가 출력하는 **webhook signing secret**을 `STRIPE_WEBHOOK_SECRET`에 넣습니다.  
5. (선택) 서버 API `POST /api/billing/create-checkout-session` 으로 Checkout URL 을 직접 검증할 수 있습니다. UI 의 유료 카드는 **크레딧 팩 결제 준비 중** 안내만 표시할 수 있습니다.

`VITE_STRIPE_*_PRICE_ID`는 `.env.example`에만 예시로 두었으며, UI 표시용 참고일 뿐 **결제 생성은 서버의 `STRIPE_*_PRICE_ID`만 사용**합니다.

## 아직 구현되지 않은 것

- KataGo 실분석 워커  
- **Stripe Checkout 으로 크레딧 팩(예: 50/120 credits) 구매** 및 결제 webhook → ledger `purchase` 반영  
- 분석 job 의 **DB/큐 영속화** 및 멀티 인스턴스 안전한 워커  
- `DATABASE_URL` 없이도 **운영** 베타를 돌리는 구성(현재 운영은 DB 필수)

## 보안·Git

- `.env` 는 `.gitignore` 에 포함되어 있어 기본적으로 커밋되지 않습니다.  
- **Secret key·서비스 롤 키를 커밋하지 마세요.**
