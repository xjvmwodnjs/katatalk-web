# KataTalk — 이후 작업 TODO

> 베타에서는 결제 UI가 **Lemon Squeezy** 만 사용합니다( **일회성 크레딧 팩 구매** , 구독 모델 아님). **Toss** 는 **향후 국내 결제 옵션**으로 검토하며(`tossProvider` 스켈레톤) **현재 checkout UI 에는 노출하지 않습니다**. Paddle 은 **추후 fallback 후보**로만 문서에 남기며 코드는 추가하지 않습니다.

## 상용화 readiness 기준

- [ ] 공개 유료 베타 readiness **76% -> 80% 이상**으로 올리기 (현재 판정·우선순위는 `review.md`, 과거 점수 추이는 `docs/commercialization-review.md` 참고)
- [x] 고객형 synthetic SGF suite 4개 launch gate 통과 (`katago:product-suite -- --customer-fixtures --strict-warnings --max-successful-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --max-product-review-category-quality-failure-rows 0`)
- [ ] 실제 고객형 SGF corpus 10-20개 manifest + product suite 통과 (`katago:corpus-validate`와 `--corpus-manifest` 구현 완료, 실제 corpus와 검수 결과는 아직 필요)
- [x] corpus manifest v1 도구 구현 — SHA-256, 익명화 metadata, 최소 10건, 9/13/19·접바둑·pass·setup·장기 대국 coverage, 기대 visits/turn/BSI/ADI/quality 검사
- [ ] 기보별 독립 바둑 검수자 2명 승인 (`--require-human-review` gate 구현 완료, 실제 검수 미실행)
- [x] persistent KataGo root benchmark에서 spawn 대비 p50/p95 측정 (`katago:persistent-benchmark -- --customer-fixtures`; warm persistent p95 `2269ms`)
- [x] persistent KataGo root analysis를 worker product path에 flag-gated 통합하고 full product suite 재측정 (4/4, p50 `19979ms`, p95 `37081ms`, quality warning/failure 0)
- [x] 운영 후보 프로필 root 200 visits, multi-turn 6 측정 및 persistent multi-turn 재측정 (4/4, p50 `23053ms`, p95 `30769ms`, quality warning/failure 0; root-only 기준선 대비 전체 시간 `53.7%` 감소)
- [x] root와 multi-turn의 동일 persistent process/model 재사용, 실패 query 선택 fallback/strict 모드, 실행 metadata, standalone CLI session 정리 구현
- [x] KataGo 결과에 root/multi-turn/signal/deep/timeline 단계별 latency 계측 추가
- [x] KataGo 승률 축 계약 검증 — 실제 analysis config 파싱, 기대값 불일치 Worker startup 차단, result quality gate, setup/pass 실엔진 4/4
- [~] Worker 동시성 1/2/4 용량 검증: 격리 process C2/4는 메모리 NO-GO. bounded 단일 공유 KataGo C4 round-robin 8건 mini-soak는 8/8, E2E p95 `81686ms`, `5.88 jobs/min`, peak delta `2059.9MiB`, minimum free `8423MiB`, 품질 0/0으로 로컬 GO. query 실패 격리와 child crash pending 복구 단위 검증 완료. 실제 corpus·Worker RSS/GPU VRAM·Supabase staging queue·30~60분 soak·환불/reclaim fault injection 필요
- [x] Worker runtime preflight 구현 — `pnpm worker:preflight`이 큐 claim 없이 KataGo 파일·승률 config·backend/GPU·동시성 정책을 fail-closed 검사. 실제 staging Worker 실행은 아직 필요.
- [~] Worker observability foundation implemented: service-role status RPC and `/ops/analysis-worker-health` distinguish idle Worker liveness from job leases. Supabase migration, staging TTL/restart, and long-running job soak remain required.
- [~] COM-001 quarantine operations visibility implemented: token-protected `/ops/analysis-finalization-quarantine` returns only unresolved count and oldest timestamp, fails closed without backend details, and stays separate from Web readiness. Staging response verification, monitor wiring, alert drill, and a separately reviewed append-only reconciliation command remain required.
- [~] COM-005 Japanese-only SGF rules, strict root `SZ`/`KM`, initial-player, and root game-metadata contracts implemented. `sgf-game-info-v1` carries safe authored-or-null `PB`/`PW`/`DT`/`RE`; valid FF4 partial/comma `DT` is accepted while invalid shortcut state is rejected; `RE` keeps raw plus canonical generic `B+`/`W+` win and bounded lexical numeric margins (max 1000, exact decimal round-trip required). Invalid optional fields are field-local; malformed UTF-8 is a fixed 400 before wallet/debit/enqueue. Marked results are revalidated; legacy `katago-worker-v1` reparses `sgf_content`/`sgfContent` or hides placeholders. UI displays `DT` directly and uses common `ProductGameResult` parsing for `RE`. Remaining: post-move transition, compressed setup ranges, full legality, additional rulesets, real-exporter compatibility, staging evidence, and non-UTF8 legacy charset/CA transcoding compatibility. Root-only metadata is narrower than FF4 `game-info`; real-corpus privacy rules remain mandatory.
- [~] **COM-106 production Clerk client artifact gate** — 모든 Vite build에서 Clerk provider·publishable key 문법과 clean Git/platform source commit을 fail-closed 검증하고, raw key 없는 manifest와 Clerk chunk를 동일 env-file 우선순위의 package build에서 재검증한다. staging smoke는 commit/key 지문을 credential 없이 먼저 검사하고 토큰 전송 직전에 재검사한다. 실제 GitHub `staging` 환경 구성, Clerk tenant 실로그인, Web/Worker secret 최소화는 아직 필요하다.
- [ ] staging Web/Worker/결제 webhook/credit ledger end-to-end 통과
- [~] SGF/analysis payload deletion and opt-in retention implemented: result UI now exposes an owner-only confirmed delete action; migration 009 provides API deletion; migration 010 plus `data:retention` defaults to dry-run and only purges completed/failed payloads with an explicit expiry. Supabase migration application, staging UI E2E, scheduler, account-level anonymization, and legal review remain.
- [~] Public-document drafts added: `PRIVACY.md`, `TERMS.md`, and `SECURITY.md` reflect implemented flows and explicitly flag required legal decisions. Operator identity, jurisdiction, refunds, retention, support contact, and final legal approval remain.
- [~] Protected manual retention workflow and runbook added: `.github/workflows/analysis-data-retention.yml` defaults to dry-run and requires a protected `production` environment plus explicit `apply=true` for deletion. Configure environment reviewers/secrets, apply migrations 009/010, perform a staging rehearsal, and obtain legal retention approval before production use.
- [x] Product Review Playwright coverage now verifies the confirmed analysis-data deletion UI and the cancellation path with mocked authenticated-result APIs. Authenticated staging Supabase deletion rehearsal remains required.
- [x] Private corpus launch gate now requires each human-reviewed entry to declare critical turns and verifies that the same turns appear in both BSI and ADI signals. A real consented/licensed corpus with independent reviews is still required before release.
- [x] Product Review category-quality gate now validates category/taxonomy/evidence consistency and is exposed through `katago:product-suite --max-product-review-category-quality-failure-rows 0`.
- [x] Production dependency gate 유지: 2026-07-24 remediation은 GitHub Actions `30019630160`에서 통과했고, 2026-08-04 새 `GHSA-mwp4-54f8-5fhr`는 `express-rate-limit@8.5.1`의 허용 범위 안에서 lockfile의 `ip-address`를 `10.2.0 → 10.4.0`으로 갱신해 로컬 frozen install/production audit에서 다시 알려진 취약점 0을 확인했다. PR CI 재검증은 진행 중이다.
- [x] Git delivery restored: PR #1을 `master`에 병합했고 merge commit `5ac090e`의 GitHub Actions `30448737391`에서 PostgreSQL, dependency-audit, quality, build, E2E gate가 통과했다.
- [ ] long-running 분석 UX, observability, SGF 보존/삭제 정책, 환불/약관 법무 검토 완료

## 결제·법무

- [ ] **Toss** 실결제창·결제 승인 API·웹훅 서명 검증 완성 (`tossProvider.ts` TODO)
- [ ] **Lemon Squeezy** 운영 주문·웹훅 payload 와 `custom_data` 필드 최종 검증 (Checkout URL·redirect_url 연동됨; fixture·idempotency는 저장소 테스트로 고정됨)
- [ ] **환불 정책·이용약관** 법무 검토
- [ ] 운영 웹훅 엔드포인트 URL·시크릿 로테이션 절차

## 인프라

- [ ] **Railway 운영 프로파일 전환** — README **「Railway 운영 프로파일」**: (1) internal mock 베타, (2) 공개 분석 비활성, (3) 향후 **GPU 전용 호스트**에 KataGo worker 배포 후 Web=`katago`+`external` / Worker=`KATAGO_*` (Web 에는 `KATAGO_*` 불필요). Railway **일반 CPU** 상용 KataGo 부하는 비권장.
- [ ] **초기 베타 호스팅:** long-running **Node**(Railway 우선, Render 차순) — README 배포 절 참고. **Vercel 은 현재 미사용·보류**(Express listen·raw body webhook·in-process mock·memory rate limit·향후 KataGo worker 등으로 serverless adapter 분리 후 재검토).
- [ ] Supabase **`002` 마이그레이션** 적용 후 `add_credits_from_payment` RPC 검증
- [ ] 기존 `stripe_*` 로 적재된 `credit_logs` 가 있다면 조회·리포트만 legacy 로 유지
- [x] **Lemon `order_created`**: redacted JSON fixture(`server/fixtures/lemonsqueezy/order_created.redacted.json`) 및 idempotency 키 우선순위(주문 id → identifier → checkout_id → webhook_id) 테스트 고정

## 알고리즘·해설(향후)

- [x] **BSI/ADI** — multi-turn 기반 결정론적 신호와 product review 경로에 연결.
- [ ] **Concept Tagger·Explanation Planner·Claim Verification·Q&A Engine** — 핵심 경로 연결과 실제 기보 검증이 필요하며, 설계·행위 근거는 [`docs/algorithm/KataTalk_Algorithm_V2.5.md`](docs/algorithm/KataTalk_Algorithm_V2.5.md)를 따른다.

## 분석

- [x] **`analysis_jobs` Supabase 저장** — 상태·결과는 DB 행 기준 (`GET` 조회도 DB만 사용).
- [x] **mock 분석 worker 분리(스켈레톤)** — `claim_next_analysis_job` RPC + `pnpm worker:analysis` / `ANALYSIS_WORKER_MODE`. 운영에는 **`001 → 013` 전체 migration** 적용 필요.
- [x] **analysis_jobs worker heartbeat** — `heartbeatAnalysisJobLease` + running `progress` 갱신 시 `locked_at` 연장 + KataGo 구간 `ANALYSIS_WORKER_HEARTBEAT_SECONDS` 주기 갱신. **heartbeat RPC 예외·`LEASE_LOST`** 는 `completed`/환불 없이 **running** 유지(stale 재시도).
- [ ] **SGF 원문 보존 정책 확정** — MVP 는 `analysis_jobs.sgf_content` DB 컬럼; 운영 확대 시 **Supabase Storage/S3 이전**, **TTL 삭제**, 사용자 삭제 요청, raw artifact 권한 분리(README «SGF 원문 저장» 절 참고).
- [ ] **GET 완료 응답 + `data.sgf_content` 용량** — DB 원문을 JSON 응답에 병합하므로 대형 SGF·동시 폴링 시 **payload·대역폭** 부담이 커질 수 있음(업로드 상한은 기존 검증). 운영 전 **p95 응답 크기** 확인; 장기적으로 **`sgfUrl` presigned** 또는 **별도 다운로드 API**로 분리 검토.
- [x] **로컬 KataGo smoke 산출물 Git 제외** — `.tmp/katago/` 및 `raw-*` / `normalized-*` / `stderr-*` 명시 ignore, 광범위 `katago` 디렉터리 패턴을 **`/katago`(루트만)** 등으로 축소해 `docs/katago/`·`samples/` 등과 충돌 방지. 바이너리·모델·cfg 무시는 유지.
- [x] **KataGo worker v1 (raw capture)** — `ANALYSIS_ENGINE=katago` 일 때 Worker 가 실 binary 1회 실행, `analysis_jobs.result` 에 normalized 요약만 저장(BSI/ADI v1 수치·LLM 없음, Deep Search 미실행). timeout 시 SIGTERM→SIGKILL 시도.
- [x] **analysis plan v1** — SGF 전체 수 파싱·`turnIndex`/`player`/`gtpMove`·간격+최종국면 후보(`shared/analysisPlanV1.ts`, `server/analysisPlan.ts`). KataGo는 1회; `result.analysisPlan`에 동봉.
- [x] **multi-turn KataGo raw v1** — `analysisPlan` 후보별 착수 직전 국면 추가 분석(`turnAnalyses`, `multiTurnAnalysis`). 배치 시 stdout `id` 중복·누락 검증, 순차 폴백은 env 로만. 운영 전 **로컬 KataGo로 stdin JSONL 배치 smoke** 필수(README).
- [~] **KataGo worker 고도화** — root/multi-turn 동일 process/model 재사용, bounded C4, query failure 격리, child crash pending 정리, shutdown drain, 안전 설정 guard 완료. stdout 스트리밍·상한, raw Storage/artifact 정책, Worker RSS/GPU VRAM telemetry와 staging 환불/reclaim fault injection이 남음. 공유 C4 8건 whole-system peak delta 약 `2059.9MiB`
- [x] **BSI v1 (multi-turn 기반 수치)** — `result.bsiV1`·`components`·perspective 메타(`provisional`). KataGo score/winrate 축은 샘플 검증 후 확정. `top_mistakes`/해설 미사용.
- [x] **ADI v1 (signal only)** — `result.adiV1`·`deepSearchCandidate`·components(`visitEntropy` 등). **Deep Search 실행·`top_mistakes`/해설/LLM 없음.** `docs/algorithm/KataTalk_Algorithm_V2.5.md` 기준 Value & Search 단계 일부.
- [x] **Deep Search candidate plan v1** — `result.deepSearchPlan` 후보 `turnIndex`만(실행 없음). `final_position` 기본 제외·`DEEP_SEARCH_PLAN_*` env. `top_mistakes`/LLM 없음.
- [x] **Analysis Learning Events v1** — BSI/ADI/Deep Search plan·result/`turnAnalyses`/`winrateTimelineV1` 기반 deterministic 핵심 검토 후보 최대 5개. ViewModel `learningEvents` 및 후보 chip 우선 입력으로 사용. 추가 KataGo/LLM/`top_mistakes` 없음.
- [x] **분석 결과 ViewModel v1** — `buildAnalysisResultViewModel` (`shared/analysisResultViewModel.ts`): katago-worker-v1 / mock-legacy 분리, 후보·PV·검증된 흑백 승률 시리즈, 중립 라벨·경고문. metadata 없는 legacy 결과는 원시 관점 유지.
- [x] **결과 페이지 UI v1** — `AnalysisResultView` + 승률 SVG·후보 카드·참고도 PV·`BadukBoardView` SVG·수순 탐색. `sgf_content` 없으면 placeholder. 검증된 결과는 흑/백 토글, legacy/unknown은 비활성 안전 안내.
- [ ] **분석 결과 UI v3 모바일 수동 점검** — viewport `390x844`, `430x932`, `768x1024`, desktop `1440px` 에서 바둑판 overflow 없음, 수순 버튼 줄바꿈 없음, 승률 패널 접기/펼치기, 후보 chip horizontal scroll, AI 메모 버튼 wrap 확인.
- [x] **SGF playback / board ViewModel v1** — `shared/sgfPlaybackV1.ts` 메인라인·pass/중복/좌표·`buildAnalysisResultViewModel(data, { selectedTurnIndex })`. `sgf_content`/`sgfContent` 없으면 placeholder.
- [x] **SGF token parser + capture engine v1** — property bracket 이스케이프·주석 속 `;B[]` 오인 방지·변화도 skip 경고·liberty 기반 상대 포획(연결군). ko/자살 미완 경고.
- [x] **Baduk board renderer v1** — `BadukBoardView` SVG 격자·흑백돌·lastMove 링·ghost(참고 후보/PV). 보기 전용. 9/13/19 SZ.
- [x] **Board navigation v1** — `BoardTurnNavigation` + `shared/boardNavigationV1.ts`: 처음/이전/다음/끝·슬라이더·`{current}/{total}`. 승률·후보·참고도·보드 동일 `selectedTurnIndex`. mock/placeholder 미표시.
- [x] **Board keyboard navigation v1** — ←/→·Home/End로 `selectedTurnIndex` 보기 전용 이동. input/textarea/select/button/slider focus 시 비활성.
- [x] **Board navigation hardening** — `selectTurnIndex` clamp 통일·`defaultPrevented` 존중·`totalMoves=0` 비활성 UX.
- [ ] **바둑판 UX** — 착수 인터랙션·변화도 탐색·애니메이션 등은 미구현.
- [x] **결과 UI i18n** — `shared/analysisResultI18n.ts` + ViewModel `warnings`/`sgfPlayback.warnings` 코드화·`placeholder.messageKey`·후보 `labelKey`. `AnalysisResultView` 등은 `lang`(기존 `Language`)으로 문구 표시.
- [ ] **결과 UI / ViewModel 방어** — `turnAnalyses`·`candidateTurns` 등 비정형 배열 요소에 대한 정규화·필터 강화(현재 UI 일부에서 reason badge 등만 방어).
- [x] **Winrate perspective normalizer v1** — `shared/winratePerspectiveV1.ts`: raw clamp, `BLACK`/`WHITE`/`SIDETOMOVE` 변환, 명시적 current player 근거, legacy `katago_output_only` fallback.
- [x] **Winrate perspective hardening** — raw는 `typeof number` + finite만 유효. config 누락·중복·미지원·기대값 불일치와 current player 근거 누락은 fail-closed 또는 미변환.
- [x] **Winrate axis real-engine verification** — [`docs/winrate-axis-verification.md`](winrate-axis-verification.md): KataGo v1.16.4, config `BLACK`, 흑·백 차례·pass·setup stone product suite 4/4, 품질 0/0.
- [x] **Full-game winrate timeline v1** — Worker `analyzeTurns`·`result.winrateTimelineV1`·ViewModel/UI 우선(기본 `KATAGO_WINRATE_TIMELINE_ENABLED=false`). 축 metadata와 흑백 변환을 final/progress에 동일 적용.
- [x] **환경 변수 가이드** — [`docs/env-guide.md`](env-guide.md): Local / Railway Web / Worker·mock·GPU 프로파일.
- [x] **흑/백 승률 표시 토글** — 검증 metadata가 있는 결과에서 흑 기본·백 보완값 segmented control과 축 라벨 전환. legacy 결과 비활성. 390/430/1440 E2E 통과.
- [x] **KataGo Deep Search 실행** — feature flag 기반 선택형 실행과 결과 요약 경로 구현.
- [ ] **검증된 LLM 해설** — Claim 근거 검증을 포함한 선택형 해설 파이프라인을 실제 corpus로 검증.

## 최신 master 배포 전 smoke (체크리스트)

> 저장소에 migration SQL 파일이 **있는 것만으로는 부족**합니다. **운영 Supabase 프로젝트에 `001 → 013`이 적용됐는지** history·catalog·SQL로 확인하세요.
> 아래는 **문서화된 수동 절차**이며, 코드·스키마 변경은 포함하지 않습니다.

### Supabase `001 → 013` 적용 확인 절차

1. **적용 순서**: **001 → 002 → … → 013** 숫자순으로 고정한다. 이미 적용된 migration은 수정하지 않으며, 기존 DB는 reviewed baseline 없이는 fail-closed 한다.
2. **`007` 반영 여부** — SQL Editor 예시:
   - `claim_next_analysis_job` 시그니처: **`public.claim_next_analysis_job(text, integer)`** 존재(인자명은 DB마다 다를 수 있으나 **text + integer** 두 인자).
   - `analysis_jobs` 컬럼 존재: **`locked_at`**, **`locked_by`**, **`attempt_count`**, **`max_attempts`**, **`next_retry_at`**, **`last_error_code`** (`007_analysis_job_lease_retry.sql` 주석과 일치).
3. **`006` 반영 여부** — README **「SECURITY DEFINER RPC 권한 검증 (006 적용 후)」** 의 `has_function_privilege` 패턴으로 확인. 특히 **`public.claim_next_analysis_job(text, integer)`**: `anon` / `authenticated` = **false**, `service_role` = **true** 기대.
4. **클레임 스모크**: 서버·worker 가 쓰는 **service role** 로만 RPC 가 호출되는지(브라우저 anon 으로 RPC 직접 호출 불가) 배포 아키텍처와 함께 재확인.

### `ANALYSIS_CLAIM_STALE_SECONDS` 와 `ANALYSIS_WORKER_HEARTBEAT_SECONDS` 관계

- **`ANALYSIS_CLAIM_STALE_SECONDS`** (기본 **900**): `running` 인 job 의 **`locked_at`** 이 이 시간 이상 갱신되지 않으면 **stale** 로 간주되어 다른 worker 가 **`claim_next_analysis_job`** 으로 재claim 할 수 있음.
- **`ANALYSIS_WORKER_HEARTBEAT_SECONDS`** (기본 **60**, 코드상 하한·상한 clamp): 장시간 KataGo 실행 중 **`heartbeatAnalysisJobLease`** 등으로 **`locked_at` 연장** 주기.
- **운영 권장**: **heartbeat 주기 ≪ stale 초** (예: 60초 heartbeat vs 900초 stale). heartbeat 가 stale 보다 길거나 비슷하면 정상 처리 중에도 stale 오인·재claim 빈도가 늘 수 있음.

### Web / Worker 환경 변수 최종 체크리스트

| 구분            | 확인 항목                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **공통**        | `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Clerk, Lemon, `APP_BASE_URL` (HTTPS), `JWT_SECRET`                                                                                                                           |
| **Web**         | `ANALYSIS_WORKER_MODE=external`, `ANALYSIS_ENGINE=katago` (실분석 공개 시), **`KATATALK_ALLOW_MOCK_ANALYSIS` 미설정 또는 false**; **Web 에는 `KATAGO_*` 경로 불필요**(GPU worker 호스트에만 binary/model)                                        |
| **Worker**      | Web 과 동일 Supabase·Clerk 등 최소 동일 세트; **`ANALYSIS_ENGINE=katago`** + **`KATAGO_BINARY_PATH` / `KATAGO_CONFIG_PATH` / `KATAGO_MODEL_PATH` / `KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED`**; **`ANALYSIS_WORKER_ID`**(선택, lease 식별용) |
| **Lease**       | `ANALYSIS_CLAIM_STALE_SECONDS`, `ANALYSIS_WORKER_HEARTBEAT_SECONDS` — 위 관계 만족 여부                                                                                                                                                          |
| **Deep Search** | **`KATAGO_DEEP_SEARCH_ENABLED=false`** (또는 미설정) 가 **운영 기본 안전값**; 켤 경우에만 `KATAGO_DEEP_SEARCH_*` 검토                                                                                                                            |

### Deep Search **OFF** 기본 스모크 (프로덕션·스테이징 공통 권장)

1. Worker·배포 환경에서 **`KATAGO_DEEP_SEARCH_ENABLED=false`** (또는 변수 자체 미설정 → false 취급) 확인.
2. 인증 후 **SGF 업로드 → 분석 job 이 `completed`** 까지 도달하는지 UI 또는 `GET /api/analyze/:jobId` 로 확인.
3. 응답 `result.deepSearchResults` 에서 **`enabled === false`**, **`attemptedCount === 0`** (추가 KataGo 없음) 확인.
4. **`top_mistakes`** 가 **빈 배열 `[]`** 인지 확인(선정 로직 미구현 상태 유지).
5. **자연어 해설·LLM 전용 필드가 새로 생성되지 않는지** — `algorithmStage.notYetImplemented` 에 `llm_commentary` 등만 있고, 운영 결과에 **해설 텍스트 파이프라인 출력이 없는지** 샘플 1건으로 육안 확인.

### 결과 화면 수동 smoke

1. completed job id를 준비한다.
2. 로그인된 같은 사용자 세션에서 `/?jobId=<analysisJobId>` 또는 `/?analysisJobId=<analysisJobId>` 로 접속한다.
3. 기존 `GET /api/analyze/:jobId` owner check를 통과한 경우에만 결과 화면이 표시되는지 확인한다.
4. viewport `390x844`, `430x932`, `768x1024`, `1440x900` 에서 board, winrate graph, learningEvents 후보 chip, AI 메모, PV overlay, try-play local 동작을 확인한다.

### Deep Search **ON** 시 주의 (GPU Worker · 소규모만)

- **Railway/일반 CPU 프로덕션에서는 `true` 금지 권장.** 부하·지연·비용 급증.
- **`KATAGO_DEEP_SEARCH_ENABLED=true`** 는 **GPU 붙은 analysis worker** 에서만, **짧은 SGF·후보 1~2·낮은 visits** 로 스테이징 소규모 테스트.
- 성공 시에만 프로덕션 반영 검토; ON 시에도 **job 전체 failed/환불로 딥서치 행 실패가 전파되지 않는** 기존 정책(README Deep Search 절)을 전제로 동작만 확인.

## 운영 배포 체크리스트

- [ ] **최신 master 배포 전 smoke** — 위 **「최신 master 배포 전 smoke (체크리스트)」** 절(migration/ACL·env·Deep Search OFF/ON) 전부 수행
- [ ] Supabase migration **`001 → 013` 숫자 순서** 적용 및 DB gate 통과 (`012`: 원자 실패·환불, `013`: 11개 SECURITY DEFINER owner/search path/ACL 고정 — README와 database migration gate 참고)
- [ ] Clerk production 도메인·Redirect URL
- [ ] Lemon Squeezy live API key·store·webhook signing secret
- [ ] Lemon live variant ID 3종
- [ ] `APP_BASE_URL` production 공개 HTTPS URL
- [ ] Variant 가격·크레딧: Starter $4.99 / 20 · Standard $9.99 / 50 · Pro $29.99 / 200
- [ ] 결제 후 credits 증가 수동 테스트·`credit_logs` 확인
- [ ] Rate limit 429 동작 확인 (멀티 인스턴스 시 Redis/Upstash 등 검토)
- [ ] Production 에서 **mock 전용** 비활성(`KATATALK_ALLOW_MOCK_ANALYSIS`) 및 **KataGo 실분석**(`ANALYSIS_ENGINE=katago` + `ANALYSIS_WORKER_MODE=external`) enqueue 동작 확인
- [x] **KataGo·LLM 미구현 범위 UI/README 표기** — GPT-4o·자연어 해설·패착 확정 등 과장 문구 완화, BSI/ADI/deepSearchPlan 은 내부 신호임을 명시.
- [ ] 환불 정책·약관 법무 검토

## Database migration gate

- [~] `001 → 013` 숫자순 migration runner와 `pnpm db:migrate:supabase`/`pnpm test:db:migrations` 구현 및 GitHub PostgreSQL 16 CI 통과. same-commit security/application-structure contract, DB↔HTTP project binding, clean-checkout/digest 검증, `pnpm db:evidence:staging` 읽기 전용 collector와 protected manual workflow 구현; 실제 staging environment 구성·성공 snapshot과 기존 DB baseline 승인 대기. 기존 DB는 reviewed baseline 없이는 fail-closed.
