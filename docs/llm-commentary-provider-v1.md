# LLM Commentary Provider v1

## 목적

LLM Commentary Provider v1은 `LLM Commentary Orchestrator v1`에 주입할 수 있는 provider adapter다. 이번 단계에서는 UI, Worker 본 분석 흐름, DB schema, 결제와 연결하지 않는다.

## Env 정책

Provider는 다음 env를 사용하도록 설계한다.

- `KATALK_LLM_COMMENTARY_ENABLED`
- `KATALK_LLM_COMMENTARY_API_KEY`
- `KATALK_LLM_COMMENTARY_ENDPOINT`
- `KATALK_LLM_COMMENTARY_MODEL`

env 값은 로그나 테스트 출력에 노출하지 않는다. `KATALK_LLM_COMMENTARY_ENABLED=true`와 API key가 모두 없으면 provider는 disabled 상태이며 callable LLM function을 제공하지 않는다.

## Orchestrator 연결 정책

provider는 orchestrator에 주입 가능한 함수 형태만 제공한다. 직접 UI나 Worker 본 분석 흐름에 연결하지 않는다.

실제 표시 경로는 반드시 다음 순서를 거쳐야 한다.

1. `validateAndNormalizeExplanationPlanForLlmV1`
2. boardSize 검증
3. provider function 호출
4. `validateLlmCommentaryOutputV1`
5. `verifyLlmCommentaryClaimsV1`
6. 실패 시 deterministic fallback

## Prompt Safety

prompt는 guard를 통과한 `ExplanationPlanV1`의 최소 안전 JSON만 사용한다. raw SGF, secret, env, path-like 값이 포함된 plan은 prompt 생성 전에 reject한다.

prompt에는 다음 지시를 포함한다.

- JSON structured output만 반환
- `패착 확정`, `완착 확정`, `악수`, `정답`, `best move`, `blunder` 금지
- plan에 없는 좌표, 수치, 승률, 집 차이, PV 생성 금지
- timeline, ADI, Deep Search, learning event를 손실 확정 근거로 표현 금지

## Timeout/Error 정책

- provider 호출에는 timeout을 둔다.
- output length를 제한한다.
- malformed JSON response는 throw한다.
- provider throw/timeout/malformed response는 orchestrator에서 fallback으로 처리한다.

## 테스트 정책

외부 API 네트워크 호출 테스트는 하지 않는다. unit test는 fake client만 사용한다.

## 범위 제외

- UI 연결
- Worker 본 분석 흐름 연결
- DB schema 변경
- 결제/크레딧/Supabase 변경
- `top_mistakes`
- 흑백 승률 계산
- ruleset 실제 query 적용
