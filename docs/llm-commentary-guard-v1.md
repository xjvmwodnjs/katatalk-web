# LLM Commentary Guard v1

> **현재 상태 — 2026-08-12:** guard와 별도 claim verifier 단위 코드는 존재하지만 product runtime에는 연결되지 않았다. forbidden 표현은 ko/en 일부만 다루므로 ja/zh 출시 안전성을 증명하지 않는다. 목표 계약은 [production-global-commentary-spec-v1.md](production-global-commentary-spec-v1.md)를 따른다.

## 목적

LLM Commentary Guard v1은 `ExplanationPlanV1`을 향후 LLM prompt input으로 넘기기 전에 검증하고, LLM output을 사용자에게 보여주기 전에 최소 안전 검사를 수행하는 계층이다. 이번 단계에서는 실제 LLM API 호출을 구현하지 않는다.

## Input Guard 정책

- `ExplanationPlanV1.version`은 `explanation-planner-v1`이어야 한다.
- `targetType`은 `decisive_move` 또는 `review_move`만 허용한다.
- `turnIndex`는 0 이상 정수여야 한다.
- `confidence`와 `severity`는 정의된 enum만 허용한다.
- `caveats`, `labelKey`, `textKey`에는 raw SGF, secret/env key, 로컬 path 형태가 들어오면 안 된다.

## Evidence invariant

- `score_loss`: `unit="points"`, `value`는 positive finite number만 허용한다.
- `winrate_loss`: `unit="ratio"`이면 `0 < value <= 1`, `unit="percent"`이면 `0 < value <= 100`만 허용한다.
- `timeline_context`: loss가 아니다. `unit="none"` 또는 context 표시용 `unit="percent"`만 허용한다.
- `adi`, `bsi`, `deep_search`, `learning_event`, `pv`: `unit="none"`만 허용한다.

raw timeline delta는 `winrate_loss`로 승격하지 않는다.

## ReferenceLine sanitizer

`playedMove`, `recommendedMove`, `pv`는 GTP 좌표, `pass`, `null`만 허용한다.

- GTP 좌표는 `A1`부터 `T19`까지 허용하되 `I`는 제외한다.
- `pass`는 lowercase `pass`로 정규화한다.
- `pv` 안의 invalid 문자열은 제거한다.
- `playedMove`가 invalid이면 plan을 reject한다.
- `recommendedMove`가 invalid이면 `null`로 정규화한다.

## Output Guard 정책

LLM output은 짧은 structured object로 제한한다.

- `title`: 짧은 제목
- `body`: 짧은 본문
- `bullets`: 최대 5개
- `caveat`: 짧은 caveat 또는 `null`

다음 표현이 있으면 LLM output을 폐기한다.

- 패착 확정
- 완착 확정
- 악수
- 정답
- best move
- blunder

raw SGF, secret/env key, 로컬 path 형태가 섞이면 output을 폐기한다.

## Claim-check 연계와 제한

`verifyLlmCommentaryClaimsV1`은 현재 다음의 명시적 좌표·수치를 비교한다.

- output에 등장한 수치가 `ExplanationPlanV1.evidenceBullets`에 존재하는지 확인한다.
- output에 등장한 좌표가 `referenceLine` 또는 `pv`에 존재하는지 확인한다.
- 승률/집 차이는 `winrate_loss`, `score_loss` bullet에서만 가져온다.
- `timeline_context`는 변동 context로만 사용하고 loss 주장으로 바꾸지 않는다.

이 verifier는 full semantic verifier가 아니다. player/turn/perspective, 인과관계, PV 합법성, 사활·패·축·선수/후수, 단위 없는 숫자, ja/zh 우회 표현은 검증하지 못한다. 이 영역을 단정하는 output은 evidence profile에서 금지하고 locale별 회귀 corpus로 별도 승인해야 한다.

## Fallback 정책

- input guard 실패: LLM 호출을 하지 않는다.
- output post-check 실패: LLM 결과를 폐기한다.
- fallback은 deterministic `ExplanationPlanV1` 기반 UI memo를 유지한다.
- 사용자에게는 "해설을 간단히 표시합니다" 수준의 안전 문구만 보여준다.
