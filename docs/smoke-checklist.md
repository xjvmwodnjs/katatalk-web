# Smoke Result UI Harness v1

목적: 내부 베타 smoke에서 completed job 결과 화면을 안정적으로 열고, board/winrate/learningEvents/PV/try-play를 수동 확인한다.

## Local Auth Smoke

Vite의 `VITE_*` 값은 dev server 시작 시점에 client bundle로 주입된다. 기존 dev server가 Clerk 설정으로 이미 떠 있으면 shell에서 `VITE_AUTH_PROVIDER=local-dev`를 다시 설정해도 기존 bundle은 바뀌지 않는다.

절차:

1. 기존 Web/Worker dev server를 모두 종료한다.
2. `VITE_AUTH_PROVIDER=local-dev`와 `AUTH_PROVIDER=local-dev`를 설정한 상태로 Web을 새로 시작한다.
3. 같은 env로 Worker를 새로 시작한다.
4. 브라우저에서 dev server가 출력한 실제 port로 접속한다.
5. 상단에 `로그아웃`이 보이고 `/api/trpc/auth.me`가 200이면 local-dev auth가 반영된 상태다. `로그인`이 보이면 이전 Clerk bundle/server를 보고 있는 것이므로 dev server를 완전히 종료한 뒤 다시 시작한다.

Windows PowerShell:

```powershell
$env:AUTH_PROVIDER="local-dev"
$env:VITE_AUTH_PROVIDER="local-dev"
$env:ANALYSIS_ENGINE="katago"
$env:ANALYSIS_WORKER_MODE="external"
$env:KATATALK_ALLOW_MOCK_ANALYSIS="false"
$env:KATAGO_MAX_VISITS="200"
$env:KATAGO_MULTI_TURN_MAX="6"
$env:KATAGO_WINRATE_TIMELINE_ENABLED="false"
$env:KATAGO_DEEP_SEARCH_ENABLED="false"
corepack pnpm dev
```

Worker는 별도 터미널에서 실행하므로 env를 다시 설정해야 한다.

```powershell
$env:AUTH_PROVIDER="local-dev"
$env:VITE_AUTH_PROVIDER="local-dev"
$env:ANALYSIS_ENGINE="katago"
$env:ANALYSIS_WORKER_MODE="external"
$env:KATATALK_ALLOW_MOCK_ANALYSIS="false"
$env:KATAGO_MAX_VISITS="200"
$env:KATAGO_MULTI_TURN_MAX="6"
$env:KATAGO_WINRATE_TIMELINE_ENABLED="false"
$env:KATAGO_DEEP_SEARCH_ENABLED="false"
corepack pnpm dev:worker
```

macOS/Linux shell:

```bash
AUTH_PROVIDER=local-dev \
VITE_AUTH_PROVIDER=local-dev \
ANALYSIS_ENGINE=katago \
ANALYSIS_WORKER_MODE=external \
KATATALK_ALLOW_MOCK_ANALYSIS=false \
KATAGO_MAX_VISITS=200 \
KATAGO_MULTI_TURN_MAX=6 \
KATAGO_WINRATE_TIMELINE_ENABLED=false \
KATAGO_DEEP_SEARCH_ENABLED=false \
corepack pnpm dev
```

Worker는 별도 터미널에서 같은 env로 실행한다.

```bash
AUTH_PROVIDER=local-dev \
VITE_AUTH_PROVIDER=local-dev \
ANALYSIS_ENGINE=katago \
ANALYSIS_WORKER_MODE=external \
KATATALK_ALLOW_MOCK_ANALYSIS=false \
KATAGO_MAX_VISITS=200 \
KATAGO_MULTI_TURN_MAX=6 \
KATAGO_WINRATE_TIMELINE_ENABLED=false \
KATAGO_DEEP_SEARCH_ENABLED=false \
corepack pnpm dev:worker
```

Worker 로그에서 아래 형태를 확인한다. 실제 path/secret 값은 출력하지 않는다.

```text
[analysis-config] engine=katago workerMode=external deepSearch=false timeline=false maxVisits=200 multiTurnMax=6
```

`KATAGO_MULTI_TURN_MAX=6`은 smoke에서 final position 외 후보 분석 여지를 남기기 위한 값이다. 후보 분석 수가 너무 적으면 completed result가 final_position 중심으로 끝나 learningEvents chip 확인이 어려울 수 있다.

## Local Smoke Credit Bootstrap

이 절차는 local smoke 또는 격리된 staging 전용이다. production/live 결제 환경에서 사용하지 않는다. 실행 전 반드시 연결된 Supabase URL/프로젝트가 local 또는 staging DB인지 확인한다.

권장 순서:

1. 먼저 `GET /api/credits/me`로 현재 local-dev credit을 확인한다.
2. credit이 0이면 service-role 또는 권한 있는 Supabase SQL editor/콘솔에서만 기존 RPC를 사용해 local smoke credit을 지급한다.
3. schema 변경, migration 추가, 결제 webhook 우회 코드는 만들지 않는다.
4. production/live DB에서는 아래 RPC를 실행하지 않는다.

예시 RPC:

```sql
select public.add_credits_from_payment(
  'non-clerk:local-dev-user',
  5,
  'local-smoke:2026-05-16',
  'local-smoke',
  null,
  null,
  null,
  'Local smoke credit bootstrap'
);
```

동일 `idempotency_key`는 중복 지급 방지에 사용된다. 반복 smoke를 위해서는 날짜나 run id를 포함한 새 local-only key를 사용한다.

## LearningEvents Smoke SGF Fixture

final position 후보만 나오는 너무 짧은 SGF는 learningEvents 후보 chip 확인에 부적합하다. 아래 SGF는 21수 smoke용이며 parser validation 통과 확인용 fixture다. 기본 `intervalStep=20`, `includeFinalPosition=true` 기준으로 `turnIndex=20`은 non-final 샘플 후보, `turnIndex=21`은 `final_position` 후보가 된다. 현재 코드에서는 20수가 `opening_sample`로 기록되며, 이는 final position이 아니므로 learningEvents 후보 chip smoke에 사용할 수 있다.

```sgf
(;FF[4]GM[1]SZ[19]KM[6.5];B[pd];W[dp];B[pp];W[dd];B[fq];W[cn];B[qf];W[dc];B[cf];W[fc];B[jj];W[qq];B[qd];W[dq];B[oc];W[co];B[pc];W[cp];B[qn];W[dn];B[jp])
```

기대 결과:

- `turnIndex=20`: non-final 후보. 현재 reason은 `opening_sample`.
- `turnIndex=21`: `final_position` 후보.
- learningEvents는 `final_position`을 제외하므로 `turnIndex=20` 기반 후보 chip smoke가 가능하다.
- 실제 learningEvents 생성 여부는 KataGo 결과와 수치 신호에 따라 달라질 수 있으므로, completed result에서 후보 chip이 1개 이상인지 반드시 확인한다.

## Result Deep Link Smoke

1. local-dev auth가 반영된 Web/Worker를 실행한다.
2. SGF를 업로드해 completed job id를 확보한다.
3. 같은 사용자 세션에서 `/?jobId=<completedJobId>` 또는 `/?analysisJobId=<completedJobId>`로 접속한다.
4. 서버의 기존 `GET /api/analyze/:jobId` owner check를 통과한 경우에만 결과가 표시되어야 한다.
5. 로그아웃 상태는 로그인 요구로 안전하게 fallback되어야 한다.
6. failed/running 상태는 기존 loading/error UI로 안전하게 처리되어야 한다.
7. 가능하면 다른 사용자 세션에서 같은 job id 접근 시 403을 확인한다.

## Result UI Manual Checklist

- `/?jobId=<completedJobId>` 접속
- board 표시
- winrate graph 표시
- learningEvents 후보 chip 표시
- 후보 클릭 -> AI 메모 갱신
- 참고도 보기 -> PV overlay
- 전체 수순으로 돌아가기
- try-play 진입
- try-play 빈 상태에서 mainline 후보 marker 없음
- try-play 돌 놓기
- try-play undo
- try-play reset

Viewport:

- `390x844`
- `430x932`
- `768x1024`
- `1440x900`
