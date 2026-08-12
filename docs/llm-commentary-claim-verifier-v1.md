# LLM Commentary Claim Verifier v1

> **현재 상태 — 2026-08-12:** 단위 모듈은 구현됐지만 product runtime·DB·API·UI와 연결되지 않았다. 좌표와 명시적 단위의 일부 수치만 검증하며 multilingual semantic verifier가 아니다. 목표 계약은 [production-global-commentary-spec-v1.md](production-global-commentary-spec-v1.md)를 따른다.

## 목적

LLM Commentary Claim Verifier v1은 LLM output이 `ExplanationPlanV1`에 없는 좌표, 집 차이, 승률/퍼센트, PV를 만들어내지 못하게 막는 검증 계층이다. 이번 단계에서는 실제 LLM API 호출을 구현하지 않는다.

## 입력

- `ExplanationPlanV1`
- `boardSize`
- candidate LLM output object 또는 text

## Board Size-Aware Sanitizer 정책

- 우선 지원 board size는 `9`, `13`, `19`다.
- GTP 좌표는 `I` 열 제외 정책을 유지한다.
- `pass`와 `null`은 허용한다.
- board 밖 좌표는 제거하거나 claim verifier에서 reject한다.
- `playedMove`가 board 밖이면 reference line을 unsafe로 본다.
- `recommendedMove`와 `pv`의 board 밖 좌표는 sanitizer에서 제거한다.

## Claim Verifier 정책

- output에 등장하는 좌표는 `referenceLine.playedMove`, `referenceLine.recommendedMove`, `referenceLine.pv` 안에 있어야 한다.
- plan에 없는 좌표 또는 board 밖 좌표를 말하면 reject한다.
- output에 등장하는 집 차이 숫자는 `score_loss` bullet 값과 일치해야 한다.
- output에 등장하는 퍼센트 숫자는 `winrate_loss` 또는 `timeline_context` bullet 값과 일치해야 한다.
- `timeline_context` 값은 변동 context로만 허용하고 손실 표현과 결합하면 reject한다.
- ADI, Deep Search, learning event만 있는 plan에서 손실 표현을 하면 reject한다.
- forbidden label은 기존 guard와 동일하게 reject한다.
- raw SGF, secret/env key, path-like payload는 reject한다.

## Fallback 정책

- input guard 실패: LLM 호출을 하지 않는다.
- claim verifier 실패: LLM output을 폐기한다.
- post-check 실패: LLM output을 폐기한다.
- fallback은 deterministic `ExplanationPlanV1` 기반 UI memo를 유지한다.
- 사용자에게는 "해설을 간단히 표시합니다" 수준의 안전 문구만 보여준다.

## 범위 제외

- 실제 LLM API 호출
- env 추가
- UI 연결
- Worker/KataGo 실행 변경
- DB schema 변경
- 결제/크레딧/Supabase 변경
- `top_mistakes`
- 흑백 승률 토글
- player/turn/perspective 일치와 원인·결과 관계
- PV 전체 합법성·순서, 사활·패·축·선수/후수·연결/절단 판정
- 단위를 생략하거나 ja/zh 표현으로 우회한 수치·판정 claim
