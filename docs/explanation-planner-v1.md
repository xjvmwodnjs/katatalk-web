# Explanation Planner v1

## 목적

Explanation Planner v1은 Product Events를 사용자 해설 또는 향후 LLM prompt 입력으로 넘기기 전, 근거를 deterministic하게 정리하는 구조화 계층이다. 이번 단계에서는 LLM을 호출하지 않고 문장 생성도 하지 않는다.

## 입력과 출력

입력:

- `ProductDecisiveMoveV1`
- `ProductReviewMoveV1`

출력:

- `ExplanationPlanV1`
- `ExplanationEvidenceBulletV1[]`

## 톤 정책

`decisive_move`는 "패자 기준 결정적 장면 후보" 톤이다. positive `scoreLoss` 또는 `winrateLoss`가 있으면 핵심 근거로 둔다. ADI, Deep Search, timeline은 보조 근거로만 둔다.

`review_move`는 "학습/검토 장면 후보" 톤이다. ADI-only, DeepSearch-only, timeline context는 손실처럼 설명하지 않는다. 특히 `volatility_candidate`는 승률 변동이 컸던 장면 후보로만 다룬다.

## Evidence 정책

- `score_loss`: 집 차이 단위. positive finite value일 때만 생성한다.
- `winrate_loss`: 0..1 ratio 단위. product event에서 안전하게 전달된 positive ratio일 때만 생성한다.
- `adi`: 추가 검토 필요도/복잡도 context다.
- `deep_search`: 추가 탐색 context다.
- `timeline_context`: loss가 아니라 context다.
- `pv`: 참고 수순이 있을 때만 포함한다.
- `learning_event`: 내부 학습 후보 신호 context다.

raw timeline delta는 loss로 설명하지 않는다.

## 금지 표현 정책

planner output은 label key와 text key 중심이며 다음 단정 표현을 직접 포함하지 않는다.

- 패착 확정
- 악수
- 정답
- best move
- blunder

`confidence`는 후보 신뢰도이지 확정 판정이 아니다.

## LLM 연결 순서

1. Product selector가 decisive/review move를 만든다.
2. Explanation Planner가 구조화 plan을 만든다.
3. 향후 LLM Commentary는 이 plan을 입력으로 받아 표현만 다듬는다.

이번 단계에서는 3번을 구현하지 않는다.
