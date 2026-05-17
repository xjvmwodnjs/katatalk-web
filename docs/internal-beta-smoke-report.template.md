# Internal Beta Smoke Report Template

> 실제 secret/API key/KataGo binary/model/config path, raw private SGF, 결제 live payload는 기록하지 않는다.

## Run Metadata

- Date:
- Operator:
- Branch:
- Commit:
- Environment: Local / Railway Staging
- Smoke profile: 빠른 UI smoke / 균형 분석 / 품질 우선 / Railway Web+Worker
- Web URL:
- Worker target: local / Railway worker

## Env Policy Check

| 항목 | 기대값 | 결과 |
|------|--------|------|
| `ANALYSIS_ENGINE` | `katago` |  |
| `ANALYSIS_WORKER_MODE` | `external` |  |
| `KATATALK_ALLOW_MOCK_ANALYSIS` | `false` 또는 미설정 |  |
| `KATATALK_LLM_COMMENTARY_ENABLED` | `false` 또는 미설정 |  |
| Web `KATAGO_*` | Railway Web에는 없음 |  |
| Worker `KATAGO_*` | Worker에만 있음, 값 미기록 |  |
| 결제 live 호출 | 실행 안 함 |  |
| LLM 외부 호출 | 실행 안 함 |  |

## Supabase / Migration Check

| 항목 | 기대값 | 결과 |
|------|--------|------|
| staging project 확인 | local/prod 혼동 없음 |  |
| migration 006 | 적용됨 |  |
| migration 007 | 적용됨 |  |
| `claim_next_analysis_job` RPC | 존재 및 Worker 권한 OK |  |
| lease/heartbeat 컬럼 | 존재 |  |
| retry/error 컬럼 | 존재 |  |
| anon/client RPC 제한 | 불필요 권한 차단 |  |

## Job Flow

- SGF fixture:
- Uploaded job id (masked):
- Queue state observed: queued / running / completed / failed
- `result.source`:
- `meta.mock`:
- Worker log policy: secret/path 미노출 확인 여부
- Failure/refund check, if any:

## Product Review UI Deep Link

- Deep link URL: `/?jobId=<masked>`
- Board 표시:
- Winrate graph 표시:
- Product Review 후보 chip 표시:
- Decisive label 중립성:
- Review/Learning label 중립성:
- AI memo deterministic 문구:
- 금지 표현 없음:
- learningEvents fallback 확인:
- mock/unknown/placeholder 안전 경로:

## Reference / Try-Play

- 참고도 보기:
- PV overlay:
- 전체 수순으로 돌아가기:
- try-play 진입:
- try-play 착수:
- try-play undo:
- try-play reset:

## Viewport Check

| Viewport | 결과 | 메모 |
|----------|------|------|
| `390x844` |  |  |
| `430x932` |  |  |
| `1440x900` |  |  |

## Findings

- Blockers:
- Non-blocking issues:
- Follow-up:
- Final verdict: Pass / Fail / Partial
