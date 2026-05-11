# KataTalk

KataTalk은 **바둑 SGF 기보 분석**을 목표로 하는 **React(Vite) + Express(tRPC)** 모노레포입니다. 프론트엔드는 업로드·언어 선택·가격 안내·분석 결과 UI를 제공하고, 백엔드는 tRPC API와 **`/api/analyze`** 비동기 분석 작업(현재는 **목(mock)** 결과)을 담당합니다.

## 현재 구현 범위

- SGF **multipart 업로드**, 기본 **유효성 검사**, **작업(job) 큐** + **폴링**으로 분석 진행률 표시 (엔진은 아직 목 데이터)
- **Supabase Auth** 기반 **로그인/로그아웃**(Google OAuth + 이메일/비밀번호). 비밀번호 처리는 **전부 Supabase에 위임**
- Express에서 **`Authorization: Bearer <access_token>`** 검증 후에만 **`/api/analyze`** 허용
- Drizzle/MySQL 스키마(사용자·분석 이력) — Supabase 사용자는 `openId = sb:<uuid>` 형태로 upsert

## 아직 미구현 (다음 단계)

- Stripe / Toss 등 **결제**
- **분석 횟수**·구독 플랜의 **엄격한 서버 쿼터**
- **KataGo worker** 또는 별도 **FastAPI 분석 서버** 연동 (분석 백엔드는 인증을 직접 하지 않고, **이 Express 서버가 토큰 검증 후** 워커를 호출하는 구조 권장)
- **LLM 해설** 파이프라인

---

## 로컬 실행

```bash
pnpm install
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Supabase 모드로 개발할 때는 `.env`에서 `AUTH_PROVIDER=supabase`, `VITE_AUTH_PROVIDER=supabase` 및 아래 Supabase 변수를 채웁니다. **`DATABASE_URL`** 이 있어야 Supabase 사용자가 MySQL `users` 테이블에 동기화되어 로그인·tRPC·분석 API가 정상 연동됩니다.

```bash
corepack pnpm dev
```

프로덕션 빌드:

```bash
pnpm build
pnpm start
```

---

## Supabase 프로젝트 만들기

1. [Supabase 대시보드](https://supabase.com/dashboard)에서 새 프로젝트를 생성합니다.
2. **Project Settings → API**에서 **Project URL**과 **anon public** 키를 복사합니다.
3. **절대** Service Role 키를 프론트엔드(Vite)에 넣지 마세요. 서버에서도 이번 단계에서는 **anon 키로 JWT 검증(`getUser`)**만 사용합니다.
4. `.env`에 `VITE_SUPABASE_*` 및 `SUPABASE_*`(서버)에 동일 값을 넣습니다.

---

## Google OAuth (Supabase Dashboard 설정)

1. Supabase 대시보드 **Authentication → Providers → Google**을 켭니다.
2. Google Cloud Console에서 **OAuth 2.0 클라이언트 ID**를 만들고, **승인된 리디렉션 URI**에 Supabase가 안내하는 콜백 URL을 등록합니다. (대시보드에 표시되는 URL을 그대로 사용)
3. **Authentication → URL Configuration**에서 **Site URL**을 로컬이면 `http://localhost:3000`(실제 사용 포트) 등으로 맞춥니다.
4. 앱 코드에서는 `signInWithOAuth`의 `redirectTo`를 **`window.location.origin`** 기준(예: 로그인 후 `/`)으로 두어, 배포 도메인이 바뀌어도 안전하게 돌아오도록 했습니다.

이메일/비밀번호 로그인을 쓰려면 **Authentication → Providers → Email** 설정을 확인합니다.

---

## 환경 변수

| 변수 | 용도 |
|------|------|
| `JWT_SECRET` | production 필수. local-dev·legacy Manus 세션 JWT 서명 등에 사용 |
| `AUTH_PROVIDER` | `local-dev` \| `legacy-manus` \| **`supabase`** |
| `VITE_AUTH_PROVIDER` | 프론트에서 동일하게 맞출 것 (`supabase` 시 `/login` 사용) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 브라우저 Supabase 클라이언트 (anon만) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | 서버에서 Bearer JWT 검증용 (통상 VITE와 동일 값) |
| `DATABASE_URL` | Supabase 모드에서 **사용자 upsert**에 필요. production의 `supabase`에서는 **필수** |
| `PORT` | 선택, 기본 3000 |

**`SUPABASE_SERVICE_ROLE_KEY`**는 이번 구현에 넣지 않았습니다. 나중에 관리자 API 등에 반드시 필요해 서버에만 추가할 경우, **README·코드 어디에도 노출하지 말 것**을 원칙으로 하세요.

`.env`는 **`.gitignore`에 포함**되어 있으며 **커밋하지 마세요.**

---

## 로그인 / 로그아웃 동작

1. 프론트는 **Supabase JS**로 세션을 보관합니다(브라우저 저장 방식은 Supabase 기본 정책을 따름). **서비스 롤 키는 클라이언트에 두지 않습니다.**
2. tRPC 요청은 **`httpBatchLink`의 `headers`**로 `Authorization: Bearer <access_token>`을 붙입니다(Supabase 모드일 때만).
3. Express `createContext`는 **`tryResolveUserFromRequest`**로 동일 규칙으로 사용자를 로드합니다. `AUTH_PROVIDER=supabase`일 때는 **Bearer만** 신뢰합니다(레거시 쿠키와 혼용 안 함).
4. **`/api/analyze`** 및 **`/api/analyze/:jobId`**는 **`requireAnalyzeAuth`**를 거쳐야 하며, 미로그인 시 **401**과 한국어 메시지를 반환합니다.

---

## 보안 주의사항

- **anon 키만** 프론트에 노출합니다. Service Role은 서버 전용이며, 이번 코드 경로에는 포함하지 않았습니다.
- **production + `AUTH_PROVIDER=local-dev`**는 여전히 경고 대상입니다. 상용은 **`supabase` + 강한 `JWT_SECRET` + `DATABASE_URL`**을 사용하세요.
- 인증 실패 응답에는 **스택 트레이스·내부 코드**를 넣지 않고, 사용자에게는 **일반화된 한국어**만 노출합니다.
- 별도 CORS 미들웨어는 두지 않았습니다(동일 출처 기준). 향후 다른 오리진에서 API를 호출하게 되면 **허용 목록을 최소화**해 설정하세요.

---

## 수동 테스트 제안

1. **로그아웃** 상태에서 SGF 분석 요청 → **401** 및 한국어 안내
2. **이메일 회원가입** → Supabase 이메일 확인 정책에 따라 인증 메일 확인
3. **이메일 로그인**
4. **Google 로그인** 버튼 → OAuth 화면으로 이동하는지
5. **로그인 후** SGF 분석 → **202 job + 폴링 성공**
6. **로그아웃 후** 다시 분석 → **차단**

---

## 라이선스

MIT
