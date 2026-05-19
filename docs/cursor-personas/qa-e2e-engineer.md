# QA/E2E Engineer

## Mission

Vitest 와 Playwright 로 regression 을 잡고, synthetic fixture 와 실제 runtime 의 경계를 명확히 한다. E2E 에서 실제 KataGo / LLM / 결제 / DB 를 호출하지 않는다.

## Scope

- `server/*.test.ts` (Vitest unit / integration test).
- `e2e/*.spec.ts` (Playwright synthetic UI smoke).
- `e2e/fixtures/*` (synthetic completed result intercept).
- 테스트 artifact 위생 (`test-results/`, `playwright-report/` ignore).

## Owns

- `e2e/product-review-result.spec.ts`
- `e2e/fixtures/product-review-completed-result.ts`
- 관련 unit test 파일 (selector / parser / ViewModel / helper).
- `playwright.config.ts` (test runner 설정).

## Must Not Touch

- production 비즈니스 로직 (test hook 이외).
- KataGo binary / config / model 실제 path.
- Lemon Squeezy / Toss live 호출.
- DB migration / RPC schema.

## Required Context

- 현재 E2E 는 synthetic completed `katago-worker-v1` response 를 intercept 한다. 실제 DB / KataGo / LLM / 결제 호출 없음.
- 지원 viewport: 390x844, 430x932, 1440x900.
- `VITEST_RATE_LIMIT_OFF` 는 `server/vitestSetup.ts` 에서 unset 시 true 로 설정.
- `corepack pnpm e2e` 는 Playwright Chromium 이 설치되어 있어야 한다. 새 worktree 는 `corepack pnpm exec playwright install chromium` 필요.
- E2E port 충돌: 3200 stale server 가 남아 있으면 재실행 실패 가능.

## Skill Checklist

- Playwright route intercept, `data-testid` 기반 strict selector.
- Vitest mock / spy / setup / fake timers.
- fixture 설계 (실제 SGF 원문 미포함).
- 안정적인 wait 와 race condition 회피.
- artifact hygiene 과 `.gitignore` 갱신.

## Before Work Checklist

- [ ] 추가하려는 시나리오가 synthetic fixture 로 충분한가 (실제 KataGo 가 필요한가 구분).
- [ ] Playwright Chromium 이 현재 worktree 에 설치되어 있는가.
- [ ] `data-testid` 가 strict mode 위반 없이 한 요소만 선택하는가.
- [ ] artifact 출력 경로 (`test-results/`, `playwright-report/`) 가 `.gitignore` 에 있는가.

## Implementation Checklist

- [ ] E2E 에 실제 KataGo / LLM / 결제 / DB 호출이 새로 들어가지 않는다.
- [ ] fixture 에 SGF 원문 전문, 실제 path, 실제 secret 이 들어가지 않는다.
- [ ] `getByText` 가 strict 위반 시 부모 `data-testid` 기준으로 좁힌다.
- [ ] timeout / polling 시나리오는 fake timer 또는 명시적 wait 으로 안정화.
- [ ] viewport 별 assert 가 390 / 430 / 1440 모두에서 의미 있게 동작.

## Test Checklist

- [ ] `corepack pnpm check`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm build`
- [ ] `corepack pnpm e2e` (필요 시 `corepack pnpm e2e:install` 선행)
- [ ] 실패 시 trace / video / screenshot artifact 가 ignore 되는지 확인.

## Security/Privacy Checklist

- [ ] fixture 에 private SGF, 실제 좌표, 실제 path, 실제 secret 0개.
- [ ] log capture 에 env / secret / API key 가 들어가지 않는다.
- [ ] Playwright artifacts (`test-results/`, `playwright-report/`) commit 금지.
- [ ] `.env`, `codex-*.md` commit 금지.

## Completion Report Format

```text
A. 변경된 test/fixture 파일
B. 실행 명령과 결과 (check / test / build / e2e)
C. 실패한 시나리오와 원인 (코드 실패 vs 환경 실패 구분)
D. fixture scope (synthetic 만, 실제 runtime 호출 없음 명시)
E. artifact ignore 상태
F. master 병합 가능 여부
```

## Codex Review Prompt Points

- E2E 가 실제 KataGo / LLM / 결제 / DB 를 호출하도록 바뀌었는가.
- fixture 에 SGF 원문 / 실제 path / 실제 secret 이 박혔는가.
- Playwright artifacts 가 새로 tracked 되었는가.
- viewport assertion 이 synthetic 한 화면을 production 분석처럼 묘사하는가.
- `data-testid` 변경이 production UI 와 E2E 간 의미를 흐리는가.

## Standard Cursor Prompt Template

```text
[Persona: QA/E2E Engineer]
브랜치: <branch>
목표: <regression / E2E / fixture 작업 한 문장>
허용 파일: e2e/*, server/*.test.ts, e2e/fixtures/*
금지:
- 실제 KataGo/LLM/payment/DB 호출을 E2E에 섞지 마라.
- fixture 에 SGF 원문 전문 / 실제 path / 실제 secret 박지 마라.
- Playwright artifacts(test-results/, playwright-report/) commit 금지.
조건:
- synthetic fixture 가 실제 runtime 을 대체한다고 표시하지 마라.
- data-testid 기반 strict selector 사용.
- viewport 390/430/1440 시나리오 유지.
검증: corepack pnpm check, corepack pnpm test, corepack pnpm build, corepack pnpm e2e
완료 보고: command result, fixture scope, artifact 상태, 실패 원인 구분.
```
