# KataTalk — 이후 작업 TODO

> 베타에서는 결제 UI가 **Lemon Squeezy** 만 사용합니다( **일회성 크레딧 팩 구매** , 구독 모델 아님). **Toss** 는 **향후 국내 결제 옵션**으로 검토하며(`tossProvider` 스켈레톤) **현재 checkout UI 에는 노출하지 않습니다**. Paddle 은 **추후 fallback 후보**로만 문서에 남기며 코드는 추가하지 않습니다.

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

- [ ] **BSI/ADI·Concept Tagger·Explanation Planner·Claim Verification·Q&A Engine** — 구현 시 설계·행위 근거는 **최종 알고리즘 기준 문서** [`docs/algorithm/KataTalk_Algorithm_V2.5.md`](docs/algorithm/KataTalk_Algorithm_V2.5.md)를 따른다.

## 분석

- [x] **`analysis_jobs` Supabase 저장** — 상태·결과는 DB 행 기준 (`GET` 조회도 DB만 사용).
- [x] **mock 분석 worker 분리(스켈레톤)** — `claim_next_analysis_job` RPC + `pnpm worker:analysis` / `ANALYSIS_WORKER_MODE`. **004+007** 마이그레이션 적용 필요.
- [x] **analysis_jobs worker heartbeat** — `heartbeatAnalysisJobLease` + running `progress` 갱신 시 `locked_at` 연장 + KataGo 구간 `ANALYSIS_WORKER_HEARTBEAT_SECONDS` 주기 갱신. **heartbeat RPC 예외·`LEASE_LOST`** 는 `completed`/환불 없이 **running** 유지(stale 재시도).
- [ ] **SGF 원문 보존 정책 확정** — MVP 는 `analysis_jobs.sgf_content` DB 컬럼; 운영 확대 시 **Supabase Storage/S3 이전**, **TTL 삭제**, 사용자 삭제 요청, raw artifact 권한 분리(README «SGF 원문 저장» 절 참고).
- [ ] **GET 완료 응답 + `data.sgf_content` 용량** — DB 원문을 JSON 응답에 병합하므로 대형 SGF·동시 폴링 시 **payload·대역폭** 부담이 커질 수 있음(업로드 상한은 기존 검증). 운영 전 **p95 응답 크기** 확인; 장기적으로 **`sgfUrl` presigned** 또는 **별도 다운로드 API**로 분리 검토.
- [x] **로컬 KataGo smoke 산출물 Git 제외** — `.tmp/katago/` 및 `raw-*` / `normalized-*` / `stderr-*` 명시 ignore, 광범위 `katago` 디렉터리 패턴을 **`/katago`(루트만)** 등으로 축소해 `docs/katago/`·`samples/` 등과 충돌 방지. 바이너리·모델·cfg 무시는 유지.
- [x] **KataGo worker v1 (raw capture)** — `ANALYSIS_ENGINE=katago` 일 때 Worker 가 실 binary 1회 실행, `analysis_jobs.result` 에 normalized 요약만 저장(BSI/ADI v1 수치·LLM 없음, Deep Search 미실행). timeout 시 SIGTERM→SIGKILL 시도.
- [x] **analysis plan v1** — SGF 전체 수 파싱·`turnIndex`/`player`/`gtpMove`·간격+최종국면 후보(`shared/analysisPlanV1.ts`, `server/analysisPlan.ts`). KataGo는 1회; `result.analysisPlan`에 동봉.
- [x] **multi-turn KataGo raw v1** — `analysisPlan` 후보별 착수 직전 국면 추가 분석(`turnAnalyses`, `multiTurnAnalysis`). 배치 시 stdout `id` 중복·누락 검증, 순차 폴백은 env 로만. 운영 전 **로컬 KataGo로 stdin JSONL 배치 smoke** 필수(README).
- [ ] **KataGo worker 고도화** — stdout 스트리밍·상한, raw Storage/artifact 정책, GPU 호스트 분리.
- [x] **BSI v1 (multi-turn 기반 수치)** — `result.bsiV1`·`components`·perspective 메타(`provisional`). KataGo score/winrate 축은 샘플 검증 후 확정. `top_mistakes`/해설 미사용.
- [x] **ADI v1 (signal only)** — `result.adiV1`·`deepSearchCandidate`·components(`visitEntropy` 등). **Deep Search 실행·`top_mistakes`/해설/LLM 없음.** `docs/algorithm/KataTalk_Algorithm_V2.5.md` 기준 Value & Search 단계 일부.
- [x] **Deep Search candidate plan v1** — `result.deepSearchPlan` 후보 `turnIndex`만(실행 없음). `final_position` 기본 제외·`DEEP_SEARCH_PLAN_*` env. `top_mistakes`/LLM 없음.
- [x] **분석 결과 ViewModel v1** — `buildAnalysisResultViewModel` (`shared/analysisResultViewModel.ts`): katago-worker-v1 / mock-legacy 분리, 후보·PV·승률 시리즈(katago_output 원시만), 중립 라벨·경고문. 바둑판/차트 UI 미포함.
- [x] **결과 페이지 UI v1** — `AnalysisResultView` + 승률 SVG·후보 카드·참고도 PV·`BadukBoardView` SVG·수순 탐색. `sgf_content` 없으면 placeholder. mock-legacy / unknown 별도 안내. 흑/백 승률 토글은 비활성(준비 중).
- [x] **SGF playback / board ViewModel v1** — `shared/sgfPlaybackV1.ts` 메인라인·pass/중복/좌표·`buildAnalysisResultViewModel(data, { selectedTurnIndex })`. `sgf_content`/`sgfContent` 없으면 placeholder.
- [x] **SGF token parser + capture engine v1** — property bracket 이스케이프·주석 속 `;B[]` 오인 방지·변화도 skip 경고·liberty 기반 상대 포획(연결군). ko/자살 미완 경고.
- [x] **Baduk board renderer v1** — `BadukBoardView` SVG 격자·흑백돌·lastMove 링·ghost(참고 후보/PV). 보기 전용. 9/13/19 SZ.
- [x] **Board navigation v1** — `BoardTurnNavigation` + `shared/boardNavigationV1.ts`: 처음/이전/다음/끝·슬라이더·`{current}/{total}`. 승률·후보·참고도·보드 동일 `selectedTurnIndex`. mock/placeholder 미표시.
- [x] **Board keyboard navigation v1** — ←/→·Home/End로 `selectedTurnIndex` 보기 전용 이동. input/textarea/select/button/slider focus 시 비활성.
- [x] **Board navigation hardening** — `selectTurnIndex` clamp 통일·`defaultPrevented` 존중·`totalMoves=0` 비활성 UX.
- [ ] **바둑판 UX** — 착수 인터략션·변화도 탐색·흑백 승률 토글·애니메이션 등은 미구현.
- [x] **결과 UI i18n** — `shared/analysisResultI18n.ts` + ViewModel `warnings`/`sgfPlayback.warnings` 코드화·`placeholder.messageKey`·후보 `labelKey`. `AnalysisResultView` 등은 `lang`(기존 `Language`)으로 문구 표시.
- [ ] **결과 UI / ViewModel 방어** — `turnAnalyses`·`candidateTurns` 등 비정형 배열 요소에 대한 정규화·필터 강화(현재 UI 일부에서 reason badge 등만 방어).
- [x] **Winrate perspective normalizer v1** — `shared/winratePerspectiveV1.ts`: raw clamp·`katago_output_only`/`unverified`·evidence. `blackWinrate`/`whiteWinrate` null. 차트는 KataGo 관점 유지.
- [x] **Winrate perspective hardening** — raw 는 `typeof number` + finite 만 유효(문자열·boolean·NaN·Infinity → `unverified`). `displayLabelKey` → `translateWinrateDisplayLabelKey`. `verified` 승격 미구현(`WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1` 문서화만).
- [x] **Winrate axis sample verification (docs)** — `docs/winrate-axis-verification.md`·`server/fixtures/winrateAxisSamplesV1.ts`·승격 조건·변환 공식 후보. 코드 변환/토글/verified 생성 없음.
- [ ] **흑/백 승률 표시 토글** — 실제 KataGo 샘플로 축 확정·`WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1` 충족 후 `verified` 승격·토글 UX.
- [ ] **KataGo / LLM** — Deep Search 실행·해설 파이프라인(V2.5 문서 기준).

## 최신 master 배포 전 smoke (체크리스트)

> 저장소에 `006`/`007` SQL 파일이 **있는 것만으로는 부족**합니다. **운영 Supabase 프로젝트에 동일 마이그레이션이 적용됐는지** 대시보드·SQL로 확인하세요.  
> 아래는 **문서화된 수동 절차**이며, 코드·스키마 변경은 포함하지 않습니다.

### Supabase `006` / `007` 적용 확인 절차

1. **적용 순서**: 기존과 동일하게 **001 → … → 005 → 004 → 007 → 006** 권장(007이 무인자 `claim_next_analysis_job()` 을 대체한 뒤, 006이 RPC EXECUTE 를 잠금). 이미 운영에 004만 있는 경우 **007 적용 전 백업·다운타임** 정책을 팀 규칙에 맞출 것.
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

| 구분 | 확인 항목 |
|------|------------|
| **공통** | `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Clerk, Lemon, `APP_BASE_URL` (HTTPS), `JWT_SECRET` |
| **Web** | `ANALYSIS_WORKER_MODE=external`, `ANALYSIS_ENGINE=katago` (실분석 공개 시), **`KATATALK_ALLOW_MOCK_ANALYSIS` 미설정 또는 false**; **Web 에는 `KATAGO_*` 경로 불필요**(GPU worker 호스트에만 binary/model) |
| **Worker** | Web 과 동일 Supabase·Clerk 등 최소 동일 세트; **`ANALYSIS_ENGINE=katago`** + **`KATAGO_BINARY_PATH` / `KATAGO_CONFIG_PATH` / `KATAGO_MODEL_PATH`**; **`ANALYSIS_WORKER_ID`**(선택, lease 식별용) |
| **Lease** | `ANALYSIS_CLAIM_STALE_SECONDS`, `ANALYSIS_WORKER_HEARTBEAT_SECONDS` — 위 관계 만족 여부 |
| **Deep Search** | **`KATAGO_DEEP_SEARCH_ENABLED=false`** (또는 미설정) 가 **운영 기본 안전값**; 켤 경우에만 `KATAGO_DEEP_SEARCH_*` 검토 |

### Deep Search **OFF** 기본 스모크 (프로덕션·스테이징 공통 권장)

1. Worker·배포 환경에서 **`KATAGO_DEEP_SEARCH_ENABLED=false`** (또는 변수 자체 미설정 → false 취급) 확인.
2. 인증 후 **SGF 업로드 → 분석 job 이 `completed`** 까지 도달하는지 UI 또는 `GET /api/analyze/:jobId` 로 확인.
3. 응답 `result.deepSearchResults` 에서 **`enabled === false`**, **`attemptedCount === 0`** (추가 KataGo 없음) 확인.
4. **`top_mistakes`** 가 **빈 배열 `[]`** 인지 확인(선정 로직 미구현 상태 유지).
5. **자연어 해설·LLM 전용 필드가 새로 생성되지 않는지** — `algorithmStage.notYetImplemented` 에 `llm_commentary` 등만 있고, 운영 결과에 **해설 텍스트 파이프라인 출력이 없는지** 샘플 1건으로 육안 확인.

### Deep Search **ON** 시 주의 (GPU Worker · 소규모만)

- **Railway/일반 CPU 프로덕션에서는 `true` 금지 권장.** 부하·지연·비용 급증.
- **`KATAGO_DEEP_SEARCH_ENABLED=true`** 는 **GPU 붙은 analysis worker** 에서만, **짧은 SGF·후보 1~2·낮은 visits** 로 스테이징 소규모 테스트.
- 성공 시에만 프로덕션 반영 검토; ON 시에도 **job 전체 failed/환불로 딥서치 행 실패가 전파되지 않는** 기존 정책(README Deep Search 절)을 전제로 동작만 확인.

## 운영 배포 체크리스트

- [ ] **최신 master 배포 전 smoke** — 위 **「최신 master 배포 전 smoke (체크리스트)」** 절(006/007·env·Deep Search OFF/ON) 전부 수행
- [ ] Supabase 마이그레이션 **001 / 002 / 003 / 004 / 005 / 006 / 007** 적용 (**006**: SECURITY DEFINER RPC EXECUTE 잠금, **007**: `analysis_jobs` lease·`claim_next_analysis_job(worker_id, stale_seconds)` stale 재claim — README「SECURITY DEFINER RPC 권한 검증」·마이그레이션 목록 참고)
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
