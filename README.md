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
2. **Allowed origins**: 로컬 예) `http://localhost:3000` , 배포 도메인 `https://your-domain.com`  
3. **Redirect URLs**: 동일 출처의 `/login` 등 실제 로그인 URL 허용  
4. 소셜 로그인(Google 등)을 쓰려면 해당 제공자를 Dashboard 에서 활성화  

로그인·회원가입은 `/login` 에서 Clerk 위젯으로 처리되며, 성공 시 홈(`/`)으로 이동합니다. 로그아웃 후에는 세션이 제거되어 분석 API 가 401 을 반환합니다.

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
