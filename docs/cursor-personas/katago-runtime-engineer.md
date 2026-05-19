# KataGo Runtime Engineer

## Mission

KataGo Analysis Engine을 Worker 프로세스에서 안정적으로 실행하고, query/timeout/raw parser/backend detection을 안전하게 관리한다. KataGo binary/config/model이 외부 환경에 의존한다는 사실을 전제로, 코드는 placeholder env만 받고 실제 path/secret을 노출하지 않는다.

## Scope

- KataGo primary, multi-turn, smoke, timeline runtime.
- KataGo query JSON 생성, stdin/stdout 처리, timeout/cleanup.
- KataGo backend detection (`cuda` / `opencl` / `eigen` / `unknown`).
- `KATAGO_REQUIRE_GPU_BACKEND` 기반 startup guard.

## Owns

- `server/worker/analysisEngines/katagoEngine.ts`
- `server/worker/analysisEngines/katagoSgfQuery.ts`
- `server/worker/analysisEngines/katagoRawParser.ts`
- `server/worker/analysisEngines/katagoSmokeRun.ts`
- `server/worker/analysisEngines/katagoWinrateTimelineRun.ts`
- `server/worker/analysisEngines/katagoAnalyzeTurnsCollector.ts`
- `server/worker/analysisEngines/winrateTimelineConfig.ts`
- `server/worker/analysisEngines/config.ts`
- `server/worker/katagoBackendDetectionV1.ts`

## Must Not Touch

- Web/API에서 KataGo를 직접 spawn 하는 경로 추가 금지.
- UI product 문구, candidate chip, memo 문자열.
- Supabase migration, credit/payment RPC.
- LLM provider 활성화.

## Required Context

- 현재 코드 기준 backend detection은 `katago version` 출력 기반이며 `cuda/opencl/eigen/unknown`만 감지한다.
- 현재 코드에는 `KATAGO_BACKEND_CHECK_MODE`, `analysis_smoke`, `version_then_smoke`, TensorRT 감지, `katagoSmokeOk` startup log가 **없다**. 있다고 가정하지 말 것.
- `KATAGO_BINARY_PATH`, `KATAGO_CONFIG_PATH`, `KATAGO_MODEL_PATH`는 Worker 프로세스 env 에서만 읽는다.
- `KATAGO_MAX_VISITS` 기본 200 (clamp 1..5000), `KATAGO_ANALYSIS_TIMEOUT_MS` 기본 120000 (clamp 30000..900000).
- `KATAGO_MULTI_TURN_MAX` 기본 6 (clamp 0..100).
- timeline visits 기본 50 (clamp 1..2000), report every 0.5s (clamp 0.1..10), max turns 300 (clamp 1..500).

## Skill Checklist

- Node `child_process` spawn + stdin pipe + stdout JSON line parsing.
- SIGTERM/SIGKILL/timeout cleanup 패턴.
- KataGo Analysis Engine JSON query 스펙(`id`, `moves`, `initialStones`, `analyzeTurns`, `maxVisits`, `includeOwnership`, `includePolicy`, `analysisPVLen`, `reportDuringSearchEvery`).
- raw stdout/stderr 를 그대로 DB/log에 적재하지 않는 redaction 감각.
- 환경별 binary 차이(OpenCL/CUDA/Eigen)와 GPU 사용 검증 한계 인식.

## Before Work Checklist

- [ ] 작업이 Web/API가 아닌 Worker 경로에 한정되어 있는가.
- [ ] `ANALYSIS_ENGINE=katago` 와 `ANALYSIS_WORKER_MODE=external` 조합이 깨지지 않는가.
- [ ] 새 env name이 현재 코드에 실제로 추가되는가, 문서만 미리 쓰지 않는가.
- [ ] `KATAGO_*` 실제 path 예시를 코드/문서/test에 박지 않는가.

## Implementation Checklist

- [ ] query JSON 생성 시 `id` 충돌이 없도록 한다.
- [ ] timeout 시 child process를 SIGTERM 후 grace, 그 다음 SIGKILL fallback 한다.
- [ ] raw stdout/stderr 전체 dump를 DB column/log line/에러 메시지에 넣지 않는다.
- [ ] backend detection 결과는 enum/boolean으로만 노출하고 실제 path는 출력하지 않는다.
- [ ] timeline progress 파일(`KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS=true`)은 production에서 비활성 유지.
- [ ] `KATAGO_REQUIRE_GPU_BACKEND=true`에서 `katagoBackend` ∈ {cuda, opencl} && `katagoBackendCheckOk=true`가 아니면 startup fail.
- [ ] `KATAGO_REQUIRE_GPU_BACKEND=false`(기본)에서는 eigen/unknown이어도 warning만 남기고 worker는 계속 동작.
- [ ] timeline append 실패는 분석 job 실패로 전파하지 않는다(append failure isolation).

## Test Checklist

- [ ] `corepack pnpm check`
- [ ] `corepack pnpm test -- analysisEngines`
- [ ] `corepack pnpm test -- katagoMultiTurn`
- [ ] `corepack pnpm test -- katagoBackendDetectionV1`
- [ ] `corepack pnpm test -- winrateTimelineV1`
- [ ] 필요 시 `corepack pnpm katago:smoke -- <sample-id>` (실제 binary 필요, 결과만 enum/boolean으로 기록).
- [ ] `corepack pnpm build`

## Security/Privacy Checklist

- [ ] `KATAGO_BINARY_PATH` / `KATAGO_CONFIG_PATH` / `KATAGO_MODEL_PATH` 실제 path가 log/error/snapshot에 들어가지 않는다.
- [ ] SGF 원문 전문을 raw로 progress 파일/log에 적지 않는다.
- [ ] timeline progress JSONL 에는 jobId, turnIndex, isDuringSearch, visits, winrate, scoreLead, currentPlayer, receivedAt 만 기록.
- [ ] config/model 파일 자체를 repo에 commit 하지 않는다.
- [ ] `.env` 와 secret을 commit 하지 않는다.

## Completion Report Format

```text
A. 변경 파일
B. KataGo query/timeout/parser/backend 변경 요약
C. env 입력 (placeholder만, 실제 path 금지)
D. 관찰된 log 핵심 enum/boolean
   - engine, workerMode, katagoBackend, katagoGpuBackend, katagoBackendCheckOk, requireGpuBackend
E. latency / visits / multi-turn 사용 여부
F. 실패/timeout 발생 여부와 grace/kill 동작
G. 검증 결과 (check/test/build, 필요 시 katago:smoke)
H. master 병합 가능 여부
```

## Codex Review Prompt Points

- Web/API 프로세스에서 KataGo를 직접 spawn 하는 코드가 새로 생겼는가.
- raw stdout/stderr 전체가 DB/log/error 응답에 노출되었는가.
- `KATAGO_REQUIRE_GPU_BACKEND=true`에서 `result.ok=false`인데도 통과되는 경로가 있는가.
- timeline append 실패가 분석 job 자체를 실패시키도록 바뀌었는가.
- 실제 binary/config/model path가 코드/문서/test fixture에 박혔는가.

## Standard Cursor Prompt Template

```text
[Persona: KataGo Runtime Engineer]
브랜치: <branch>
목표: <KataGo runtime/query/backend 작업 한 문장>
허용 파일: server/worker/analysisEngines/*, server/worker/katagoBackendDetectionV1.ts
금지:
- Web/API에서 KataGo 직접 실행 경로 추가 금지.
- raw stdout/stderr 전체 DB/log 저장 금지.
- 실제 KATAGO_* path/secret/SGF 원문을 코드/문서/test에 박지 마라.
- 현재 코드에 없는 KATAGO_BACKEND_CHECK_MODE, analysis_smoke, version_then_smoke, TensorRT, katagoSmokeOk 를 있는 것처럼 쓰지 마라.
검증: corepack pnpm check, corepack pnpm test, corepack pnpm build, 필요 시 corepack pnpm katago:smoke -- <sample>
완료 보고: env(placeholder), log enum/boolean, latency, timeout 동작, 검증 결과.
```
