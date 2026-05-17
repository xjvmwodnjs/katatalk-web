# Internal Beta Smoke Report

일시: 2026-05-17 12:08-12:18 KST  
기준 브랜치: `feature/local-real-katago-smoke-report-v1` from `master`  
기준 커밋: `e558ac0`  
범위: Local Real KataGo Smoke Report v1. 기능 코드 수정 없음.

## A. 실행 환경

- Web: local dev server, `http://127.0.0.1:3200/`
- Worker: local dev worker, external mode
- Local auth: `AUTH_PROVIDER=local-dev`, `VITE_AUTH_PROVIDER=local-dev`
- Analysis env:
  - `ANALYSIS_ENGINE=katago`
  - `ANALYSIS_WORKER_MODE=external`
  - `KATATALK_ALLOW_MOCK_ANALYSIS=false`
  - `KATATALK_LLM_COMMENTARY_ENABLED=false`
- 균형 분석 profile:
  - `KATAGO_MAX_VISITS=200`
  - `KATAGO_ANALYSIS_TIMEOUT_MS=300000`
  - `KATAGO_MULTI_TURN_MAX=6`
  - `KATAGO_MULTI_TURN_MAX_VISITS=200`
  - `KATAGO_MULTI_TURN_QUERY_TIMEOUT_MS=180000`
  - `KATAGO_MULTI_TURN_BATCH_TIMEOUT_MS=600000`
  - `KATAGO_WINRATE_TIMELINE_ENABLED=false`
  - `KATAGO_DEEP_SEARCH_ENABLED=false`
- Secret/API key/KataGo 실제 binary/config/model path, private SGF 전문은 기록하지 않음.
- LLM 호출 및 결제 live 호출 없음.

Worker 시작 로그 요약:

```text
[analysis-config] engine=katago workerMode=external deepSearch=false timeline=false maxVisits=200 multiTurnMax=6
```

- KataGo binary/config/model은 존재 여부만 확인했고 실제 path는 기록하지 않음.
- Worker startup에서 `engine=katago`, `timeline=false`, `deepSearch=false` 확인.

## B. SGF 샘플

- `sample-a-21`: synthetic SGF, 21수
- `sample-b-31`: synthetic SGF, 31수
- `sample-c-41`: synthetic SGF, 41수
- `sample-d-25-pass`: synthetic SGF, 25수, pass 포함
- 모든 SGF는 smoke용 synthetic 데이터이며 private SGF 원문 전문은 문서에 기록하지 않음.

## C. Completed / Failed 결과

| Sample | Job | Flow | Result | Latency | `result.source` | `meta.mock` | Timeline | Deep Search |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sample-a-21` | `eq0BFg...` | enqueue -> completed 확인, running 수집은 PowerShell JSON 파서 실패로 미기록 | completed | 약 41.3s | `katago-worker-v1` | `false` | `false` | `false` |
| `sample-b-31` | `wcvTje...` | enqueue -> running -> completed | completed | 41.1s | `katago-worker-v1` | `false` | `false` | `false` |
| `sample-c-41` | `r0wxkI...` | enqueue -> running -> completed | completed | 43.3s | `katago-worker-v1` | `false` | `false` | `false` |
| `sample-d-25-pass` | `iqUjgQ...` | enqueue -> running -> completed | completed | 40.9s | `katago-worker-v1` | `false` | `false` | `false` |

- Failed job: 없음.
- Timeout: 없음.
- `turnAnalyses` 수: `sample-b-31` 2개, `sample-c-41` 3개, `sample-d-25-pass` 2개.
- `sample-a-21`은 job 자체는 completed였으나 첫 수집 스크립트의 PowerShell JSON 파싱이 대형 응답에서 실패해 이후 Node 기반 요약 수집으로 전환함.

## D. Credit / Refund 확인

- Smoke 전 local-dev credit: `0`
- 기존 문서화된 local/staging 전용 bootstrap RPC로 `local-smoke` credit `5` 지급.
- 결제 live 호출, payment provider 외부 호출 없음.
- 4개 completed job에서 usage `-1`씩 기록됨.
- Smoke 후 local-dev credit: `1`
- 이번 run의 failed job이 없어 신규 refund는 발생하지 않음.

## E. Product Review UI 확인

Deep link: `/?jobId=<completedJobId>` (`sample-d-25-pass`, masked job `iqUjgQ...`)  
Viewport: `390x844`

- Board 표시: 통과
- Winrate graph 표시: 통과
- Product Review 후보 chip 표시: 통과
- deterministic AI memo 표시: 통과
- 참고도 보기 버튼: 통과
- PV overlay: 통과
- 전체 수순 복귀: 통과
- try-play 진입: 통과
- try-play 착수: 통과
- try-play undo: 통과
- try-play reset: 통과
- 금지 표현 smoke: `패착`, `실수`, `악수`, `blunder`, `mistake`, `정답` 미표시

## F. 발견 이슈 / 다음 조치

- Blocker: 없음.
- Non-blocking: 첫 PowerShell 수집 스크립트가 completed 응답의 대형 JSON/인코딩 처리에서 실패함. smoke 결과 자체는 Node 기반 수집과 DB 조회로 재확인함.
- 다음 조치: 이후 실제 KataGo smoke 자동 수집은 Node/Playwright 기반 요약 스크립트로 실행하는 것이 안정적임.

## G. 검증 결과

- `git status`: 문서 파일만 이번 작업 대상으로 확인. 기존 untracked Codex review/report 파일들은 작업 범위 밖이라 제외.
- `git diff --check`: 통과
- `corepack pnpm check`: 통과
- `corepack pnpm test`: 최종 통과 (`57` files / `531` tests)
- `corepack pnpm build`: 통과. 기존 chunk size warning만 확인.
- `corepack pnpm e2e`: 통과 (`390x844`, `430x932`, `1440x900`, 3 tests)

검증 메모:

- 1차 `pnpm test`는 smoke 실행용 Shell env의 `NODE_ENV=development`가 남아 billing checkout test 4건이 `429`로 실패했다.
- 검증 env를 `NODE_ENV=test`로 되돌린 뒤 재실행하여 전체 통과를 확인했다.

## H. 최종 판정

- Local Real KataGo smoke: Pass
- Product Review UI smoke: Pass
- master 병합 가능성: 가능. 단, 이 브랜치에서는 master 병합하지 않음.
