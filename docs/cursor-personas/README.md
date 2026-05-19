# Cursor Persona Skill Pack v1

KataTalk 코드 베이스에 작업할 때 사용하는 10개 Cursor persona skill 문서 모음이다.
원본 분석 보고서는 `docs/codex-current-code-workflow-and-personas.md`이며, 이 디렉토리의 각 파일은 그 보고서의 "10. Cursor Persona System"과 "11. Persona별 Cursor Skill Templates" 섹션을 작업 가능한 단위로 분리한 것이다.

## 원칙

- 모든 persona는 **현재 master에 실제로 존재하는 코드**만 기준으로 작동한다.
- 아직 구현되지 않은 기능을 구현된 것처럼 가정하지 않는다.
- 다음 항목은 모든 persona에서 공통 금지다.
  - `.env`, secret, API key, 실제 KataGo binary/config/model path commit.
  - SGF 원문 전문, private 기보 commit.
  - `codex-*.md` 추적/commit (work-in-progress review 파일).
  - Playwright artifacts(`test-results/`, `playwright-report/`) commit.
  - 실제 LLM 호출 활성화, Worker/KataGo 실행 로직 임의 변경, DB schema 임의 변경, 결제 live 변경, Railway env 임의 변경.

## Persona 목록

| # | Persona | 1줄 책임 | 주요 파일 |
|---|---|---|---|
| 1 | [Product Architect](product-architect.md) | 구현된 product layer 범위와 미구현 항목 분리. | `shared/analysisResultViewModel.ts`, `shared/analysisProductEventsV1.ts`, `docs/algorithm/*` |
| 2 | [KataGo Runtime Engineer](katago-runtime-engineer.md) | KataGo binary/config/model/backend/smoke 안정 실행. | `server/worker/analysisEngines/*`, `server/worker/katagoBackendDetectionV1.ts` |
| 3 | [Analysis Algorithm Engineer](analysis-algorithm-engineer.md) | decisive/review selector ranking과 evidence 안전화. | `shared/decisiveMoveSelectorV1.ts`, `shared/reviewMovesSelectorV1.ts`, `shared/productReviewWorkbenchV1.ts` |
| 4 | [Baduk Concept Engineer](baduk-concept-engineer.md) | 보수적 바둑 개념 태그와 후보 비교 근거. | `shared/conceptTaggerV1.ts`, `shared/candidateComparisonV1.ts` |
| 5 | [Explanation Safety Engineer](explanation-safety-engineer.md) | deterministic explanation plan, evidence label, LLM guard. | `shared/explanationPlannerV2.ts`, `shared/explanationEvidenceLabelsV1.ts`, `server/llm/commentaryProviderV1.ts` |
| 6 | [UI/UX Engineer](ui-ux-engineer.md) | Analysis Result UI, mobile board-first, PV overlay, try-play. | `client/src/components/AnalysisResultView.tsx`, `BadukBoardView.tsx`, `AnalysisWinratePanel.tsx` |
| 7 | [QA/E2E Engineer](qa-e2e-engineer.md) | Vitest + Playwright regression과 fixture 위생. | `e2e/product-review-result.spec.ts`, `e2e/fixtures/*`, `server/*.test.ts` |
| 8 | [DevOps/Smoke Engineer](devops-smoke-engineer.md) | env profile, local/Railway smoke 절차, 문서. | `docs/env-guide.md`, `docs/master-staging-smoke-v1.md`, `.env.example` |
| 9 | [Security/Privacy Guard](security-privacy-guard.md) | secret/path/SGF/unsafe payload 노출 방지. | guard modules, `.gitignore`, redaction layer |
| 10 | [Release Manager](release-manager.md) | branch/diff/test/build/e2e 상태와 merge readiness. | repository status, validation commands, release docs |

## 사용 방법

1. 작업 시작 전 `git status --short --branch`로 dirty state 파악.
2. 작업 범위에 가장 가까운 persona 1개를 선택하고 해당 MD 파일을 읽는다.
3. "Before Work Checklist" → "Implementation Checklist" → "Test Checklist" → "Security/Privacy Checklist" 순서로 자체 점검한다.
4. 작업 완료 후 "Completion Report Format"에 맞춰 한국어로 보고한다.
5. PR/리뷰는 "Codex Review Prompt Points"를 그대로 Codex에 전달한다.
6. 새로운 Cursor 세션을 시작할 때는 "Standard Cursor Prompt Template"을 복사해 작업 prompt로 사용한다.

## 표준 워크플로우 (요약)

원본 보고서 "12. Standard Workflow for Future Tasks" 기준이다.

1. Task Definition - Product Architect.
2. Scope Lock - Release Manager + 담당 persona.
3. Persona Assignment - Product Architect.
4. Implementation - 담당 persona.
5. Self-check - 담당 persona, `corepack pnpm check`와 관련 test.
6. Codex Review - Codex가 한국어 리뷰 보고서 작성.
7. Blocker Fix - 담당 persona, blocker-only patch.
8. Smoke Test - QA/E2E + DevOps/Smoke.
9. Merge - Release Manager.
10. Post-merge Report - Release Manager + Product Architect.

## 공용 검증 명령

```powershell
git status --short --branch
git diff --check
git diff --check origin/master...HEAD
corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm e2e
```

## 참고

- 원본 분석 보고서: `docs/codex-current-code-workflow-and-personas.md`.
- env 변수 전체 표: 위 보고서 6장.
- 현재 구현된 기능 / 미구현 항목: 위 보고서 1장, 5장.
- 현재 알려진 risk: 위 보고서 9장.
