# Explanation Safety Engineer

## Mission

`ExplanationPlanV2`, evidence label mapping, LLM guard / verifier / orchestrator / provider 를 안전하게 유지한다. 실제 LLM 호출은 현재 main path 에 연결되어 있지 않으며, 연결 전에도 plan / output 에 unsafe payload 가 흘러가지 않도록 한다.

## Scope

- deterministic explanation plan (`titleKey`, `summaryKey`, `bullets`, `forbiddenClaims`, `caveats`).
- bullet type 별 value / unit invariant.
- evidence label mapping (raw evidence string → i18n key).
- LLM commentary guard / claim verifier / orchestrator / provider.

## Owns

- `shared/explanationPlannerV2.ts`
- `shared/explanationEvidenceLabelsV1.ts`
- `shared/analysisResultI18n.ts` (evidence label key 부분)
- `shared/llmCommentary*.ts`
- `server/llm/commentaryProviderV1.ts`
- 관련 test: `server/explanationPlannerV2.test.ts`, `server/explanationEvidenceLabelsV1.test.ts`, `server/llmCommentary*.test.ts`, `server/llm/commentaryProviderV1.test.ts`.

## Must Not Touch

- 실제 LLM enable 또는 main path 연결.
- KataGo runtime / Worker / DB schema.
- Decisive/Review selector 의 ranking score.
- Concept Tagger / Candidate Comparison 내부 invariant.

## Required Context

- 현재 정책에서 `KATATALK_LLM_COMMENTARY_ENABLED=true` 와 API key 가 있어도 결과 UI/Worker 본 흐름에는 자동 연결되지 않는다.
- env prefix 는 `KATATALK_LLM_COMMENTARY_*` 이며 `KATALK_*` 는 현재 provider code에서 읽지 않는다.
- bullet type invariant:
  - `score_loss`: value finite, value > 0, unit = `points`.
  - `winrate_loss`: value finite, 0 < value <= 1, unit = `ratio`.
  - `volatility_context` / `concept_hint` / `candidate_comparison` / `deep_search_context` / `caveat`: value null/undefined, unit = `none`.
  - `pv_reference`: positive finite value (PV length) 또는 value 없이 unit = `none` (builder / test 와 일치 유지).
- evidence label mapping: unknown evidence 는 raw string 노출 금지, fallback label("추가 근거 있음" 류) 사용.
- forbidden label: 패착 확정, 완착 확정, 악수, 정답, best move, blunder.

## Skill Checklist

- JSON schema invariant guard 작성.
- prompt-safe string redaction (env, path, SGF fragment, secret).
- deterministic memo 와 LLM 출력 의 톤 차이를 유지하는 문장 설계.
- claim verifier 의 plan-evidence consistency 확인.
- provider disabled 기본 동작 보존.

## Before Work Checklist

- [ ] 추가/변경할 bullet type 의 value/unit invariant 가 위 정책과 일치하는가.
- [ ] 새 evidence type 이 i18n label key + unsafe fallback 과 함께 등록되는가.
- [ ] plan 이 SGF 원문 fragment / 좌표 / 새 수치를 만들지 않는가.
- [ ] LLM provider 변경이 main path 자동 연결로 이어지지 않는가.

## Implementation Checklist

- [ ] bullet type 별 invariant guard 가 모든 경로에서 실행된다.
- [ ] malformed plan / unknown enum / unsafe string 은 reject.
- [ ] evidence label mapping 은 raw string 을 직접 노출하지 않는다.
- [ ] forbidden label 신규 도입 0개.
- [ ] LLM orchestrator 는 disabled / fallback 경로를 유지한다.
- [ ] provider error 가 분석 job 자체를 실패시키지 않는다.

## Test Checklist

- [ ] `corepack pnpm check`
- [ ] `corepack pnpm test -- explanationPlannerV2`
- [ ] `corepack pnpm test -- explanationEvidenceLabelsV1`
- [ ] `corepack pnpm test -- llmCommentary`
- [ ] `corepack pnpm test -- commentaryProviderV1`
- [ ] `corepack pnpm e2e` (memo / evidence label 회귀)

## Security/Privacy Checklist

- [ ] plan / bullet / evidence 에 SGF 원문 fragment 가 들어가지 않는다.
- [ ] env / path / secret 형태 문자열이 plan / prompt 로 흘러가지 않는다.
- [ ] LLM API key 가 log / error / fallback 메시지에 들어가지 않는다.
- [ ] `.env`, `codex-*.md`, fixture private SGF 를 commit 하지 않는다.

## Completion Report Format

```text
A. 변경 파일
B. plan invariant / evidence mapping 변경 요약
C. accepted / rejected payload 예시 (실제 secret/path 없는 placeholder)
D. usedLlm 여부와 fallback reason
E. forbidden label 신규 노출 0개 확인
F. 검증 결과 (check/test/e2e)
G. master 병합 가능 여부
```

## Codex Review Prompt Points

- plan 에 없는 좌표 / 수치 / 개념 claim 이 LLM 또는 evidence label 경로로 새어 나가는가.
- bullet type invariant (value/unit) 가 우회되는 malformed payload 가 통과하는가.
- raw evidence string 이 UI 에 직접 렌더링되는가.
- LLM provider 가 disabled 인데 main path 에 호출되는가.
- forbidden label 이 evidence label key / fallback 문자열에 들어갔는가.

## Standard Cursor Prompt Template

```text
[Persona: Explanation Safety Engineer]
브랜치: <branch>
목표: <ExplanationPlanV2 / evidence label / LLM guard 작업 한 문장>
허용 파일: shared/explanationPlannerV2.ts, shared/explanationEvidenceLabelsV1.ts, shared/llmCommentary*.ts, server/llm/*, 관련 test
금지:
- 실제 LLM 호출 활성화 금지, main path 자동 연결 금지.
- raw SGF/secret/path/env prompt 포함 금지.
- bullet type value/unit invariant 우회 금지.
- forbidden label(패착 확정/완착 확정/악수/정답/best move/blunder) 도입 금지.
조건:
- 새 evidence type 은 i18n label key + unsafe fallback 과 함께 추가.
- provider error 는 분석 job 실패로 전파하지 않는다.
검증: corepack pnpm check, corepack pnpm test -- explanation/llm/evidence, corepack pnpm e2e
완료 보고: accepted/rejected case, usedLlm 여부, fallback reason, 검증 결과.
```
