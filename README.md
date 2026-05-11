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

`DATABASE_URL` 은 **선택**입니다. 없어도 Clerk 로그인과 mock 분석 API 는 동작합니다.

## Clerk Dashboard 설정

1. [Clerk Dashboard](https://dashboard.clerk.com/) 에서 애플리케이션 생성  
2. **Paths**: 앱에서 `signInUrl=/login`, `signUpUrl=/sign-up` 을 사용합니다. Dashboard 의 Application URL·Allowed origins 에 **실제 개발 주소**(예: `http://localhost:3000` 또는 `pnpm dev` 가 쓰는 포트)를 넣으세요.  
3. **Redirect / Allowed URLs**: `/login`, `/sign-up`, `/`(로그인·가입 완료 후 복귀)뿐 아니라 Clerk 이메일 인증 등으로 이동하는 **하위 경로**(예: `/sign-up/verify-email-address`, `/login/sso-callback`)가 같은 오리진에서 열리도록 Dashboard 의 Development host·Redirect/Allowed 목록을 **실제 dev URL**(포트 포함, 예: `http://localhost:3003`)과 함께 맞춥니다. 인증 메일은 오는데 404가 나면 SMTP 문제가 아니라 **앱 라우팅 또는 Dashboard URL 허용 목록**을 의심하세요.  
4. **Email** 로그인·회원가입을 쓰려면 User & Authentication → Email 에서 활성화되어 있는지 확인하세요. 메일이 오지 않으면 대부분 Dashboard 의 제한·도메인 설정 이슈입니다.  
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

## 아직 구현되지 않은 것

- KataGo 실분석 워커  
- Stripe 결제·구독·서버 측 quota 강제  
- DB 영구 저장(선택적 `DATABASE_URL` 없이도 베타 동작)

## 보안·Git

- `.env` 는 `.gitignore` 에 포함되어 있어 기본적으로 커밋되지 않습니다.  
- **Secret key·서비스 롤 키를 커밋하지 마세요.**
