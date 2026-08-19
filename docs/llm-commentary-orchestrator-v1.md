# LLM Commentary Orchestrator v1

> **현재 상태 — 2026-08-12:** fake function 기반 단위 orchestration이며 production 호출자, persistence, telemetry, locale/audience 계약이 없다. `usedLlm=false`는 최종 표시가 fallback이라는 뜻일 뿐 provider 호출·비용이 없었다는 뜻이 아니므로 production trace를 별도로 설계해야 한다.

## 목적

LLM Commentary Orchestrator v1은 향후 LLM commentary 실행 순서를 하나의 wrapper로 고정한다. 이번 단계에서는 실제 LLM API 호출, env 추가, UI 연결을 하지 않는다. 테스트에서는 fake LLM function만 주입한다.

## 실행 순서

1. `validateAndNormalizeExplanationPlanForLlmV1`
2. boardSize-aware `referenceLine` sanitize
3. 주입받은 LLM function 호출
4. `validateLlmCommentaryOutputV1`
5. `verifyLlmCommentaryClaimsV1`
6. 실패 시 deterministic `ExplanationPlanV1` fallback

## 출력

`LlmCommentaryOrchestrationResultV1`

- `status`: `ok` 또는 `fallback`
- `reasonCode`: 실패 이유 또는 `null`
- `commentary`: 검증 통과한 LLM output 또는 `null`
- `fallbackPlan`: deterministic fallback plan
- `usedLlm`: 최종 사용자 표시 결과로 LLM output을 사용했는지 여부

## Fallback 정책

- input guard 실패: LLM function을 호출하지 않는다.
- LLM function throw: fallback.
- output guard 실패: fallback.
- claim verifier 실패: fallback.
- fallback은 항상 deterministic `ExplanationPlanV1` 기반이다.
- fallback 상태에서는 `usedLlm=false`다.

## 차단 정책

- forbidden label이 있으면 fallback.
- raw SGF, secret, env, path-like payload가 있으면 fallback.
- plan에 없는 좌표, 집 차이, 승률/퍼센트 수치 claim이 있으면 fallback.
- board 밖 좌표 또는 `I` 열 좌표 claim이 있으면 fallback.

## 범위 제외

- 실제 LLM API 호출
- env 추가
- UI 연결
- Worker/KataGo 실행 변경
- DB schema 변경
- 결제/크레딧/Supabase 변경
- `top_mistakes`
- 흑백 승률 계산
