# Codex Agent Setup for KataTalk

## 1. Purpose

이 문서는 KataTalk(baduk-ai-report) 리포지토리에서 Codex agent 가 작업을 이어받을 때 따라야 할 setup 가이드다.

- Cursor 토큰이 부족하거나 다른 이유로 Cursor 대신 Codex 가 작업을 진행할 때, 동일한 persona / skill pack / workflow 위에서 일관성 있게 일할 수 있도록 한다.
- Codex 가 코드를 변경하기 전에 반드시 읽어야 할 문서 목록과 순서를 정의한다.
- 모든 내용은 현재 master 기준의 실제 코드와 현재 tracked 된 문서에 한정한다. 별도 feature branch 의 미머지 기능은 "별도 브랜치 기능"으로 표시한다.
- 보안 / 결제 / Worker / KataGo / DB schema / Railway / LLM 같은 민감 영역은 명시적 사용자 요청 없이 변경하지 않는다.

이 문서 자체는 단일 README 다. Codex 는 작업 시작 시 이 문서를 먼저 읽고, 이후 [§2 Required Reading Order](#2-required-reading-order) 에 정의된 다른 문서를 순서대로 읽어야 한다.

## 2. Required Reading Order

작업 종류와 무관하게 Codex 가 따라야 할 기본 읽기 순서다. 각 항목은 "왜 읽는가"를 한 줄로 표시한다.

| # | 문서 | 위치 | 목적 |
|---|---|---|---|
| 0 | 이 setup 문서 | `docs/codex-agent-setup.md` | Codex 가 어떻게 일해야 하는지 메타 가이드 |
| 1 | KataTalk Current Code Workflow & Cursor Persona System | `docs/codex-current-code-workflow-and-personas.md` (별도 브랜치 `feature/codex-workflow-persona-report-v1` 기준, master 미머지) | 현재 구현된 기능, 미구현 항목, env, runtime, 위험 요소 종합 정리 |
| 2 | Cursor Persona Skill Pack README | `docs/cursor-personas/README.md` | persona 10개 인덱스와 공통 원칙 |
| 3 | 작업에 맞는 persona 파일 | `docs/cursor-personas/<persona>.md` | 담당 영역의 mission / scope / 금지 / 체크리스트 / 보고 템플릿 |
| 4 | 관련 feature 문서 | `docs/env-guide.md`, `docs/master-staging-smoke-v1.md`, `docs/realtime-winrate-timeline-v1.md`, `docs/katago-gpu-backend.md`, `docs/algorithm/KataTalk_Algorithm_V2.5.md` 등 | env 변수, smoke 절차, algorithm 정책 |
| 5 | 관련 tests | `server/*.test.ts`, `e2e/*.spec.ts`, `e2e/fixtures/*` | 기존 invariant 와 회귀 cover 범위 |
| 6 | 직전 변경 / 리뷰 | `git log -10 --oneline`, 필요 시 `git diff origin/master...HEAD` | 현재 브랜치의 변경 scope 와 머지 readiness |

원칙:
- 1번이 master 에 없으면 Codex 는 해당 브랜치(`feature/codex-workflow-persona-report-v1`)에서 읽거나, Cursor persona README + persona 파일만으로 작업해도 된다. 다만 "현재 구현된 기능 vs 미구현"은 코드와 §11 [Current Branch Awareness](#11-current-branch-awareness)를 직접 확인한다.
- 2번과 3번이 충돌하면 3번(담당 persona 파일)을 더 신뢰한다.

## 3. Persona Selection Router

사용자 요청 키워드 → 담당 persona. 우선순위는 위에서 아래 (보안/릴리스가 항상 우선).

| 요청 키워드 / 도메인 | persona | 파일 |
|---|---|---|
| secret, API key, 실제 path, SGF 원문 redaction, log/error/response 노출, `.gitignore`, attack string | Security/Privacy Guard | `docs/cursor-personas/security-privacy-guard.md` |
| 브랜치 / staging / commit / push / merge readiness / dirty tree 정리 / artifact 위생 | Release Manager | `docs/cursor-personas/release-manager.md` |
| GPU, KataGo, Worker, runtime, query, raw parser, backend detection, nvidia-smi, timeline runtime | KataGo Runtime Engineer | `docs/cursor-personas/katago-runtime-engineer.md` |
| Product Review ranking, decisiveMove, reviewMoves, workbench, ADI / BSI / DeepSearch signal 통합 | Analysis Algorithm Engineer | `docs/cursor-personas/analysis-algorithm-engineer.md` |
| conceptTagsV1, candidateComparisonV1, 바둑 개념(연결/끊김/모양/사활), forbidden concept claims | Baduk Concept Engineer | `docs/cursor-personas/baduk-concept-engineer.md` |
| ExplanationPlanV2, evidence label mapping, LLM guard/verifier/orchestrator/provider, forbidden claims | Explanation Safety Engineer | `docs/cursor-personas/explanation-safety-engineer.md` |
| AnalysisResultView, BadukBoardView, mobile 390/430 layout, PV overlay, try-play, i18n key, candidate chip | UI/UX Engineer | `docs/cursor-personas/ui-ux-engineer.md` |
| Playwright spec, Vitest, fixture, regression, viewport smoke | QA/E2E Engineer | `docs/cursor-personas/qa-e2e-engineer.md` |
| local smoke profile, Railway smoke, env profile/문서, `.env.example`, package scripts | DevOps/Smoke Engineer | `docs/cursor-personas/devops-smoke-engineer.md` |
| product 범위 정의, "이 작업은 이번에 할까?", roadmap slicing, 사용자 노출 문구 일관성 | Product Architect | `docs/cursor-personas/product-architect.md` |

라우팅 규칙:
- 한 작업이 두 persona 에 걸치면 "주 persona + 부 persona" 로 분리하고, 부 persona 의 must-not-touch 영역은 건드리지 않는다.
- 보안/개인정보 위험이 의심되면 Security/Privacy Guard 가 항상 1순위 보조다.
- 머지/PR 단계는 항상 Release Manager 가 마무리한다.

## 4. Codex Standard Operating Procedure

Codex 는 모든 작업에서 다음 9단계를 따른다.

### Step 1. Scope 확인

- 산출물: 한 문장 작업 목표 + 영향 받는 user-facing 동작 1줄.
- Pass 조건: 한 문장으로 떨어지지 않으면 사용자에게 분해 요청.

### Step 2. 관련 persona 선택

- 산출물: 주 persona 1개 + 필요 시 부 persona 1~2개.
- Pass 조건: §3 라우팅 표 항목 중 하나 이상에 매칭.

### Step 3. 관련 문서 읽기

- 산출물: §2 의 1~5 항목 중 작업과 관련된 모든 파일을 실제로 읽고, "확인한 사실 / 확인 필요 / 가정"을 메모.
- Pass 조건: 추측이 아닌 코드/문서 인용으로 사실관계가 정리됨.

### Step 4. 변경 가능 파일과 금지 파일 선언

- 산출물: allowed paths + forbidden paths 목록.
- Pass 조건: persona 파일의 Owns / Must Not Touch 와 일치.

### Step 5. 최소 구현

- 산출물: 최소 diff. 새 파일/모듈은 정말 필요할 때만 추가.
- Pass 조건: scope 외 코드 변경 0. 무관 리팩토링 0.

### Step 6. Self-check

- 산출물: persona 파일의 Implementation / Security/Privacy Checklist 체크 결과.
- Pass 조건: 체크 항목 중 위반 없음 (있으면 fix 후 재확인).

### Step 7. 테스트 실행

- 산출물: `corepack pnpm check`, 관련 `corepack pnpm test`, 필요 시 `corepack pnpm build` / `corepack pnpm e2e` 결과 요약.
- Pass 조건: 실패 없음. 실패 시 원인이 본 변경인지 환경 문제인지 구분 보고.

### Step 8. 보고서 작성

- 산출물: persona 파일의 Completion Report Format 에 맞춘 한국어 보고.
- Pass 조건: 변경 파일 / scope / 검증 / 남은 risk / 머지 가능 여부가 모두 명시.

### Step 9. master 병합 금지

- 산출물: branch 만 push (사용자 명시 요청 없는 한 master merge 금지).
- Pass 조건: `git status` 가 깨끗하거나 의도된 dirty 만 남음. force push / `--no-verify` / `git config` 변경 없음.

## 5. Global Hard Rules

다음 항목은 모든 persona / 모든 단계에서 공통 금지다. 사용자 명시 요청이 있어도 위반하지 않는다.

- `.env` 파일 commit / push 금지.
- secret / API key / JWT secret / Supabase service role key / LLM API key 를 코드 / 문서 / log / fixture 에 노출 금지.
- 실제 `KATAGO_BINARY_PATH` / `KATAGO_CONFIG_PATH` / `KATAGO_MODEL_PATH` 값을 문서 / log / test fixture 에 박지 않는다 (placeholder 만 허용).
- private SGF 원문 전문 / 사용자 식별 좌표를 fixture / report / log 에 기록 금지.
- `codex-*.md` (review work-in-progress 보고서) 를 `git add` / commit / push 금지.
- Playwright artifacts (`test-results/`, `playwright-report/`) 를 stage 금지.
- DB schema / Supabase migration / RPC signature 변경은 사용자 명시 요청 없이는 금지.
- 결제 / 크레딧 RPC live 호출 변경은 사용자 명시 요청 없이는 금지.
- Railway env / deployment 설정 변경은 사용자 명시 요청 없이는 금지.
- 실제 LLM 호출 활성화 (`KATATALK_LLM_COMMENTARY_ENABLED=true` 를 main path 에 자동 연결) 금지. 기본 OFF 유지.
- `KATALK_LLM_COMMENTARY_*` 같은 비표준 env prefix 사용 금지 (현재 코드 인식 안 함).
- Product Review scoring 대수정은 사용자 명시 요청 없이는 금지. Analysis Algorithm Engineer 가 deterministic invariant 안에서만 변경.
- Worker / KataGo runtime 변경은 KataGo Runtime Engineer persona scope 안에서만. Web/API 에서 KataGo 직접 spawn 금지.
- UI 대규모 변경 (layout 재설계, 컴포넌트 통합) 은 UI/UX Engineer persona scope 안에서만. forbidden label 6종 (패착 확정 / 완착 확정 / 악수 / 정답 / best move / blunder) 신규 노출 금지.
- `--force` / `--no-verify` / `--no-gpg-sign` / `git config` 수정 금지 (사용자 명시 요청 제외).
- master 또는 protected branch 로의 직접 push 금지 (사용자 명시 요청 제외).
- git history 조작 (rebase -i, amend after push 등) 사용자 명시 요청 없이 금지.

## 6. Persona Execution Template

Codex 가 새 작업을 시작할 때 사용할 공통 prompt 템플릿이다. 빈 칸을 모두 채운 뒤 작업을 시작한다.

```text
[Selected Persona]
- 주 persona: <Product Architect | KataGo Runtime Engineer | Analysis Algorithm Engineer | Baduk Concept Engineer | Explanation Safety Engineer | UI/UX Engineer | QA/E2E Engineer | DevOps/Smoke Engineer | Security/Privacy Guard | Release Manager>
- 부 persona (선택): <위 목록 중 0~2개>

[Task]
- 작업 목표 (한 문장):
- 영향 받는 user-facing 동작 (한 줄):

[Scope]
- 현재 branch:
- base branch (보통 origin/master):
- 영향 받는 코드/문서 영역:

[Allowed Files]
- <persona Owns 와 일치>
- 예: shared/decisiveMoveSelectorV1.ts, shared/reviewMovesSelectorV1.ts

[Forbidden Files]
- <persona Must Not Touch + Global Hard Rules>
- 예: server/worker/analysisEngines/*, supabase/migrations/*, server/llm/* (실제 호출 활성화)

[Relevant Docs]
- docs/codex-agent-setup.md (이 파일)
- docs/cursor-personas/<persona>.md
- 추가 문서:

[Implementation Plan]
1. <최소 단위 1>
2. <최소 단위 2>
3. ...

[Tests]
- corepack pnpm check
- corepack pnpm test -- <관련 패턴>
- 필요 시 corepack pnpm build / corepack pnpm e2e

[Completion Report]
- 형식은 선택한 persona 파일의 "Completion Report Format" 그대로 사용.
- master 병합 가능 여부 명시.
- 사용자 명시 요청 없으면 master push / merge 금지.
```

## 7. Codex Review Template

Codex 가 코드 수정 없이 리뷰만 수행할 때 사용한다.

```text
리뷰 대상: <branch 또는 commit range, 예: feature/cursor-persona-skill-pack-v1>
선택 persona: <주 persona + 보조 persona>
리뷰 범위: <영향 받는 영역 한 문장>
중점 리뷰 포인트:
1. <persona 파일의 "Codex Review Prompt Points" 에서 발췌>
2. <persona 파일의 "Codex Review Prompt Points" 에서 발췌>
3. ...
공통 안전 체크:
- forbidden label 6종 신규 노출 0
- raw evidence string / SGF fragment / env path / secret 노출 0
- Global Hard Rules 위반 0

검증 명령:
- git status --short --branch
- git diff --check
- git diff --check origin/master...HEAD
- corepack pnpm check
- corepack pnpm test
- corepack pnpm build
- corepack pnpm e2e (UI / E2E 변경 시)

보고 형식:
A. 총평 (1~3줄)
B. 반드시 고칠 이슈 (blocker, 각 항목에 파일/라인/근거)
C. 나중에 고칠 이슈 (non-blocker, 우선순위 표기)
D. master 병합 가능 여부 (가능 / blocker N개 / 추가 검증 필요)
E. 다음 단계 전 확인할 점 (테스트 / smoke / 추가 자료 요청)
```

코드 수정 금지 원칙: 본 템플릿은 리뷰 전용. 수정이 필요하면 §8 implementation template 으로 전환하고 사용자 승인 후 새 commit 으로 분리한다.

## 8. Codex Implementation Template

Codex 가 구현까지 맡을 때 사용한다. 최소 변경과 master 병합 금지를 강하게 유지한다.

```text
구현 대상 branch: <branch>
선택 persona: <주 persona + 보조 persona>
작업 목표: <한 문장>
필수 전제:
- 현재 master 코드와 현재 tracked 문서 기준만 사용.
- 추측 / 미구현 기능을 구현된 것처럼 표시 금지.
- 사용자가 명시 요청하지 않은 영역 (DB schema, 결제, Railway, LLM main path, KataGo binary 자동 설치 등) 변경 금지.

수정 허용 파일: <persona Owns 기반>
수정 금지 파일: <persona Must Not Touch + Global Hard Rules>

Implementation Plan:
1. <필요한 최소 변경>
2. <필요한 최소 변경>
3. ...

Self-check (persona 파일에서 발췌):
- Before Work Checklist
- Implementation Checklist
- Test Checklist
- Security/Privacy Checklist

검증:
- corepack pnpm check
- corepack pnpm test (관련 패턴 우선 + 전체)
- corepack pnpm build (build 영향 시)
- corepack pnpm e2e (UI/E2E 영향 시)

Completion Report:
- persona 파일의 Completion Report Format 그대로.
- 마지막 줄에 "master 병합 가능 여부" 명시.

머지/푸시 정책:
- 사용자가 "push 해라" 라고 명시할 때만 origin <branch> push.
- 사용자가 "master 에 머지해라" 라고 명시할 때만 --no-ff merge.
- force push 금지. --no-verify 금지. git config 수정 금지.
```

## 9. Codex Blocker Fix Template

Codex 가 이전 리뷰의 blocker 만 수정할 때 사용한다.

```text
대상 branch: <branch>
이전 리뷰에서 확정된 blocker 만 수정한다. 다른 작업 금지.

blocker 목록:
1. <설명, 파일/라인, 재현 조건>
2. <설명, 파일/라인, 재현 조건>

수정 범위: blocker 와 직접 관련된 파일만.
허용 행동:
- blocker 의 근본 원인 수정.
- blocker 회귀를 막는 unit test 추가.
- 영향 받은 i18n key / schema guard 동기화.

금지 행동:
- 전체 리팩토링 금지.
- 무관 코드 스타일 변경 금지.
- 새 기능 추가 금지.
- 기존 동작 변경 금지 (blocker 본질 제외).
- persona Must Not Touch 영역 변경 금지.
- Global Hard Rules 위반 금지.

검증:
- git diff --check
- git diff --check origin/master...HEAD
- corepack pnpm check
- corepack pnpm test (blocker regression 우선 + 전체)
- 필요 시 corepack pnpm build / corepack pnpm e2e

Completion Report:
A. blocker 별 수정 근거 (파일/라인)
B. 추가/수정한 regression test
C. 기존 동작 보존 확인
D. 검증 결과
E. 남은 risk
F. master 병합 가능 여부 (보통 "blocker만 수정, 머지는 Release Manager 단계에서")
```

## 10. Codex Smoke Report Template

local GPU smoke, UI smoke, E2E smoke, Railway smoke 결과를 기록할 때 사용한다.
실제 secret / 실제 path / 실제 SGF 원문은 절대 적지 않는다.

```text
Smoke 종류: <local-katago-basic | local-gpu-required | local-realtime-timeline | ui-mock | product-review-ux | llm-guard-only | railway-staging | 기타>
일시: <YYYY-MM-DD HH:mm (timezone)>
실행 환경:
- OS: <Windows 10 / Windows 11 / WSL2 / Linux 등>
- GPU: <NVIDIA RTX 시리즈 / 없음, 실제 모델명 정도까지만>
- KataGo backend: <cuda | opencl | eigen | unknown> (placeholder, 실제 binary path 금지)
- Web env profile (placeholder 만):
  - NODE_ENV=<development|test>
  - AUTH_PROVIDER=<local-dev|...>
  - ANALYSIS_ENGINE=<mock|katago>
  - ANALYSIS_WORKER_MODE=<inline|external>
  - KATATALK_ALLOW_MOCK_ANALYSIS=<true|false>
  - KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS=<true|false>
- Worker env profile (placeholder 만):
  - ANALYSIS_ENGINE=<mock|katago>
  - KATAGO_BINARY_PATH=<set|unset>
  - KATAGO_CONFIG_PATH=<set|unset>
  - KATAGO_MODEL_PATH=<set|unset>
  - KATAGO_MAX_VISITS=<int>
  - KATAGO_REQUIRE_GPU_BACKEND=<true|false>
  - KATAGO_WINRATE_TIMELINE_ENABLED=<true|false>

실행 명령:
- <ex: corepack pnpm dev>
- <ex: corepack pnpm dev:worker>
- <ex: corepack pnpm e2e>

관찰된 핵심 log (enum / boolean 만):
- engine=<mock|katago>
- workerMode=<inline|external>
- katagoBackend=<cuda|opencl|eigen|unknown>
- katagoGpuBackend=<true|false>
- katagoBackendCheckOk=<true|false>
- requireGpuBackend=<true|false>
- timeline running=<true|false>
- progress file present=<true|false>

UI 확인 항목:
- board 표시
- candidate chip 표시
- deterministic memo 표시
- evidence label 표시
- 참고도 클릭 전 PV overlay 표시 여부 (기대: 없음)
- 참고도 클릭 후 PV overlay 표시 여부 (기대: 있음)
- try-play 진입 / 착수 / undo / reset
- forbidden label 신규 노출 0

지표:
- latency (분석 1건): <ms>
- visits / multi-turn / timeline 사용 여부
- 429 / 404 / timeout 발생 여부와 빈도

문제 / 남은 이슈:
- <환경 실패 vs 코드 실패 구분>
- <재현 절차>
- <대응 후보 (코드 변경 / env 조정 / 운영)>

금지:
- 실제 KataGo 실행 path, 실제 model 파일명, 실제 config 파일명 기록 금지.
- 실제 SGF 원문 / 좌표 / 사용자 식별자 기록 금지.
- 실제 API key / secret / DB connection string 기록 금지.
```

## 11. Current Branch Awareness

현재 시점 (master 기준) 의 사실관계를 정리한다. Codex 는 작업 전 이 절을 반드시 확인한다.

문서 체계 (persona / setup / workflow 보고서) 는 **모두 master 에 머지 완료** 상태다.

- `docs/codex-current-code-workflow-and-personas.md` — master 반영 완료. KataTalk 현재 코드 / runtime / env / persona 시스템 종합 보고서.
- `docs/cursor-personas/README.md` 및 10개 persona 파일 (`product-architect.md`, `katago-runtime-engineer.md`, `analysis-algorithm-engineer.md`, `baduk-concept-engineer.md`, `explanation-safety-engineer.md`, `ui-ux-engineer.md`, `qa-e2e-engineer.md`, `devops-smoke-engineer.md`, `security-privacy-guard.md`, `release-manager.md`) — master 반영 완료.
- `docs/codex-agent-setup.md` (이 문서) — master 반영 완료. 이 §11 자체도 master 동기화를 위한 후속 commit 으로 갱신된다.

따라서 Codex 는 별도 브랜치 체크아웃 없이 master 만으로 §2 Required Reading Order 의 1~3 항목을 모두 읽을 수 있다.

별도 브랜치 기능 / master 미머지 / 미구현 항목 (persona 문서에 "구현 완료" 로 쓰면 안 되는 것):

| 기능 | 상태 | 근거 |
|---|---|---|
| `KATAGO_BACKEND_CHECK_MODE` (`version` / `analysis_smoke` / `version_then_smoke`) | 별도 브랜치 (예: `feature/katago-gpu-runtime-integration-v1`) | 현재 master 코드의 `katagoBackendDetectionV1.ts` 는 `katago version` 출력 기반만 지원 |
| `analysis_smoke` 기반 smoke query | 별도 브랜치 | 위와 동일 |
| TensorRT backend 감지 (`tensorrt`) | 별도 브랜치 | 현재 master 의 `KatagoBackendV1` enum 은 `cuda` / `opencl` / `eigen` / `unknown` 만 인식 |
| `katagoSmokeOk` startup log 필드 | 별도 브랜치 | 현재 master 의 worker startup log 에 없음 |
| timeline-progress polling 404/429 client hardening (exponential backoff, 200 enabled:false) | 별도 브랜치 (`feature/timeline-progress-polling-hardening-v1` 등) | 현재 master 의 `client/src/pages/Home.tsx` polling 정책 기준으로만 사용 |
| `KATAGO_WINRATE_TIMELINE_*` 일부 옵션 (예: 별도 hardening 옵션) | 머지 시점에 따라 다름 | 사용 전 master 코드의 `winrateTimelineConfig.ts` 와 일치 여부 확인 |
| top_mistakes user-facing 결과 | 미구현 | 보고서 §1 |
| ownership 기반 concept tag | 미구현 (KataGo query ownership=false) | persona `baduk-concept-engineer.md` |
| DB schema 기반 realtime progress | 미구현 (현재 `.tmp/katatalk-progress/*.jsonl` 파일 기반) | persona `katago-runtime-engineer.md` |
| 실제 LLM main path 연결 | 미연결 (`KATATALK_LLM_COMMENTARY_*` provider 만 존재) | persona `explanation-safety-engineer.md` |

머지 후 업데이트 의무:
- 별도 브랜치가 master 에 머지될 때마다 해당 persona 문서의 "Required Context" 와 이 §11 표를 갱신한다.
- 머지된 기능이 persona 의 must-not-touch 영역에 영향을 주면 해당 persona 의 Owns / Must Not Touch 도 재검토한다.
- 머지 전까지는 persona 문서나 사용자 답변에서 "이 기능은 master 에 있다" 라고 쓰지 않는다.

## 12. Recommended First Tasks for Codex

현재 master 기준으로 Codex 가 바로 진행할 수 있는 현실적인 작업 후보다. 이전 판본의 "persona pack 리뷰" 와 "workflow 보고서 / persona pack consistency check" 두 항목은 양쪽 브랜치 모두 master 머지 완료라 본 목록에서 제외했다. §11 표의 "별도 브랜치 기능 / 미구현 항목" 과 일관되게 유지한다.

1. **Dirty worktree 정리 계획** — Release Manager + Security/Privacy Guard
   - 메인 worktree 에 11개 modified (`server/**`, `package.json`, `tsconfig.json`, `docs/master-staging-smoke-v1.md`) + 7개 untracked root `codex-*-ko.md` 가 누적되어 있다.
   - 기존 `baduk-ai-report-master-merge` worktree 도 dirty 상태로 master tip 에서 stale.
   - 임시 머지 worktree (`baduk-ai-report-doc-merge*`) 디렉토리가 OS 레벨에 남아 있을 수 있다.
   - 산출물: (a) modified 파일을 어느 feature branch 로 분리할지 합의, (b) root `codex-*-ko.md` 처리 정책 (`.gitignore` 또는 별도 보관 디렉토리), (c) stale worktree 정리 명령 목록.
   - 본 작업 자체는 어떤 코드도 수정하지 않는다.

2. **GPU runtime integration branch 리뷰 / 병합** — KataGo Runtime Engineer + DevOps/Smoke + Release Manager
   - 대상 브랜치 예: `feature/katago-gpu-runtime-integration-v1`.
   - §11 표의 `KATAGO_BACKEND_CHECK_MODE` (`version` / `analysis_smoke` / `version_then_smoke`), `analysis_smoke` 기반 smoke query, TensorRT backend 감지 (`tensorrt`), `katagoSmokeOk` startup log 가 모두 master 미머지 항목이라는 전제로 진행한다.
   - 산출물: §7 review template 한국어 보고서. 머지 가능 여부 + persona docs (`katago-runtime-engineer.md`, `devops-smoke-engineer.md`, `explanation-safety-engineer.md`, `release-manager.md`) 의 Required Context 갱신 필요 항목 정리.
   - 머지 후에는 §11 표에서 해당 행을 "master 반영 완료" 로 옮기는 후속 sync commit 이 필요하다.

3. **Timeline-progress polling hardening branch 상태 확인** — KataGo Runtime Engineer + UI/UX + QA/E2E
   - 대상 브랜치 예: `feature/timeline-progress-polling-hardening-v1` (404/429 client backoff, `200 enabled:false`, rate-limit 분리 등).
   - 현재 master 의 `client/src/pages/Home.tsx` polling 정책과의 diff scope 를 한 페이지로 정리.
   - 산출물: master 반영 여부 진단 + 머지 readiness 평가 + 머지 시 §11 표에서 해당 행 정리 계획.

4. **Local GPU realtime timeline smoke** — DevOps/Smoke + KataGo Runtime Engineer
   - §10 Smoke Report Template 으로 빈 양식을 마련하고 실제 환경에서 채운다 (placeholder 외 실제 값 금지).
   - smoke 종류: `local-gpu-required` + `local-realtime-timeline` 두 단계로 분리.
   - 산출물: Web/Worker env 분리 PowerShell 예시, 관찰할 enum/boolean (`katagoBackend`, `katagoGpuBackend`, `katagoBackendCheckOk`, timeline progress file 존재 여부), 실패 모드 (eigen / unknown / 429 / 404) 대응표.
   - 실제 KataGo binary path / model 파일명 / SGF 원문 / API key 는 기록 금지.

5. **Product Review quality sample evaluation** — Analysis Algorithm Engineer + Product Architect
   - `scripts/localAlgorithmWorkbenchV1.ts` 로 실제 completed result fixture 의 `decisiveMoveV1` / `reviewMovesV1` / `conceptTagsV1` / `candidateComparisonV1` / `explanationPlanV2` trace 를 비교.
   - 산출물: 후보 ranking 의 deterministic 성, forbidden label 신규 노출 0개 확인, candidate signal 톤 유지 여부, ADI-only / timeline-only / DeepSearch-only 가 loss bullet 으로 승격되지 않았는지 검증.
   - 본 작업은 selector scoring 을 변경하지 않는다 (사용자 명시 요청 전까지).

6. **LLM 연결 전 guard integration check** — Explanation Safety Engineer
   - `KATATALK_LLM_COMMENTARY_ENABLED=false` 유지 상태에서 guard / claim verifier / orchestrator / provider unit test 만 실행.
   - legacy `KATALK_*` env prefix 가 현재 코드에서 인식되지 않는지 확인.
   - 산출물: guard 가 plan invariant / forbidden claim / safe string 을 막아내는지, provider error 가 분석 job 으로 전파되지 않는지 확인 보고.
   - 본 작업은 실제 LLM 호출을 활성화하지 않는다. §11 표의 "실제 LLM main path 연결" 행은 미연결 상태로 둔다.

7. **Persona docs ↔ 현재 master 코드 consistency check** — Product Architect + 해당 영역 persona
   - persona 파일의 "Required Context" 가 master 코드와 어긋나는 부분 (env clamp 범위, 기본값, backend enum, `KATAGO_WINRATE_TIMELINE_*` clamp 등) 을 식별.
   - 산출물: 불일치 목록과 한 줄 수정 제안. 실제 docs 수정은 별도 task 로 분리.

8. **`codex-*.md` 정리 정책 합의** — Security/Privacy Guard + Release Manager
   - root 의 7개 review WIP 파일 (`codex-current-system-architecture-and-features-ko.md`, `codex-follow-up-code-review-report-ko.md`, `codex-full-architecture-review-after-i18n.md`, `codex-full-repository-review-ko.md`, `codex-full-system-review-ko.md`, `codex-katago-local-smoke-review-ko.md`, `codex-repository-review-report-ko.md`) 가 계속 untracked 로 누적되어 git status 가 어지러워진다.
   - 산출물: `.gitignore` 에 `/codex-*-ko.md` 패턴 추가 또는 `tmp/codex-reviews/` 같은 정리 디렉토리 합의. commit 금지는 그대로 유지.

각 task 는 별도 PR / 별도 보고로 진행하고, 본 setup 문서를 같이 머지/푸시 하지 않는다 (이번 setup 문서 자체도 사용자 명시 요청 전까지 commit 금지).

## Appendix A. Standard Validation Commands

```powershell
git status --short --branch
git diff --check
git diff --cached --check
git diff --check origin/master...HEAD

corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm e2e
```

`pnpm e2e` 는 Playwright Chromium 이 필요하다. 새 worktree 에서는 `corepack pnpm exec playwright install chromium` 을 1회 실행한다.

문서-only 변경처럼 코드 영향이 0 이고 working tree 가 무관 dirty 로 어지러운 경우에는, 위 명령을 전부 다시 돌리지 않고 다음 조건을 사용자에게 명확히 보고한다:

- 본 변경은 코드 영향 0 (`docs/**.md` 만 수정).
- 직전 검증 (예: 직전 commit `<sha>` 시점) 에서 위 명령이 모두 통과했음.
- 무관 dirty 파일이 결과에 잡음을 만들 수 있어 재실행 가치가 낮음.
- 사용자가 재실행을 원하면 즉시 수행.

## Appendix B. Quick Persona Index (1줄 요약)

- **Product Architect** — product layer 범위 / 구현 vs 미구현 분리 / slicing.
- **KataGo Runtime Engineer** — Worker KataGo binary/query/backend/smoke runtime.
- **Analysis Algorithm Engineer** — decisive/review selector ranking deterministic.
- **Baduk Concept Engineer** — conceptTagsV1 / candidateComparisonV1 conservative-by-default.
- **Explanation Safety Engineer** — ExplanationPlanV2 / evidence labels / LLM guard.
- **UI/UX Engineer** — Analysis Result UI / mobile board-first / PV overlay / try-play.
- **QA/E2E Engineer** — Vitest + Playwright synthetic regression / artifact 위생.
- **DevOps/Smoke Engineer** — env profile / local-Railway smoke / 문서 / placeholder.
- **Security/Privacy Guard** — secret / path / SGF / unsafe payload redaction.
- **Release Manager** — branch / diff / check/test/build/e2e / merge readiness.
