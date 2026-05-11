# KataTalk

React(Vite) 프론트와 Express(tRPC) 백엔드가 한 저장소에 있는 **베타** 프로토타입입니다. **Clerk 인증**, **Supabase(DB + RPC) 크레딧**, **Stripe Checkout(크레딧 팩·webhook 충전)** 골격이 있으며, SGF 업로드 후 **mock 분석**만 제공합니다.

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

- **Auth = Clerk** (Supabase Auth 미사용). **`profiles.id` = Clerk `userId`(JWT `sub`)**.  
- **Payment = Stripe** — **Checkout `mode=payment`** 로 **크레딧 팩**만 판매합니다. **Stripe subscription mode·Clerk Billing은 사용하지 않습니다.**  
- **DB = Supabase** — `profiles`, `credit_logs`, `analysis_jobs`. **`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용**(VITE\_ 접두사 금지, 프론트·로그 노출 금지).  
- **신규 프로필** 첫 생성 시 **2 credits** (`signup_bonus`, idempotent).  
- **SGF 분석 1회당 1 credit** — 차감은 **Supabase RPC `spend_credit_for_analysis`** 로만 수행합니다(select 후 update 패턴 금지). 부족 시 **HTTP 402**, `INSUFFICIENT_CREDITS`.  
- **`credit_logs`** 에 `signup_bonus` / `refill` / `usage` / `refund` / `admin_adjustment` 를 기록합니다.  
- **크레딧 증가(충전)** 는 **Stripe `checkout.session.completed` webhook** 에서만 **`add_credits_from_stripe` RPC** 로 반영합니다. **success URL에서 크레딧을 올리지 않습니다.**  
- 결제 UI에서는 **환불 정책 동의 체크박스**가 필요합니다(문구는 법적 검토 TODO).  
- **Vercel·serverless** 에서 **in-memory job store만으로 운영하면 안 됩니다.** 현재는 **mock 파이프라인용 인메모리**와 **`analysis_jobs` DB insert**를 병행하며, 운영 완성도를 위해 **DB-backed job/큐**가 필요합니다.

상세 TODO는 [`docs/TODO.md`](docs/TODO.md) 를 참고하세요.

## Drizzle/MySQL 크레딧 (레거시)

- 과거 구현인 `user_wallets` / `credit_ledger` 기반 코드는 **`server/creditDb.legacy.ts`** 로만 보관합니다. **기본 크레딧 경로는 Supabase** 입니다.

## in-memory 분석 job 저장소 (로컬·개발 전용)

- mock 분석 파이프라인은 **인메모리 job**으로 진행 상태를 유지합니다. **완료·실패 job 은 TTL(기본 1시간) 후 삭제** 됩니다.  
- **차감·소유권 검증**은 Supabase `profiles` / `credit_logs` / `analysis_jobs` 와 연동합니다. **Vercel·serverless** 에서 인메모리만으로 운영하면 안 되며, **DB-backed 큐/워커**가 필요합니다.

## Stripe 크레딧 팩 (Checkout `mode=payment`)

**`.env`·시크릿 키는 절대 커밋하지 마세요.**

1. [Stripe Dashboard](https://dashboard.stripe.com/) → **Test mode**  
2. 크레딧 팩용 **Product + one-time Price** 3종(Starter / Standard / Pro)을 만들고 Price ID(`price_...`)를 복사합니다.  
3. `.env` 예시는 [`.env.example`](.env.example) — `STRIPE_CREDIT_PACK_*_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL` 등.  
4. Webhook: `stripe listen --forward-to localhost:3000/api/billing/webhook` → 출력 signing secret 을 `STRIPE_WEBHOOK_SECRET` 에 설정.  
5. 클라이언트는 **`packageId`만** `POST /api/billing/create-checkout-session` 에 전달합니다. **가격 ID·크레딧 수량은 서버 매핑**입니다.

## Supabase 마이그레이션

- SQL: [`supabase/migrations/001_create_katatalk_credit_system.sql`](supabase/migrations/001_create_katatalk_credit_system.sql) — Supabase SQL Editor 또는 `supabase db push` 등으로 적용합니다.

## 아직 구현되지 않은 것

- **KataGo / LLM** 실분석 워커 (현재 mock만)  
- 분석 job **완전한 DB/큐 기반** 파이프라인 (현재는 mock + `analysis_jobs` insert 병행)

## 보안·Git

- `.env` 는 `.gitignore` 에 포함되어 있어 기본적으로 커밋되지 않습니다.  
- **Secret key·서비스 롤 키를 커밋하지 마세요.**
