# KataTalk 상용화 통합 리뷰

- 기준일: 2026-07-16
- 대상: KataTalk AI 바둑 기보 분석 서비스
- 문서 역할: 구현 현황, 출시 판정, 검증 근거, 다음 작업의 단일 기준 문서

## 0. 문서 운영 규칙

다음 작업자는 작업을 시작하기 전에 이 문서를 읽고, 작업을 마칠 때 아래 항목을 함께 갱신한다.

1. 현재 판정과 달성률
2. 작업 목록의 상태 및 완료 근거
3. 검증 기준선과 실제 실행 결과
4. 변경 이력

코드가 존재한다는 사실만으로 완료 처리하지 않는다. 실제 고객 경로, 실패 복구, 관측 가능성, 운영 문서와 재현 가능한 검증 근거가 모두 있어야 상용화 완료로 인정한다.

## 1. 현재 판정

| 항목                    | 판정      |
| ----------------------- | --------- |
| 공개 유료 베타 준비도   | **76%**   |
| 정식 상용 서비스 준비도 | **57%**   |
| 불특정 공개 트래픽 출시 | **NO-GO** |
| 통제된 내부/초대형 베타 | **GO**    |

공개 유료 베타 준비도는 아래 가중치로 계산했다. 구현량이 아니라 고객이 돈을 지불한 뒤 결과를 안정적으로 받는 전체 경로를 기준으로 한다.

| 영역                    | 가중치 | 영역 점수 |     가중 점수 |
| ----------------------- | -----: | --------: | ------------: |
| AI 분석 정확성·품질     |     25 |        74 |          18.5 |
| 결과 UI/UX              |     15 |        81 |          12.2 |
| 인증·보안               |     10 |        78 |           7.8 |
| 결제·크레딧 정합성      |     15 |        73 |          11.0 |
| KataGo 런타임·작업 처리 |     15 |        90 |          13.5 |
| 운영·관측·복구          |     10 |        56 |           5.6 |
| QA·릴리스 자동화        |     10 |        78 |           7.8 |
| 합계                    |    100 |           | **76.3 → 76** |

가장 큰 출시 차단 요인은 실제 고객 기보 품질 검증, staging queue·장시간 soak SLO, 완전한 스테이징 결제 E2E, 메트릭·알림, 약관·개인정보·환불 정책이다.

## 2. 저장소와 시스템 현황

정리 후 기준:

- 저장소 파일 319개
- 클라이언트 소스 38개
- 단위 테스트 파일 74개, 테스트 702개 (직렬 CI 게이트 기준)
- Playwright 스펙 1개, 시나리오 4개
- 직접 런타임 의존성 33개, 개발 의존성 21개
- GitHub Actions, Dockerfile, Railway/Render 배포 매니페스트 없음
- LICENSE 파일, SECURITY.md, PRIVACY.md, TERMS.md 없음

주요 처리 흐름:

```text
Browser
  -> Clerk 인증
  -> Web API: 크레딧 spend + 분석 작업 enqueue
  -> Supabase: 작업/원장/분석 결과
  -> 외부 Worker: lease + heartbeat + stale fencing
  -> KataGo: root/multi-turn/BSI/ADI/deep/timeline
  -> 품질 게이트 + Product Review ViewModel
  -> 결과 UI

Lemon Squeezy
  -> raw-body HMAC webhook
  -> 안정적인 order idempotency key
  -> credit RPC
  -> credit ledger
```

## 3. 구현된 기능

### 3.1 고객 UI

- SGF 업로드와 분석 작업 생성
- 9x9, 13x13, 19x19 보드 렌더링
- 진행 중 작업의 deep link 복원과 polling
- 후보 수순, PV, 착수 전후 수치, 주요 장면 탐색
- Try-play와 수순 이동
- 분석 보고서와 학습 이벤트 표시
- 한국어/영어 i18n
- 데스크톱 및 모바일 핵심 경로 Playwright 검증

### 3.2 인증과 권한

- Clerk Bearer 인증
- 프로덕션에서 인증 설정 누락 시 fail-closed
- 분석 작업과 결과 owner 검증
- 서버 전용 service-role RPC
- Worker lease, heartbeat, stale job fencing

### 3.3 결제와 크레딧

- Lemon Squeezy checkout
- 서버 기준 패키지·가격 매핑
- raw-body HMAC webhook 검증
- 주문 단위 idempotency
- 크레딧 spend/refund RPC
- 원장 감사 스크립트

### 3.4 KataGo 분석

- SGF main line 파싱과 초기 배치 처리
- root 분석
- 중요 장면 기반 multi-turn 분석
- BSI와 ADI 지표
- 선택형 Deep Search
- 선택형 승률 timeline
- 학습 이벤트 생성
- 결정론적 product review 생성
- 필수 필드와 근거 연결을 검사하는 구조적 품질 게이트
- `KATAGO_PERSISTENT_ROOT_ENABLED` feature flag 기반 persistent root session
- root와 multi-turn이 동일 process/model을 재사용하는 `KATAGO_PERSISTENT_MULTI_TURN_ENABLED` 경로
- persistent query 실패 수만 기존 batch/sequential 경로로 선택 재시도하고 strict 모드에서는 fallback 차단
- Worker당 C1~C4 bounded job scheduler, in-flight drain, job별 실패 격리
- C2~C4에서 strict 공유 세션과 job별 multi-turn fan-out 1을 강제하는 startup guard
- 공유 KataGo session의 다중 pending query multiplex와 pending-aware idle close
- standalone smoke/suite 종료 시 공유 KataGo session 명시 정리
- 실제 analysis config의 `reportAnalysisWinratesAs`를 파싱하고 기대값 불일치 시 Worker 시작을 차단하는 승률 축 검증
- 검증된 승률 축 metadata 저장, 흑/백 승률 변환, legacy 결과의 추측 없는 원시 관점 fallback

## 4. AI 분석 상세 평가

### 4.1 현재 강점

분석 결과가 단순 LLM 요약에 의존하지 않고 KataGo 수치, 후보 수순, PV와 연결된다. Worker는 분석 계획을 세우고 root/multi-turn/선택형 보강 분석을 실행한 뒤 결정론적 ViewModel을 만든다. 이 구조는 비용 통제, 재현성, 잘못된 자연어 생성의 영향 제한 측면에서 적절하다.

persistent root product path도 실제 Worker 경로에 통합되었다. 25 visits, multi-turn 2, timeline/deep off 조건의 customer-style fixture 4건 결과는 다음과 같다.

- 성공: 4/4
- 전체 시간: 97,695ms
- p50: 19,979ms
- p95: 37,081ms
- 품질 경고 행: 0
- 품질 실패 행: 0
- warm root 분석: 451ms, 476ms, 494ms

기본 운영 후보인 root 200 visits, multi-turn 6, persistent root strict 기준선도 customer-style 4건에서 통과했다.

- 성공: 4/4
- 전체 시간: 203,253ms
- p50: 53,004ms
- p95: 55,665ms
- 품질 경고/실패 행: 0/0
- cold root: 23,463ms
- warm root: 4,124~4,838ms
- warm fixture non-root 비중: 약 90~92%

같은 프로필에 persistent multi-turn strict를 적용한 최신 결과는 다음과 같다.

- 성공: 4/4
- 전체 시간: 94,138ms, 기준선 대비 53.7% 감소
- p50: 23,053ms, 기준선 대비 56.5% 감소
- p95: 30,769ms, 기준선 대비 44.7% 감소
- 품질 경고/실패 행: 0/0
- 실제 25 visits/2 turns smoke의 multi-turn: 18,820ms → 508ms
- 10분 idle-close 설정에서도 standalone CLI shell 22.6초 반환

세부 근거는 [`docs/katago-operating-profile-2026-07-14.md`](katago-operating-profile-2026-07-14.md)에 기록했다. 이후 결과에는 `engine.phaseDurationsMs`와 suite `Root/MT ms` 열이 자동으로 남는다.

같은 200/6 프로필의 burst 4건도 재측정했다. C1 품질은 4/4였고 engine p95 55,365ms, queue p95 68,406ms, E2E p95 70,651ms, 처리량 3.4 jobs/min, whole-system peak delta 약 2,128MiB였다. 기존 root-only 측정보다 queue p95 61.5%, E2E p95 69.8%, peak delta 37.7%가 줄었지만 queue 30초 SLO는 여전히 실패했다. C2는 필요 5,280MiB 대비 free 4,191.5MiB, C4는 필요 9,536MiB 대비 free 4,163MiB여서 안전 차단됐다. 세부 근거는 [`docs/katago-concurrency-capacity-2026-07-14.md`](katago-concurrency-capacity-2026-07-14.md)에 기록했다.

이 격리 process 병목을 제거하기 위해 Worker 한 프로세스가 job 4개를 bounded 처리하고 KataGo child/model 하나를 공유하도록 변경했다. 서로 다른 customer-style fixture 4개를 200 visits/6 turns로 동시에 실행한 정식 C4 gate 결과는 4/4 성공, engine p95 71,882ms, queue p95 0ms, E2E p95 71,915ms, 약 3.34 jobs/min, 품질 경고/실패 0/0이었다. 네 결과 모두 root/multi-turn persistent 경로를 사용했고 persistent query 실패는 0건이었다. 직렬 customer-style 기준 94,138ms 대비 전체 완료 시간은 23.6% 감소했다. 로컬 권장 구조의 C4 latency·품질 판정은 GO지만, 이 스위트는 메모리를 표본화하지 않았고 실제 Supabase queue·고객 corpus·장시간 soak는 아직 검증하지 않았다.

후속으로 반복 순서를 round-robin으로 보정하고 C4 2회, 총 8건 mini-soak에 whole-system memory와 throughput gate를 추가했다. 결과는 8/8 성공, engine p95 75,296ms, queue p95 72,572ms, E2E p95 81,686ms, 5.88 jobs/min, peak used delta 2,059.9MiB, minimum free 8,423MiB, 품질 경고/실패 0/0으로 모든 gate를 통과했다. 8개 모두 root/multi-turn persistent와 persistent 실패 0을 기록했다. 이 메모리 수치는 Worker RSS/GPU VRAM이 아니라 다른 프로세스 변동을 포함한 whole-system 근삿값이다.

또한 개별 multi-turn query 실패가 공유 session을 닫아 unrelated in-flight job까지 중단시키던 fault-domain을 제거했다. query 실패는 해당 turn/job에만 격리하고, child 자체가 종료되면 모든 pending promise를 reject·정리한 뒤 다음 요청에서 새 child를 생성하는 테스트를 추가했다.

실제 corpus를 받기 위한 manifest v1 경로도 구현했다. 각 SGF의 SHA-256, 경로 confinement, 1MB/UTF-8, 중복, 식별 metadata, 실제 파싱에서 도출한 필수 coverage를 사전 검사한다. product suite에서는 manifest별 최소 visits, turn 성공/실패, BSI/ADI, quality warning/failure 기대값을 개별 행에 적용한다. `--require-human-review`는 기보마다 서로 다른 검수자 2명의 승인과 rejection 부재를 강제한다.

승률 축은 KataGo 공식 Analysis Engine 계약과 실제 config를 기준으로 검증했다. Worker는 `BLACK`, `WHITE`, `SIDETOMOVE` 중 활성 설정 하나를 읽고 선택적인 기대 환경 변수와 비교하며, 누락·중복·미지원·불일치는 시작 단계에서 차단한다. 분석 결과와 timeline에는 검증된 관점이 기록되고 product quality gate도 이를 요구한다. metadata가 없는 기존 결과는 흑/백을 추측하지 않는다. KataGo v1.16.4 실엔진의 pass, setup stone 접바둑, 흑·백 차례 포함 fixture 4건은 4/4, 품질 경고/실패 0/0이었고 모든 행에서 흑+백 표시 합계가 100%였다. 세부 계약과 수치는 [`docs/winrate-axis-verification.md`](winrate-axis-verification.md)에 기록했다.

### 4.2 해석 시 주의점

`qualityGate=ok`는 필드 존재, 수치 일관성, 근거 연결 같은 구조적 조건을 통과했다는 뜻이다. 사람 관점의 착점 해설 정확성, 교육적 유용성, 표현 자연스러움까지 증명하지 않는다.

현재 안전한 제품 약속은 다음 수준이다.

> KataGo 수치 근거와 후보 수순을 제공하는 결정론적 기보 검토

실제 사용자 검증 전에는 프로 수준 해설, 실수의 절대적 판정, 개인 맞춤 코칭을 마케팅 문구로 확정하면 안 된다.

### 4.3 남은 핵심 위험

- 검증 corpus가 합성 fixture 중심이며 실제 고객 SGF가 없음
- 200 visits, multi-turn 6 측정은 synthetic fixture 기준이며 실제 고객 corpus 분포를 검증하지 않음
- persistent multi-turn과 공유 C4는 synthetic fixture에서만 검증됐고 실제 고객 기보 장시간 안정성 근거가 없음
- timeline과 deep search는 여전히 별도 고비용 실행 경로이며 운영 비용이 미측정임
- 공유 process C4의 Worker RSS/GPU VRAM telemetry와 staging child crash 환불·재claim 검증이 없음
- 승률 축 변환 계약은 실엔진 합성 fixture에서 검증됐지만 실제 고객 corpus 분포와 사람 검수는 아직 없음
- 클라이언트 재생기는 variation을 건너뛰며 ko/suicide 규칙 처리가 완전하지 않음
- Concept, Explanation, Claim, LLM 경로가 핵심 제품 경로에 연결되지 않음
- `top_mistakes`가 실사용 결과에서 충분히 채워지는지 검증되지 않음

## 5. UI/UX 상세 평가

보드 중심 결과 화면, 핵심 장면 탐색, 후보 수순과 PV, Try-play는 유료 분석 서비스의 핵심 작업 흐름에 맞는다. 결과 deep link와 진행 중 작업 복원도 구현되어 있다.

검증된 승률 metadata가 있는 결과에서는 흑 승률을 기본으로 하는 흑/백 segmented control을 제공하고 백 선택 시 보완값으로 그래프와 축 라벨을 함께 전환한다. legacy 결과에는 비활성 control과 안전한 원시 관점 안내를 유지한다. `390x844`, `430x932`, `1440x900` E2E에서 토글과 SVG 축 라벨 전환을 검증했다.

이번 정리에서 polling 경로를 수정했다.

- 작업 상태 polling을 450ms에서 1초로 완화
- timeline polling을 2초로 제한
- timeline endpoint가 404이면 해당 작업에서 추가 호출 중단
- 429 응답 시 5초 backoff 후 복구

기존 구현은 상태와 timeline 요청이 같은 120회/분 limiter를 공유하면서 비활성 timeline endpoint를 계속 호출했다. 장시간 분석에서 429가 발생하고 화면이 실패 상태로 돌아갈 수 있었으며, 이를 Playwright 회귀 테스트로 고정했다.

남은 UX 작업:

- 실제 queue position과 예상 대기시간
- 분석 취소, 명확한 재시도, 환불 상태
- 완료 알림
- 접근성 키보드 탐색과 스크린리더 검증
- 768px 전후 태블릿 레이아웃 검증
- 시각 회귀 테스트
- Home 약 222KB, Clerk 약 321KB, React 약 397KB chunk의 초기 로딩 최적화

## 6. 결제·보안·운영 평가

### 6.1 결제

서버 가격 매핑, 서명 검증, idempotency, spend/refund RPC와 원장 구조는 적절하다. 다만 Lemon Squeezy 실계정의 구매, webhook replay, chargeback, 취소, 환불을 스테이징에서 끝까지 검증한 근거가 없다. 결제 성공과 분석 실패가 함께 발생한 경우의 고객 안내도 보강해야 한다.

### 6.2 보안

인증 fail-closed와 owner 검증은 구현되어 있다. 남은 항목은 Helmet/CSP/HSTS 등 HTTP 보안 헤더, 분산 환경용 Redis rate limiter, 50MB 전역 JSON body 제한 축소, CI secret/dependency scan, SGF 보관 기간과 삭제 정책이다.

`@clerk/clerk-react`는 deprecated 상태다. `@clerk/react`로의 이전은 인증 회귀 위험이 있으므로 별도 작업으로 진행하고 실제 Clerk 환경 E2E를 동반해야 한다.

### 6.3 운영

health/readiness, Worker lease/heartbeat, stale fencing, bounded C4 scheduler와 shutdown drain, deploy smoke, 원장 감사는 존재한다. 로컬 동시성 도구로 queue wait, engine, end-to-end, 처리량, whole-system memory를 분리 측정할 수 있고 권장 단일 공유 process C4의 순간 gate와 8건 mini-soak가 통과했다. 그러나 중앙 queue depth, 작업 시간, 실패율, 자동 환불, webhook 오류, Worker RSS/GPU VRAM 메트릭과 경보가 없고 실제 staging queue claim도 아직 검증하지 않았다. 단일 인스턴스 메모리 rate limiter도 수평 확장에 맞지 않는다.

## 7. 2026-07-14 정리 결과

- 진입점 의존성 그래프로 도달 불가능한 클라이언트 TS/TSX 61개 제거
- 오래된 루트 진행 메모와 중복 보고서 13개 제거
- `.tmp`, `analysis_logs`, `dist`, `test-results`, `.webdev`, 개발 서버 로그 정리
- 실제 import와 설정을 기준으로 직접 의존성 42개 제거
- 사용되지 않는 Builder JSX location Vite plugin 제거
- React와 React DOM을 19.2.7 설치 상태로 정합화
- `analysis_logs`를 `.gitignore`에 명시
- KataGo 승률 축 fail-closed 검증, 결과 metadata, 흑/백 UI 토글과 setup/pass 회귀 테스트 추가

## 8. 상용화 작업 목록

상태 표기: `[ ]` 미완료, `[~]` 진행 중, `[x]` 완료.

### P0: 공개 유료 베타 차단 항목

- [ ] **AI-01 실제 기보 corpus**: 익명화된 실제 SGF 10~20건 확보. 9/13/19, 접바둑, pass, setup stone, 장기 대국 포함.
- [~] **AI-02 strict corpus gate**: manifest v1과 expected-result 실행 도구 구현 완료. 실제 corpus manifest 작성과 운영 프로필 경고·실패 0 결과가 필요.
- [~] **AI-03 사람 검수**: 독립 검수자 2명, 점수, 승인/rejection gate 구현 완료. 실제 바둑 검수 결과가 필요.
- [x] **RT-01 운영 프로필 성능**: root 200 visits, multi-turn 6 persistent root+multi product suite 4/4, p50 23,053ms, p95 30,769ms, 실패·품질 경고 0. root-only 기준선 대비 전체 시간 53.7% 감소. 실제 corpus는 AI-01/02에서 별도 검증.
- [~] **RT-02 동시성 검증**: bounded Worker C1~C4, strict 공유 세션 guard, queue/engine/E2E/throughput/memory gate 구현. round-robin 합성 고객형 C4 8건 mini-soak는 8/8, E2E p95 81,686ms, 5.88 jobs/min, peak delta 2,059.9MiB, minimum free 8,423MiB, 품질 0/0으로 로컬 GO. query failure blast radius와 child crash pending cleanup 단위 검증 완료. 실제 corpus, Worker RSS/GPU VRAM, Supabase staging queue, 30~60분 soak와 환불·재claim fault injection은 미완료.
- [ ] **ST-01 전체 스테이징 E2E**: Clerk → Lemon → Supabase → Web → Worker → KataGo → 결과 → 원장까지 실제 외부 서비스로 검증.
- [ ] **ST-02 DB 검증**: migration 001~007을 빈 DB와 업그레이드 DB에 적용하고 RPC 권한과 중복 webhook을 검사.
- [ ] **OP-01 운영 메트릭·경보**: queue, duration, failure, refund, webhook 지표와 경보 및 대응 runbook 구성.
- [ ] **LG-01 정책 문서**: 이용약관, 개인정보, 환불, SGF 보관·삭제 정책 작성과 제품 연결.

### P1: 유료 베타 품질 항목

- [ ] **UX-01 작업 상태 UX**: queue/ETA/cancel/retry/failure/refund/notification 완성.
- [ ] **UX-02 접근성·시각 회귀**: 키보드, 스크린리더, 390/430/768/1440 viewport 기준 고정.
- [ ] **SEC-01 보안 헤더**: CSP, HSTS, frame, referrer, MIME 정책 적용.
- [ ] **SEC-02 분산 rate limit**: Redis 등 공유 저장소 기반으로 전환.
- [ ] **DEP-01 Clerk 이전**: `@clerk/react`로 이전하고 실제 인증 E2E 통과.
- [ ] **DB-01 데이터 계층 단순화**: legacy MySQL 코드와 Supabase 운영 경로의 역할을 확정하고 불필요 경로 제거.
- [~] **CI-01 릴리스 게이트**: local GitHub Actions workflow, secret scan, serialized test gate, build, E2E artifact upload, production dependency audit, protected staging smoke workflow, Worker preflight command implemented. GitHub-hosted first run, private corpus, actual staging smoke remain required.
- [x] **AI-04 승률 축 검증**: 공식 config 계약과 실엔진 v1.16.4 기준으로 흑·백, 접바둑 setup stone, pass를 검증. config 불일치 startup 차단, result quality gate, legacy fallback, 흑/백 UI 토글과 E2E 완료. 실제 고객 corpus 품질은 AI-01/02/03에서 별도 검증.

### P2: 정식 상용화 확장

- [ ] **AI-05 해설 모델**: Concept/Explanation을 검증된 핵심 경로에 연결.
- [ ] **AI-06 LLM 안전성**: Claim 단위 근거 연결과 생성 결과 검증을 거친 선택형 자연어 해설.
- [ ] **AI-07 개인화**: 반복 실수와 학습 이력 기반 추천.
- [ ] **PAY-02 국내 결제**: Toss 등 국내 결제 수요 검증 후 추가.
- [ ] **DATA-01 보관 체계**: SGF와 결과의 TTL, 삭제, export, 백업·복구.

## 9. 권장 실행 순서

1. 실제 SGF corpus와 사람 평가표를 먼저 만든다.
2. 대상 GPU host와 Supabase staging queue에서 공유 C4, memory telemetry, soak, child crash 복구를 검증한다.
3. 실제 외부 서비스가 연결된 스테이징 결제 E2E를 통과한다.
4. 운영 메트릭·알림·보안 헤더·분산 rate limit을 배치한다.
5. queue/ETA/재시도/환불 UX와 법적 문서를 완성한다.

이 다섯 단계가 근거와 함께 완료되기 전에는 준비도를 80% 이상으로 올리지 않는다.

## 10. 검증 기준선

2026-07-14 실제 실행 결과:

| 검증                                 | 결과                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `corepack pnpm check`                | 통과                                                                                 |
| `corepack pnpm test`                 | 72 files, 695 tests 통과                                                             |
| `corepack pnpm build`                | 통과                                                                                 |
| `corepack pnpm e2e`                  | 4/4 통과                                                                             |
| `git diff --check`                   | 통과                                                                                 |
| persistent customer-style suite      | 4/4, p50 19,979ms, p95 37,081ms, 품질 경고/실패 0                                    |
| operating profile 200 visits/6 turns | 4/4, p50 23,053ms, p95 30,769ms, 품질 경고/실패 0                                    |
| phase timing real product smoke      | 25 visits/2 turns, total 20,628ms, root 19,973ms, multi-turn 508ms, 품질 경고/실패 0 |
| isolated process capacity 200/6      | C1 품질 4/4, queue p95 68,406ms. C2/C4 memory 사전 차단, **NO-GO**                   |
| shared process C4 200/6, 4 jobs      | 4/4, engine p95 71,882ms, queue p95 0ms, E2E p95 71,915ms, 품질 0/0, **로컬 GO**     |
| shared C4 mini-soak 200/6, 8 jobs    | 8/8, E2E p95 81,686ms, 5.88 jobs/min, peak +2,059.9MiB, min free 8,423MiB, **GO**    |
| winrate axis real-engine suite       | v1.16.4, 4/4, pass/setup 포함, p50 1,331ms, p95 20,889ms, 축 `BLACK`, 품질 0/0       |

출시 후보마다 최소 아래 명령을 실행한다.

```powershell
corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm e2e
corepack pnpm katago:corpus-validate -- .local/katago-corpus/manifest.json --require-human-review
corepack pnpm katago:product-suite -- --corpus-manifest .local/katago-corpus/manifest.json --require-human-review --strict-warnings --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --max-product-review-category-quality-failure-rows 0
corepack pnpm katago:product-suite -- --customer-fixtures --concurrency 4 --strict-warnings --max-successful-p95-ms 120000 --max-queue-p95-ms 30000 --max-end-to-end-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --max-product-review-category-quality-failure-rows 0
corepack pnpm katago:product-suite -- --customer-fixtures --repeat 2 --concurrency 4 --strict-warnings --max-successful-p95-ms 120000 --max-queue-p95-ms 120000 --max-end-to-end-p95-ms 180000 --min-throughput-jobs-per-minute 1 --max-peak-used-delta-mib 4096 --min-free-memory-mib 1024 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --max-product-review-category-quality-failure-rows 0
corepack pnpm katago:concurrency-benchmark -- --levels 1,2,4 --jobs 4
corepack pnpm deploy:smoke
corepack pnpm credits:audit
```

## 11. 작업 트리 주의사항

이 저장소에는 여러 단계의 사용자 및 이전 에이전트 변경이 함께 있다. 관련 없는 변경을 되돌리거나 전체 reset하지 않는다. 파일을 수정하기 전 현재 diff를 읽고 기존 변경 위에 최소 범위로 작업한다.

## 12. 변경 이력

### 2026-07-14

- 전체 저장소, AI, 결제, 인증, 운영, UI 경로 재리뷰
- 도달 불가능 클라이언트 코드와 미사용 의존성 정리
- 장시간 분석 polling rate-limit 결함 수정 및 E2E 추가
- persistent root 실제 product-path 검증 근거 반영
- 공개 유료 베타 준비도 68%에서 70%로 조정
- 단일 상용화 기준 문서 신설
- 실제 SGF corpus manifest v1, 익명화·무결성·coverage 사전 검사와 빠른 validator 추가
- manifest 기대 visits/turn/BSI/ADI/quality를 product suite pass/fail에 연결
- 기보별 독립 검수자 2명 launch gate와 평가 rubric 추가
- 실제 고객 corpus와 사람 검수는 외부 근거가 없어 미완료로 유지; readiness 70% 유지
- root 200 visits, multi-turn 6 운영 후보 프로필 4/4 통과; RT-01 완료
- root/multi-turn/signal/deep/timeline 단계별 latency 계측 추가
- KataGo 런타임 점수를 70에서 77로 조정하고 공개 유료 베타 readiness를 71%로 조정
- 격리 Worker 프로세스 기반 동시성 1/2/4 benchmark, 큐·엔진·E2E·처리량 SLO와 메모리 사전 차단 구현
- 운영 200/6 burst 4건에서 품질 4/4였지만 queue/E2E SLO 실패 및 동시성 2/4 메모리 부족 확인; RT-02 진행 중과 readiness 71% 유지
- root와 multi-turn의 동일 persistent process/model 재사용, 선택 fallback/strict 모드, 실행 metadata와 CLI lifecycle 정리 구현
- 운영 200/6 customer-style suite를 p50 23,053ms, p95 30,769ms로 단축하고 품질 4/4 유지
- C1 burst 처리량을 1.03에서 3.4 jobs/min으로 높이고 peak delta를 3,418MiB에서 2,128MiB로 낮췄지만 queue SLO와 C2/4 검증은 미완료
- KataGo 런타임 점수를 77에서 82로 조정하고 공개 유료 베타 readiness를 72%, 정식 상용 준비도를 54%로 조정
- Worker bounded C1~C4 scheduler, 동기/비동기 job 실패 격리, shutdown drain과 공유 KataGo lifecycle 보호 구현
- C2~C4 startup에서 persistent root/multi-turn strict, job별 multi-turn concurrency 1, Deep Search/timeline OFF 안전 프로필 강제
- product suite에 `--concurrency`, queue/E2E 계측·p95 gate, 병렬 결과 파일 충돌 방지 추가
- 단일 공유 KataGo process C4 200/6 고객형 4건에서 4/4, engine p95 71,882ms, queue p95 0ms, E2E p95 71,915ms, 품질 경고/실패 0 통과
- KataGo 런타임 점수를 82에서 88로 조정하고 공개 유료 베타 readiness를 73%, 정식 상용 준비도를 55%로 조정
- product suite에 처리량, whole-system peak used delta, minimum free memory 계측과 launch gate 추가
- 반복 fixture를 round-robin으로 배치해 각 C4 wave가 서로 다른 9x9/13x13/19x19 기보를 처리하도록 benchmark 편향 제거
- C4 8건 mini-soak에서 8/8, E2E p95 81,686ms, 5.88 jobs/min, peak +2,059.9MiB, minimum free 8,423MiB, 품질 0/0 통과
- 개별 persistent query 실패의 공유 session close 제거, child crash 시 pending 전체 정리와 다음 요청 재기동 테스트 추가
- KataGo 런타임/운영/QA 점수를 90/54/72로 조정하고 공개 유료 베타 readiness를 74%, 정식 상용 준비도를 56%로 조정
- KataGo 공식 config 계약 기반 승률 축 파서와 Worker fail-closed startup guard 추가
- result/timeline 관점 metadata, product quality gate, 흑/백 변환과 legacy fallback 구현
- setup stone·pass·흑/백 차례 실엔진 suite 4/4 및 390/430/1440 흑/백 UI E2E 통과
- AI-04를 완료하고 AI/UI/QA 점수를 74/81/76으로 조정해 공개 유료 베타 readiness 76%, 정식 상용 준비도 57%로 조정

### 2026-07-15: CI release-gate status

- Added a local GitHub Actions release gate (`.github/workflows/ci.yml`) covering locked install, secret scan, focused CI-file formatting, type check, unit tests, build, Playwright E2E artifacts, and production dependency audit.
- Added `pnpm ci:secrets` with a scanner that never emits suspected secret values.
- Local secret scan, TypeScript check, and production build passed.
- The serialized CI unit gate is verified locally: 74 files and 702 tests passed. CI-01 remains partial until the first GitHub-hosted run plus private corpus and staging gates succeed.
- The workflow and related files are uncommitted. A GitHub-hosted first successful run, private corpus gate, and staging smoke gate remain required.
- Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.

### 2026-07-15: CI verification update

- Added `test:ci` with one Vitest worker and disabled file-level parallelism to remove synced-workspace contention without changing test assertions or timeout limits.
- `corepack pnpm test:ci` passed: 73 files, 697 tests.
- CI-01 is now locally implemented and verified; GitHub-hosted first run, private corpus, and staging smoke gates remain before closure.


### 2026-07-15: protected staging smoke workflow

- Added manual GitHub Actions staging smoke workflow with protected `staging` environment, required `SMOKE_AUTH_TOKEN`, and explicit checkout creation opt-in.
- External gate remains pending until GitHub environment protection, staging URL, and dedicated smoke-account token are configured and the workflow succeeds.


### 2026-07-15: worker runtime preflight

- Added `pnpm worker:preflight`, a Worker-only, fail-closed gate that does not claim jobs or connect to the queue.
- It validates KataGo binary/config/model files, verified winrate perspective, backend probe, GPU policy, and safe concurrency policy.
- Focused tests (5) and typecheck passed. The actual CLI could not run locally because OneDrive denied access to the tsx executable; staging Worker execution remains required.


### 2026-07-15: worker preflight verification

- `corepack pnpm test:ci` passed: 74 files, 702 tests, including Worker runtime preflight tests.
- `corepack pnpm build` and `corepack pnpm check` passed.
- Actual staging Worker preflight remains an external release gate because this synced workspace cannot read the local tsx executable reliably.
### 2026-07-15: external Worker observability foundation

- Added migration `008_analysis_worker_observability.sql`: Worker boot instances write liveness through service-role-only RPCs, using database timestamps and a TTL rather than `analysis_jobs` leases.
- Added `/ops/analysis-worker-health`. It returns only aggregated engine status, heartbeat and last-success timestamps; it is hidden unless `X-Ops-Status-Token` matches `OPS_STATUS_TOKEN`, and it never changes `/healthz` or `/readyz`.
- Completion telemetry is emitted only after the fenced `completed` write succeeds. Idle Workers therefore remain `live` even without a recent successful job.
- Typecheck plus focused Worker status, health-route, Worker-loop, pipeline regression tests passed (58 tests). The product smoke gate test was made deterministic by adding a minimum mock duration; its isolated run passes. A post-change full `test:ci` rerun is blocked intermittently by OneDrive `EPERM` while opening `vitest.mjs`, so GitHub CI and staging remain the required final evidence. Supabase migration application, staging TTL restart test, and real long-running job soak remain release gates.
- Added `OPS_STATUS_TOKEN` to protect Worker health aggregation and `SMOKE_OPS_TOKEN` as the separately scoped protected staging smoke credential. Production external-worker readiness now requires the Web token.
- The token route typecheck and seven health-route tests passed. A subsequent build and secret-scan rerun hit the same OneDrive `EPERM` dependency-file lock, not an application failure; GitHub CI must provide the final clean evidence.
- Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch; this removes an implementation gap but not the required staging evidence.
### 2026-07-16: user-requested analysis data purge

- Added migration `009_analysis_job_data_purge.sql` and authenticated `DELETE /api/analyze/:jobId/data` for final jobs owned by the caller.
- The purge clears SGF source, filename, integrity metadata, and analysis result, but preserves job status, timestamps, credit cost, and credit-log linkage for audit and refund investigation.
- The endpoint is idempotent for already-purged data and rejects queued or running jobs, preventing a Worker from racing a deletion request.
- Route tests (18) and TypeScript check passed. Applying the migration, scheduling retention expiration, account-level pseudonymization, and legal retention/refund review remain external release gates.
- Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.
### 2026-07-16: opt-in analysis payload retention

- Added migration `010_analysis_job_retention.sql`. Only newly queued jobs with explicit `ANALYSIS_DATA_RETENTION_DAYS` receive an expiration; existing data remains untouched.
- Added `pnpm data:retention`. It is dry-run by default and requires `--apply` to purge a bounded batch of expired final-job payloads through a service-role-only RPC.
- The retention RPC excludes queued and running jobs and retains all payment, credit, status, and audit linkage while clearing only user analysis payload fields.
- Retention parser and analysis-route tests passed: 21 tests total, plus TypeScript check. Migration application, production scheduler, account anonymization, and legal retention/refund decisions remain release gates.
- Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.
### 2026-07-16: analysis data deletion UI

- The completed analysis view retains its job id only while the result is on screen and exposes a confirmed, icon-only delete control for the authenticated owner.
- The UI calls `DELETE /api/analyze/:jobId/data`, clears the result and deep link after a successful purge, and returns to upload rather than leaving a stale local result visible.
- Typecheck and the 21 focused API/retention tests passed. Browser E2E of the destructive UI flow requires authenticated staging Supabase data and remains a release gate.
- Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.
### 2026-07-16: public legal and security document drafts

- Added root `PRIVACY.md`, `TERMS.md`, and `SECURITY.md` drafts based only on implemented Clerk, Supabase, Lemon Squeezy, Worker, credit, and payload-deletion behavior.
- Every unverified policy decision is explicitly marked `[LEGAL REVIEW REQUIRED]`; no jurisdiction, operator identity, contact address, retention duration, refund rule, compliance certification, or availability guarantee was invented.
- The documents remove a publication-structure gap but are not publishable legal terms until business and counsel approval. Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.

### 2026-07-16: protected analysis retention operation

- Added `.github/workflows/analysis-data-retention.yml` and `docs/analysis-data-retention-runbook.md` for the already-implemented retention RPC.
- The workflow targets the protected GitHub `production` environment, requires production-scoped Supabase secrets, defaults to dry-run, uses bounded batch-size choices, and passes `--apply` only from an explicit manual input.
- This is intentionally not scheduled. Applying migrations 009/010, configuring GitHub environment protection and secrets, conducting a staging rehearsal, monitoring the first production run, and legal approval of retention/backups remain external release gates.
- File control-character checks and `git diff --check` passed. Local Prettier could not read its own package file because OneDrive returned `EPERM`; the changed workflow and runbook are now included in the GitHub-hosted CI formatting gate, which remains required evidence.
- Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.

### 2026-07-16: analysis data deletion browser regression coverage

- Extended the existing Product Review Playwright fixture to cover the completed-result deletion control in English as well as Korean rendering.
- The success path accepts the confirmation dialog, verifies one `DELETE /api/analyze/:jobId/data` request, verifies that the result URL is cleared, and verifies the success state. The cancellation path verifies no delete request is made and the result remains visible.
- `corepack pnpm e2e -- product-review-result.spec.ts` passed: 6 Chromium tests, including the two new deletion cases. A follow-up local TypeScript check was blocked before compilation because OneDrive returned `EPERM` for the `tsc` package file; GitHub CI remains the clean type-check authority.
- This closes the synthetic browser-regression gap for the destructive UI but does not replace an authenticated staging Supabase rehearsal. Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.

### 2026-07-16: corpus critical-turn quality gate

- Strengthened the private-corpus manifest contract: every entry now declares human-designated critical turn indexes and the minimum number that must appear in both BSI and ADI signal output.
- The product suite no longer accepts a corpus row solely because it emitted enough signals somewhere in the game. It checks overlap against the reviewed critical turns and reports a failed `min_critical_turn_matches` expectation when analysis misses them.
- The focused corpus/product-smoke tests passed before the final duplicate-turn contract case was added: 3 files and 32 tests. The final local Vitest and TypeScript reruns were blocked before loading by OneDrive `EPERM` errors in package files; GitHub CI must execute the complete final test set.
- This strengthens the repository-local AI quality gate but does not create the required consented/licensed corpus or independent human-review evidence. Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch pending those external gates.

### 2026-07-16: Product Review category-quality release gate

- Added `productReviewCategoryQualityGateV1`, applied to every `katago:product-smoke` result and persisted with its output document.
- The gate validates decisive-move ownership/loss evidence and review category invariants: score and winrate categories require their respective positive loss evidence; Deep Search and volatility categories require their respective evidence; volatility-only rows cannot carry loss claims; and category/taxonomy or comparison-delta contradictions fail.
- Product-suite JSON and Markdown reports now include category-quality status. `--max-product-review-category-quality-failure-rows 0` turns any row violation into an explicit release-gate failure.
- Focused validation passed: 5 test files and 47 tests. This improves deterministic regression evidence, not human Go-semantic validation; commercialization readiness remains 76% for controlled public beta and 57% for formal production launch.
- Attempted the real customer-fixture KataGo suite with all zero-tolerance quality and category thresholds on 2026-07-16. It did not start because OneDrive returned `EPERM` while Node loaded the `tsx` CLI. Re-run the documented command on GitHub or the staging Worker before treating the new gate as real-engine evidence.

### 2026-07-16: current-state review, cleanup, and Git delivery audit

#### Release-blocking findings

1. **The release candidate is local-only until a reviewed push succeeds.** The commercialization checkpoint is committed locally as `57dda43`; it has not yet been accepted by the remote hosting boundary. GitHub CI and protected-environment evidence therefore still cannot begin.
2. **The local branch is reconciled with the current integration baseline.** A privilege-elevated `git fetch origin --prune` completed, then `origin/master` was merged locally as `0b3d2f6`. The branch is two commits ahead of `origin/master` and zero commits behind it.
3. **Real-engine and deployment evidence remains absent.** The actual KataGo suite, TypeScript check, and some tooling runs are intermittently blocked by OneDrive `EPERM` package-file locks. Supabase migrations 008-010, protected GitHub Actions environments, staging Web/Worker smoke, payment-credit E2E, and the reviewed private corpus have not been evidenced in this workspace.
4. **Commercial terms are drafts only.** `PRIVACY.md`, `TERMS.md`, and `SECURITY.md` correctly avoid unsupported claims, but legal approval, controller/contact details, refund policy, backup/deletion behavior, and regional obligations remain unresolved.

#### Implemented strengths

- KataGo result, corpus, critical-turn, and Product Review category-quality gates now cover engine structure, output consistency, reviewed-turn overlap, and category/evidence contradictions.
- The product suite can fail on `--max-product-review-category-quality-failure-rows 0`; focused tests for the related implementation passed (5 files, 47 tests).
- Payment credit audit tooling, authenticated analysis-data deletion, opt-in retention cleanup, external Worker health aggregation, and manual protected retention workflow are implemented locally.

#### Cleanup completed

- Removed ignored, regenerable local artifacts: `.tmp/`, `test-results/`, `dist/`, and `analysis_logs/`.
- Kept `node_modules/`, source, migrations, documentation, and all existing user work intact. `node_modules/` is required for local tooling and was not treated as disposable project content.

#### Delivery sequence

1. Push the reviewed local branch after explicitly approving the external source-code transfer; require the GitHub CI workflow to pass.
2. Create reviewable follow-up commits for any changes after this checkpoint; the existing legacy UI deletion set was checked for active import candidates before the checkpoint.
3. Apply migrations and execute staging smoke with protected environment secrets.
4. Run the private corpus with two independent reviews and zero-tolerance quality/category thresholds. Only then reassess public-beta readiness.

- Commercialization readiness remains 76% for controlled public beta and 57% for formal production launch. The major missing percentage is external evidence and delivery discipline, not another local feature.

#### Git audit correction

- After the initial report, a privilege-elevated `git fetch origin --prune` completed successfully. The Git delivery conclusions above now use current remote references rather than the previously stale local cache.

### 2026-07-16: local release-candidate checkpoint and integration

- Created local branch `wip/commercialization-readiness-20260716` and committed the accumulated commercialization work as `57dda43` (`185` files; analysis quality gates, Worker/retention operations, CI, product UI/E2E, legal drafts, and legacy UI cleanup).
- Merged current `origin/master` locally as `0b3d2f6`; the branch is now `2` commits ahead and `0` behind `origin/master`.
- Merge conflicts were limited to `.env.example`, `client/src/pages/Home.tsx`, `docs/env-guide.md`, and `server/analyzeRoute.db.test.ts`. The resolution retained the commercial result/deep-link and winrate-perspective behavior, adopted the current timeline-progress API contract, and exposed the new GPU backend-check configuration keys.
- Targeted integration validation passed: `server/analyzeRoute.db.test.ts`, `server/worker/katagoBackendDetectionV1.test.ts`, and `server/apiRateLimit.test.ts` (`3` files, `53` tests). `git diff --check` and staged-diff checks passed.
- The direct `git push -u origin wip/commercialization-readiness-20260716` attempt was blocked by the execution policy because it transfers the full source/docs WIP to an external host. No workaround was attempted, and `origin/master` was not modified. Explicit user approval is required before retrying the push.

### 2026-07-16: local release-gate verification refresh

- `corepack pnpm test:ci` passed on the integrated branch: `77` test files and `733` tests, serialized to avoid synced-workspace contention.
- `corepack pnpm ci:secrets`, `corepack pnpm check`, and `corepack pnpm build` all passed. The secret scanner reported no supported secret patterns in repository text files.
- `corepack pnpm katago:corpus-validate` correctly refused to run without a manifest path. This is not a code failure: the required privacy-reviewed real-game manifest is intentionally absent from the repository. The release gate command is `corepack pnpm katago:corpus-validate -- .local/katago-corpus/manifest.json --require-human-review`.
- Remaining external evidence is unchanged: approved remote push and GitHub CI, protected staging configuration and smoke run, Supabase migrations 008-010, real KataGo corpus/product-suite evidence, live payment-credit E2E, and legal approval.
