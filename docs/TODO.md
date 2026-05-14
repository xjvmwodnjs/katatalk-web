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
- [x] **analysis_jobs worker heartbeat** — `heartbeatAnalysisJobLease` + running `progress` 갱신 시 `locked_at` 연장 + KataGo 구간 `ANALYSIS_WORKER_HEARTBEAT_SECONDS` 주기 갱신.
- [ ] **SGF 원문 보존 정책 확정** — MVP 는 `analysis_jobs.sgf_content` DB 컬럼; 운영 확대 시 **Supabase Storage/S3 이전**, **TTL 삭제**, 사용자 삭제 요청, raw artifact 권한 분리(README «SGF 원문 저장» 절 참고).
- [x] **로컬 KataGo smoke 산출물 Git 제외** — `.tmp/katago/` 및 `raw-*` / `normalized-*` / `stderr-*` 명시 ignore, 광범위 `katago` 디렉터리 패턴을 **`/katago`(루트만)** 등으로 축소해 `docs/katago/`·`samples/` 등과 충돌 방지. 바이너리·모델·cfg 무시는 유지.
- [x] **KataGo worker v1 (raw capture)** — `ANALYSIS_ENGINE=katago` 일 때 Worker 가 실 binary 1회 실행, `analysis_jobs.result` 에 normalized 요약만 저장(BSI/ADI v1 수치·LLM 없음, Deep Search 미실행). timeout 시 SIGTERM→SIGKILL 시도.
- [x] **analysis plan v1** — SGF 전체 수 파싱·`turnIndex`/`player`/`gtpMove`·간격+최종국면 후보(`shared/analysisPlanV1.ts`, `server/analysisPlan.ts`). KataGo는 1회; `result.analysisPlan`에 동봉.
- [x] **multi-turn KataGo raw v1** — `analysisPlan` 후보별 착수 직전 국면 추가 분석(`turnAnalyses`, `multiTurnAnalysis`). 배치 시 stdout `id` 중복·누락 검증, 순차 폴백은 env 로만. 운영 전 **로컬 KataGo로 stdin JSONL 배치 smoke** 필수(README).
- [ ] **KataGo worker 고도화** — stdout 스트리밍·상한, raw Storage/artifact 정책, GPU 호스트 분리.
- [x] **BSI v1 (multi-turn 기반 수치)** — `result.bsiV1`·`components`·perspective 메타(`provisional`). KataGo score/winrate 축은 샘플 검증 후 확정. `top_mistakes`/해설 미사용.
- [x] **ADI v1 (signal only)** — `result.adiV1`·`deepSearchCandidate`·components(`visitEntropy` 등). **Deep Search 실행·`top_mistakes`/해설/LLM 없음.** `docs/algorithm/KataTalk_Algorithm_V2.5.md` 기준 Value & Search 단계 일부.
- [x] **Deep Search candidate plan v1** — `result.deepSearchPlan` 후보 `turnIndex`만(실행 없음). `final_position` 기본 제외·`DEEP_SEARCH_PLAN_*` env. `top_mistakes`/LLM 없음.
- [ ] **`deepSearchResults` v1** — Deep Search **실행** 산출물은 `deepSearchPlan`에 넣지 않고 별도 스키마(`deepSearchResults` v1)로 분리·저장(후보 계획과 실행 결과 경계).
- [ ] **KataGo / LLM** — Deep Search 실행·해설 파이프라인(V2.5 문서 기준).

## 운영 배포 체크리스트

- [ ] Supabase 마이그레이션 **001 / 002 / 003 / 004 / 005 / 006 / 007** 적용 (**006**: SECURITY DEFINER RPC EXECUTE 잠금, **007**: `analysis_jobs` lease·`claim_next_analysis_job(worker_id, stale_seconds)` stale 재claim — README「SECURITY DEFINER RPC 권한 검증」·마이그레이션 목록 참고)
- [ ] Clerk production 도메인·Redirect URL
- [ ] Lemon Squeezy live API key·store·webhook signing secret
- [ ] Lemon live variant ID 3종
- [ ] `APP_BASE_URL` production 공개 HTTPS URL
- [ ] Variant 가격·크레딧: Starter $4.99 / 20 · Standard $9.99 / 50 · Pro $29.99 / 200
- [ ] 결제 후 credits 증가 수동 테스트·`credit_logs` 확인
- [ ] Rate limit 429 동작 확인 (멀티 인스턴스 시 Redis/Upstash 등 검토)
- [ ] Production 에서 **mock 전용** 비활성(`KATATALK_ALLOW_MOCK_ANALYSIS`) 및 **KataGo 실분석**(`ANALYSIS_ENGINE=katago` + `ANALYSIS_WORKER_MODE=external`) enqueue 동작 확인
- [ ] KataGo·LLM 미구현 상태 UI/문서 표시
- [ ] 환불 정책·약관 법무 검토
