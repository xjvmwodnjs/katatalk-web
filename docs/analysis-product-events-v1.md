# Analysis Product Events v1

## 목적

Analysis Product Events v1은 현재 분석 신호를 최종 제품 문구와 UI 계약으로 바로 노출하지 않기 위한 중간 계층이다. `learningEventsV1`은 학습/검토에 유용한 내부 후보 신호이며, 이를 곧바로 "패착"이나 "완착"으로 부르지 않는다.

이번 단계는 설계 문서와 pure schema/helper만 추가한다. Worker/KataGo 실행, DB schema, 결제, UI 연결, LLM 호출은 변경하지 않는다.

## 현재 구현과 최종 목표 Gap

현재 구현됨:

- SGF 업로드와 기본 validation
- Worker 기반 KataGo 분석
- BSI/ADI 신호
- Deep Search 계획/결과
- `learningEventsV1` 학습 장면 후보
- 보드/PV 중심 결과 화면

최종 제품 요구사항 중 미구현:

- 룰 선택
- 흑/백 기준 승률 그래프
- 패자 기준 패착 후보 1개 selector
- 쌍방 완착/학습 장면 3~5개 selector
- 자연어 해설

## Schema 개요

### SGF game-info v1 metadata contract

공통 `sgf-game-info-v1` marker는 root-only 출시 metadata를 표시한다. `PB/PW/DT/RE`는 안전한 SGF 작성값 또는 `null`이며 Black/White, 현재 날짜, pipeline 결과를 합성하지 않는다. SimpleText에는 NFC·trim·공백·길이 제한을 적용한다. 유효한 FF4 부분 날짜와 쉼표 단축 `DT`는 허용하고 잘못된 단축 상태는 무효화한다. `RE`는 안전한 작성 원문과 canonical 값을 함께 보존하며 generic `B+`/`W+`를 `resultType="win"`으로 해석한다. 숫자 margin은 문자열 기준 최대 1000이고 JavaScript decimal exact round-trip이 되지 않으면 무효화한다. 잘못된 선택 필드는 해당 필드만 `null`이 되어 admission을 거절하지 않지만 malformed UTF-8 업로드는 거절한다. marker 결과는 UI 직전에 재검증하고, legacy `katago-worker-v1`는 `sgf_content` 또는 `sgfContent`를 재파싱하거나 오래된 placeholder를 숨긴다. UI는 `DT`를 직접 표시하고 `RE`는 공통 `ProductGameResult` parser로 해석한다. 이 root-only 출시는 FF4 일반 `game-info` 배치보다 좁으며 실제 corpus 개인정보 규칙은 그대로 적용한다.

`shared/analysisProductEventsV1.ts`는 다음 pure schema/helper를 제공한다.

- `ProductGameResultV1`: SGF `RE[]`에서 계산한 winner/loser/result metadata
- `ProductDecisiveMoveV1`: 패자 기준으로 보여줄 결정적 장면 후보 1개
- `ProductReviewMoveV1`: 쌍방 학습/검토 장면 후보 3~5개

`ProductDecisiveMoveV1`과 `ProductReviewMoveV1`은 모두 후보 schema다. 현재 단계에서는 selector를 구현하지 않는다.

## SGF RE[] 파싱 정책

`RE[]`는 root node의 결과 속성만 읽는다. comment나 variation 안의 `RE[]`처럼 보이는 텍스트는 제품 결과로 사용하지 않는다.

지원 정책:

- `B+R`, `W+R`, `B+Resign`, `W+Resign`: `resultType="resign"`
- `B+`, `W+`: 승자/패자 색을 유지하는 `resultType="win"`, `margin=null`
- `B+2.5`, `W+2.5`: `resultType="points"`, `margin=2.5`
- `B+T`, `W+T`: `resultType="time"`
- `B+F`, `W+F`: `resultType="forfeit"`
- `0`, `Draw`, `Jigo`: `resultType="draw"`, winner/loser 없음, `margin=null`
- `RE[]`가 없거나 해석할 수 없으면 `resultType="unknown"`, winner/loser 없음, `margin=null`

숫자 margin은 canonical decimal 문자열 기준 최대 `1000`이며, JavaScript `number`로 변환한 뒤 같은 decimal 문자열로 정확히 왕복되지 않으면 `unknown`으로 처리한다.

원문은 `rawResult`에 보존하되, secret이나 path를 포함하지 않는다.

## Winner/Loser Color 계산

승자가 `B`이면 패자는 `W`, 승자가 `W`이면 패자는 `B`다.

무승부 또는 unknown 결과에서는 `winnerColor=null`, `loserColor=null`로 둔다. suffix가 없는 유효한 `B+`/`W+`는 각각 승자/패자 색을 유지하고, malformed suffix에서는 winner/loser를 추론하지 않는다.

## Decisive Move 정책

`decisiveMoveV1`은 "패착 확정"이 아니라 "패착 후보"다.

선정 방향:

- `gameResultV1.loserColor`가 있을 때만 패자 기준 후보를 고른다.
- 후보는 `learningEventsV1`, BSI/ADI, Deep Search, winrate/score loss 신호를 종합해 계산한다.
- `sourceEventId`로 원천 event를 추적한다.
- 낮은 confidence에서는 강한 단정 문구를 쓰지 않는다.

이번 단계에서는 selector를 구현하지 않고 schema와 guard만 둔다.

## Review Moves 정책

`reviewMovesV1`은 "완착 확정"이 아니라 "학습/검토 장면 후보"다.

선정 방향:

- 흑/백 양쪽 후보를 모두 고려한다.
- 3~5개 범위로 제한한다.
- final position만으로 목록을 채우지 않는다.
- 후보 category는 제품 표시용 분류이며, 실제 정답 판정이 아니다.

이번 단계에서는 selector를 구현하지 않는다.

## learningEventsV1과 Product Events 관계

`learningEventsV1`은 내부 분석 신호 계층이다. Product Events는 그 위에 놓이는 제품 계약 계층이다.

관계:

- `learningEventsV1`: 후보 장면을 찾는 근거 신호
- `ProductDecisiveMoveV1`: 패자 기준으로 대표 후보 1개를 고르는 제품용 view model 후보
- `ProductReviewMoveV1`: 쌍방 학습/검토 후보 3~5개를 고르는 제품용 view model 후보

Product Events는 `learningEventsV1`의 label을 그대로 사용자 문구로 노출하지 않는다. 반드시 안전한 제품 label과 explanation policy를 거친다.

현재 shared schema의 label 상수는 UI 미연결 테스트용 안전 label이다. UI 연결 전에는 i18n `labelKey` 기반으로 분리해 raw label이 직접 노출되지 않도록 한다.

## Explanation Planner와 LLM Commentary 순서

자연어 해설은 다음 순서로 분리한다.

1. Product Events selector가 구조화된 후보를 만든다.
2. Explanation Planner가 금지 표현, confidence, evidence를 기준으로 문장 계획을 만든다.
3. LLM Commentary는 문장 계획을 받아 표현만 다듬는다.

LLM이 후보 선정, 승패 판정, 정답 판정을 직접 수행하지 않는다.

## 금지 표현 정책

다음 표현은 사용자-facing 단정 문구로 쓰지 않는다.

- 패착 확정
- 악수
- 정답
- best move
- blunder

허용 방향:

- "검토 후보"
- "학습 후보"
- "참고 후보"
- "승률/집 차이 변화가 큰 장면"
- "AI가 더 살펴볼 만하다고 본 장면"

## UI 연결 계획

1. 결과 payload에 `productEventsV1`을 optional로 추가한다.
2. 기존 UI는 `learningEventsV1` fallback을 유지한다.
3. `gameResultV1`이 있으면 승자/패자 기준 설명을 보강한다.
4. `decisiveMoveV1`은 대표 후보 카드 1개로 표시한다.
5. `reviewMovesV1`은 기존 후보 chip 영역과 점진적으로 연결한다.
6. 흑/백 승률 그래프는 별도 feature로 분리한다.

이번 단계에서는 UI 연결을 하지 않는다.

## 테스트 전략

- SGF `RE[]` 파싱: `B+R`, `W+2.5`, `0`, `Draw`, 미존재
- winner/loser color 계산
- schema guard: 정상/비정상 decisive/review move
- 제품 label에 금지 단정어가 없는지 확인
- 기존 `learningEventsV1` 테스트와 독립 유지

## 단계별 구현 순서

1. `ProductGameResultV1` schema/helper 추가
2. `ProductDecisiveMoveV1`, `ProductReviewMoveV1` schema guard 추가
3. SGF `RE[]` 파싱 테스트 추가
4. product selector 설계 리뷰
5. 패자 기준 decisive 후보 selector 구현
6. reviewMoves 3~5개 selector 구현
7. Explanation Planner 구현
8. UI에 optional 연결
9. LLM Commentary는 마지막 단계에서 planner 이후 연결
