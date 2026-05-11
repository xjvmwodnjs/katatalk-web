# KataTalk — 인증 및 보안 아키텍처 문서

**서비스명:** KataTalk (카타톡)  
**버전:** 1.0.0-MVP  
**작성일:** 2026-05-11  
**작성자:** Manus AI

---

## 1. 시스템 개요

KataTalk은 AI 기반 바둑 기보(SGF) 다국어 요약 서비스로, 사용자가 업로드한 SGF 파일을 KataGo 엔진으로 분석한 뒤 LLM을 통해 자연어 해설을 생성하는 SaaS 플랫폼입니다. 본 문서는 인증(Authentication), 인가(Authorization), 데이터베이스 모델링, 그리고 보안 아키텍처에 대한 기술 명세를 기술합니다.

---

## 2. 기술 스택

| 계층 | 기술 | 역할 |
|------|------|------|
| **프론트엔드** | React 19 + Tailwind CSS 4 + Vite 7 | SPA 클라이언트 |
| **API 계층** | tRPC 11 + Express 4 | 타입 안전 RPC 통신 |
| **인증** | Manus OAuth 2.0 + JWT (jose) | 세션 관리 및 사용자 인증 |
| **데이터베이스** | MySQL (TiDB) + Drizzle ORM | 사용자/구독/분석 이력 저장 |
| **직렬화** | Superjson | Date 등 복합 타입 자동 변환 |

---

## 3. 인증 흐름 (Authentication Flow)

### 3.1 OAuth 2.0 Authorization Code Flow

KataTalk은 Manus OAuth를 통해 인증을 처리합니다. Manus OAuth 포털은 Google, Apple, GitHub, 이메일/비밀번호 등 다양한 로그인 방식을 지원하며, 비밀번호 해싱 및 소셜 로그인 연동은 OAuth 제공자 측에서 처리됩니다.

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser   │     │  Manus OAuth     │     │  KataTalk API   │
│  (React)    │     │  Portal          │     │  (Express)      │
└──────┬──────┘     └────────┬─────────┘     └────────┬────────┘
       │                     │                        │
       │  1. Click Login     │                        │
       │────────────────────>│                        │
       │                     │                        │
       │  2. User authenticates (Google/Email/etc.)   │
       │                     │                        │
       │  3. Redirect with authorization code         │
       │<────────────────────│                        │
       │                     │                        │
       │  4. GET /api/oauth/callback?code=xxx&state=yyy
       │─────────────────────────────────────────────>│
       │                     │                        │
       │                     │  5. Exchange code for  │
       │                     │     access token       │
       │                     │<───────────────────────│
       │                     │                        │
       │                     │  6. Return user info   │
       │                     │────────────────────────>│
       │                     │                        │
       │  7. Set HttpOnly cookie + redirect to /      │
       │<─────────────────────────────────────────────│
       │                     │                        │
       │  8. Subsequent API calls include cookie      │
       │─────────────────────────────────────────────>│
       │                     │                        │
       │  9. Verify JWT, inject ctx.user              │
       │<─────────────────────────────────────────────│
```

### 3.2 세션 관리

세션은 JWT(JSON Web Token) 기반으로 관리되며, 서명 키는 환경 변수 `JWT_SECRET`으로 주입됩니다.

| 속성 | 값 | 보안 목적 |
|------|------|-----------|
| **HttpOnly** | `true` | JavaScript에서 쿠키 접근 차단 (XSS 방어) |
| **Secure** | `true` (HTTPS 환경) | 암호화된 연결에서만 쿠키 전송 |
| **SameSite** | `none` | 크로스 오리진 요청 허용 (OAuth 콜백 호환) |
| **Path** | `/` | 전체 경로에서 세션 유효 |
| **만료** | 1년 | 장기 세션 유지 |

### 3.3 쿠키 이름

```
app_session_id
```

---

## 4. 인가 (Authorization)

### 4.1 Procedure 계층 구조

tRPC 미들웨어를 통해 3단계 인가 수준을 제공합니다.

```typescript
publicProcedure      // 인증 불필요 (auth.me, 공개 데이터 조회)
protectedProcedure   // 로그인 필수 (profile, analysis)
adminProcedure       // 관리자 전용 (role === 'admin')
```

### 4.2 에러 코드

| 상황 | HTTP 코드 | 메시지 |
|------|-----------|--------|
| 미인증 사용자가 보호된 리소스 접근 | 401 | `Please login (10001)` |
| 일반 사용자가 관리자 리소스 접근 | 403 | `You do not have required permission (10002)` |

프론트엔드는 `UNAUTHED_ERR_MSG`를 감지하면 자동으로 로그인 페이지로 리다이렉트합니다.

---

## 5. 보안 방어 체계

### 5.1 XSS (Cross-Site Scripting) 방어

KataTalk은 다층 XSS 방어를 적용합니다.

첫째, JWT 토큰이 `HttpOnly` 쿠키에 저장되어 있어 `document.cookie`로 접근이 불가능합니다. 따라서 XSS 공격자가 세션 토큰을 탈취할 수 없습니다. 둘째, React의 기본 JSX 이스케이핑이 모든 사용자 입력을 자동으로 HTML 인코딩합니다. 셋째, `dangerouslySetInnerHTML`을 사용하지 않으며, 모든 동적 콘텐츠는 React의 가상 DOM을 통해 안전하게 렌더링됩니다.

### 5.2 CSRF (Cross-Site Request Forgery) 방어

CSRF 방어는 다음 메커니즘의 조합으로 이루어집니다.

`SameSite` 쿠키 정책과 함께, tRPC의 `httpBatchLink`가 `credentials: 'include'`로 설정되어 있어 동일 출처에서만 인증된 요청이 가능합니다. 또한 OAuth 콜백 시 `state` 파라미터를 통해 CSRF 토큰 역할을 수행하며, 이 값은 클라이언트의 `window.location.origin`을 base64 인코딩하여 생성됩니다.

### 5.3 비밀번호 보안

비밀번호 관련 보안은 Manus OAuth 제공자 측에서 전적으로 관리합니다. KataTalk 서버는 사용자의 비밀번호를 수신하거나 저장하지 않으며, OAuth 토큰 교환 과정에서 `openId`만 수신합니다. 이는 비밀번호 유출 위험을 원천적으로 제거하는 설계입니다.

---

## 6. 데이터베이스 스키마

### 6.1 Users 테이블

```sql
CREATE TABLE users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  openId          VARCHAR(64) NOT NULL UNIQUE,
  name            TEXT,
  email           VARCHAR(320),
  loginMethod     VARCHAR(64),
  role            ENUM('user', 'admin') DEFAULT 'user' NOT NULL,
  subscriptionTier ENUM('free', 'basic', 'premium') DEFAULT 'free' NOT NULL,
  remainingAnalysisCount INT DEFAULT 2 NOT NULL,
  maxAnalysisCount INT DEFAULT 3 NOT NULL,
  subscriptionStartDate TIMESTAMP,
  preferredLanguage VARCHAR(5) DEFAULT 'ko',
  createdAt       TIMESTAMP DEFAULT NOW() NOT NULL,
  updatedAt       TIMESTAMP DEFAULT NOW() ON UPDATE NOW() NOT NULL,
  lastSignedIn    TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### 6.2 Analysis History 테이블

```sql
CREATE TABLE analysis_history (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  userId          INT NOT NULL,
  fileName        VARCHAR(255),
  sgfStorageKey   VARCHAR(512),
  status          ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending' NOT NULL,
  mistakeCount    INT DEFAULT 0,
  language        VARCHAR(5) DEFAULT 'ko',
  resultJson      TEXT,
  createdAt       TIMESTAMP DEFAULT NOW() NOT NULL,
  completedAt     TIMESTAMP
);
```

### 6.3 구독 티어별 제한

| 티어 | 월 분석 횟수 | 지원 언어 | 참고도(PV) | 가격 |
|------|-------------|-----------|-----------|------|
| **Free** | 3회 | 한국어만 | 1개 | 무료 |
| **Basic** | 30회 | 4개 언어 | 5개 | $4.99/월 |
| **Premium** | 100회 | 4개 언어 | 전체 | $11.99/월 |

신규 가입 시 `subscriptionTier = 'free'`, `remainingAnalysisCount = 2`로 초기화됩니다. 이는 KataGo 서버 비용을 방어하기 위한 필수 장치입니다.

---

## 7. API 엔드포인트 구조

### 7.1 인증 관련

| 엔드포인트 | 메서드 | 인가 수준 | 설명 |
|-----------|--------|-----------|------|
| `/api/oauth/callback` | GET | Public | OAuth 콜백 처리 |
| `trpc.auth.me` | Query | Public | 현재 사용자 정보 조회 |
| `trpc.auth.logout` | Mutation | Public | 세션 쿠키 삭제 |

### 7.2 프로필/구독 관련

| 엔드포인트 | 메서드 | 인가 수준 | 설명 |
|-----------|--------|-----------|------|
| `trpc.profile.getSubscription` | Query | Protected | 구독 정보 조회 |
| `trpc.profile.updateLanguage` | Mutation | Protected | 선호 언어 변경 |

### 7.3 분석 관련

| 엔드포인트 | 메서드 | 인가 수준 | 설명 |
|-----------|--------|-----------|------|
| `trpc.analysis.canAnalyze` | Query | Protected | 잔여 크레딧 확인 |
| `trpc.analysis.start` | Mutation | Protected | 분석 시작 (크레딧 차감) |
| `trpc.analysis.history` | Query | Protected | 분석 이력 조회 |

---

## 8. 환경 변수 설정

### 8.1 .env.example

```env
# ─── Database ───
DATABASE_URL=mysql://user:password@host:port/database?ssl={"rejectUnauthorized":true}

# ─── Auth (Manus OAuth) ───
JWT_SECRET=your-jwt-signing-secret
VITE_APP_ID=your-manus-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://auth.manus.im

# ─── Owner Info ───
OWNER_OPEN_ID=owner-open-id
OWNER_NAME=Owner Name

# ─── Built-in APIs ───
BUILT_IN_FORGE_API_URL=https://forge-api.manus.im
BUILT_IN_FORGE_API_KEY=your-forge-api-key
VITE_FRONTEND_FORGE_API_KEY=your-frontend-forge-key
VITE_FRONTEND_FORGE_API_URL=https://forge-api.manus.im
```

### 8.2 보안 주의사항

`BUILT_IN_FORGE_API_KEY`와 `JWT_SECRET`은 절대 클라이언트에 노출되어서는 안 됩니다. `VITE_` 접두사가 붙은 변수만 프론트엔드 번들에 포함되며, 서버 전용 변수는 빌드 시 제외됩니다.

---

## 9. 프로젝트 디렉토리 구조

```
baduk-ai-report/
├── client/
│   └── src/
│       ├── _core/hooks/useAuth.ts    ← 인증 상태 훅
│       ├── components/               ← UI 컴포넌트
│       ├── lib/
│       │   ├── mockData.ts           ← Mock 데이터 + i18n 번역
│       │   └── trpc.ts              ← tRPC 클라이언트
│       └── pages/Home.tsx            ← 메인 페이지 (인증 통합)
├── drizzle/
│   └── schema.ts                     ← DB 스키마 (users + analysis_history)
├── server/
│   ├── _core/
│   │   ├── sdk.ts                    ← OAuth SDK (JWT 서명/검증)
│   │   ├── oauth.ts                  ← OAuth 콜백 라우트
│   │   ├── cookies.ts                ← 쿠키 보안 옵션
│   │   ├── context.ts                ← tRPC 컨텍스트 (인증 주입)
│   │   └── trpc.ts                   ← 미들웨어 (public/protected/admin)
│   ├── db.ts                         ← DB 쿼리 헬퍼
│   ├── routers.ts                    ← tRPC 라우터 정의
│   └── routers.test.ts               ← 인증/구독 테스트
├── shared/
│   └── const.ts                      ← 공유 상수
└── ARCHITECTURE.md                   ← 본 문서
```

---

## 10. 향후 확장 계획

본 MVP에서 구현된 인증 아키텍처는 다음 단계의 기능 확장을 위한 기반을 제공합니다.

첫째, **Stripe 결제 연동** 시 `subscriptionTier` 필드를 웹훅으로 자동 업데이트하는 로직을 추가할 수 있습니다. 둘째, **월간 크레딧 리셋**은 `subscriptionStartDate`를 기준으로 cron job 또는 periodic update를 통해 구현할 수 있습니다. 셋째, **Rate Limiting**은 Express 미들웨어 수준에서 IP 기반 또는 사용자 기반 제한을 추가하여 DDoS 및 남용을 방지할 수 있습니다.

---

*본 문서는 KataTalk MVP의 인증 아키텍처를 기술한 것으로, 프로덕션 배포 전 보안 감사(Security Audit)를 권장합니다.*
