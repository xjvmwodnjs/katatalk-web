# Local Algorithm Workbench v1

Local Algorithm Workbench v1은 completed analysis result JSON을 입력으로 받아 현재 Product Review 후보 선정 과정을 로컬에서 점검하는 디버깅 도구다. production UI, selector scoring, Worker/KataGo 실행, DB schema, 결제, LLM 호출은 변경하지 않는다.

## 실행

```bash
corepack pnpm exec tsx scripts/localAlgorithmWorkbenchV1.ts ./completed-result.json --format markdown --out ./local-workbench-report.md
corepack pnpm exec tsx scripts/localAlgorithmWorkbenchV1.ts ./completed-result.json --format json --out ./local-workbench-report.json
```

입력은 로컬 JSON 파일 경로만 받는다. inner `data.source === "katago-worker-v1"` payload와 `GET /api/analyze/:jobId` 전체 응답 형태인 `{ status, data, meta }` wrapper를 모두 지원한다. script는 production path에서 자동 실행되지 않으며, 명시적으로 실행할 때만 report를 만든다.

생성된 local workbench report는 디버깅 산출물이므로 커밋하지 않는다. 기본 예시 파일명(`local-workbench-report*.md/json`, `product-review-workbench*.md/json`)은 `.gitignore` 대상이다.

## Report 구조

- Game summary: `boardSize`, `totalMoves`, `komi`, `resultType`, `winnerColor`, `loserColor`, `margin`
- Source summary: `result.source`, `meta.mock`, `winrateTimelineV1` enabled/completed, `deepSearchResults` enabled/completed
- Learning Events summary: `turnIndex`, `eventType`, `score`, `confidence`, `evidence.source`, `final_position` 제외 여부
- Candidate pool summary: candidate `turnIndex`, `player`, `playedMove`, `recommendedMove`, `bsiScore`, `adiScore`, `scoreLoss`, `winrateLoss`, `playedMoveRank`, deepSearch evidence, timeline context
- DecisiveMove trace: selected 여부, loserColor 필터, positive loss evidence, `final_position` 제외, selected reason, rejected candidates and reasons
- ReviewMoves trace: selected list, category, ranking score, evidence, decisiveMove 중복 제외, player diversity 적용 여부
- ExplanationPlan trace: `targetType`, `titleKey`, `summaryKey`, evidence bullets, caveats, referenceLine PV length
- UI summary: chip label, memo summary, reference available 여부, try-play 영향 없음

## 알고리즘 정책 확인

- `decisiveMove`는 `loserColor`가 있을 때만 선택된다.
- `decisiveMove`는 positive `scoreLoss` 또는 `winrateLoss` 근거가 있어야 한다.
- ADI-only, timeline-only, deepSearch-only 후보는 decisiveMove selected reason으로 승격하지 않는다.
- `reviewMoves`는 더 넓은 검토 후보를 허용하지만 loss로 과장하지 않고 evidence/source trace로 표시한다.
- `final_position` 후보는 decisive/review 후보에서 제외 사유로 남긴다.
- 같은 `turnIndex`는 candidate pool에서 병합되어 중복 제거된다.
- report는 요청서의 금지 label 목록을 출력하지 않는다.

## Redaction / Safety

- SGF 원문 전문은 report에 기록하지 않는다.
- secret/token/API key 형태 값은 `[REDACTED_SECRET]` 또는 `[REDACTED_TOKEN]`으로 치환한다.
- Windows/Unix path-like string은 `[REDACTED_PATH]`로 치환한다.
- 실패 시 CLI error message도 redaction을 거친다.
- 실제 LLM 호출, Railway 재시도, DB schema 변경, 결제/크레딧 변경, Worker 배포 로직 변경은 없다.
