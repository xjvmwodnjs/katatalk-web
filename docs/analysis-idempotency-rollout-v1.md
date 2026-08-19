# 유료 분석 요청 멱등성 롤아웃 v1

> 상태: migration·Web·client·테스트는 로컬 구현 완료. 실제 Supabase 적용,
> 무중단 전환 증거, 대시보드/알림 증거가 없으므로 공개 유료 운영은 아직
> **NO-GO**다.

이 문서는 `NLC-005`의 배포 계약이다. 목표는 네트워크 단절, 응답 유실,
브라우저 재시도, 동시 요청이 발생해도 동일한 유료 분석 요청이 정확히 한 번만
차감·enqueue되도록 하는 것이다.

## 1. 불변 조건

- 멱등성 범위는 `(wallet subject, request_id)`다. 다른 사용자는 같은 opaque
  request ID를 사용할 수 있다.
- 같은 request ID와 같은 fingerprint는 최초 저장된 job ID·ledger ID·현재
  상태·잔액을 반환하며 새 차감이나 새 job을 만들지 않는다.
- 같은 request ID와 다른 fingerprint는 `409 IDEMPOTENCY_CONFLICT`이며 DB를
  변경하지 않는다.
- 신규 요청의 admission 거절, 잔액 부족, job ID 충돌은 차감·usage log·job을
  하나도 남기지 않는다.
- 이미 commit된 정확한 replay는 이후 engine/admission 설정이 바뀌어도 먼저
  복구된다.
- 존재하지 않는 job과 다른 owner의 job은 같은 `404` 경계로 처리한다.
- 상태/timeline polling은 SGF·결과 JSON을 읽지 않는다. 완료 결과는 versioned
  `/api/analyze/:jobId/result`에서 한 번만 읽는다.

## 2. 구현 계약

### Client

- `Idempotency-Key`는 16~128자의 opaque ASCII ID다.
- client는 `SHA-256(account scope):language:SHA-256(SGF bytes)`별 pending
  request를 최대 8개, 24시간 보존한다. 저장 값은 hash·request
  ID·timestamp뿐이며 SGF·filename·원문 사용자 식별자는 저장하지 않는다.
- durable browser storage를 쓸 수 없으면 유료 요청을 전송하지 않는다.
- 해시 전에 역대 server admission 상한인 1MiB를 불변 recovery ceiling으로
  검사한다. 향후 신규 upload 상한을 더 낮추더라도 이 ceiling은 기존 job 복구용으로
  유지하며, 1MiB를 넘는 임의 파일을 메모리에 올리거나 해시하지 않는다.
- POST 전에 owner-qualified `GET /api/analyze/requests/:requestId`로 이미 commit된
  job을 먼저 복구한다. 따라서 응답 유실 뒤 validator/upload admission이 바뀌어도
  원래 job을 찾기 위해 SGF를 다시 검증하거나 차감하지 않는다. missing과 다른
  owner는 동일한 `404`, malformed ID는 `400`, 모든 응답은 `private, no-store`다.
- 서버 응답을 받으면 active job ID를 먼저 보존하고 pending request는 terminal
  결과를 확인할 때까지 유지한다. 완료·실패 확인 뒤에만 지우며, timeout·결과
  fetch 실패·tab crash에서는 같은 key가 복구된다.

### Web API

- 신규 commit은 `202`, 정확한 replay는 원래 job ID와 함께 `200`, payload
  충돌은 `409`다.
- 허용 전환 중 header가 없는 요청은 서버 생성 `legacy.*` ID로 v2 RPC를
  호출하고 응답에 `idempotencyProtected:false`를 기록한다. 이 경로는 reload나
  응답 유실을 안전하게 복구할 수 없으므로 공개 유료 traffic에는 허용하지 않는다.
- `ANALYSIS_IDEMPOTENCY_KEY_REQUIRED=true`이면 header 누락·형식 오류를 차감
  전에 `400 ANALYSIS_REQUEST_ID_INVALID`로 거절한다.
- `KATATALK_ATOMIC_ENQUEUE=false`는 신규 요청을
  `503 ANALYSIS_IDEMPOTENCY_UNAVAILABLE`로 fail-closed한다.

### Database

- migration `015`는 `analysis_jobs.request_id`와
  `request_fingerprint`를 nullable pair로 추가해 legacy 행을 보존한다.
- partial unique index `(user_id, request_id)`가 신규 요청을 고정한다.
- fingerprint는 현재
  `SHA-256("analysis-request-v1\n" + sgfSha256 + "\n" + language)`다. 분석
  옵션이 추가되면 version을 올리고 모든 과금·결과 영향 옵션을 포함해야 한다.
- `enqueue_paid_analysis_job_v2`는 profile row를 `FOR UPDATE`로 잠근 뒤 replay →
  conflict → admission → debit/log/job 순서로 처리한다.
- RPC는 `SECURITY DEFINER`, `search_path=pg_catalog`, application table owner,
  `service_role` 단독 실행 ACL을 사용한다.
- 기존 v1 RPC는 롤링 전환 동안만 남긴다. 제거는 별도 migration과 증거를
  요구한다.

## 3. 공개 유료 traffic의 안전한 전환

구 Web은 새 header를 무시하고 v1 RPC를 호출한다. 따라서 새 client가 구 Web과
섞인 상태에서 응답을 잃고 신 Web으로 재시도하면 중복 차감될 수 있다. 단순
rolling deploy는 허용하지 않는다.

1. `master`의 같은 commit으로 fresh `001→015`, upgrade
   `011→012→013→014→015`, ACL, serial replay, 32-way 실제 PostgreSQL 경쟁
   gate를 통과한다.
2. 대상 Supabase project ID·region·backup/restore point를 확인한다. staging의
   `analysis_jobs` row 수·table/index byte 크기·현재 장기 transaction을 기록하고
   migration `015`의 5초 lock timeout, check scan/index build 시간, 실제 lock wait를
   production보다 큰 fixture로 rehearsal한다. 이 단계에서는 production migration을
   아직 적용하지 않는다.
3. `ANALYSIS_IDEMPOTENCY_KEY_REQUIRED=true`인 신 Web/client artifact를 green
   환경에 배포하되 공개 traffic은 연결하지 않는다. migration 전 호출이 필요한
   분석 smoke는 수행하지 않는다.
4. edge 또는 load balancer에서 **분석 POST를 먼저 유지보수 503으로 차단**하고
   거절된 POST의 차감이 0인지 확인한다. 결제 webhook과 owner 결과 조회는 계속
   허용한다.
5. 기존 queued/running job을 terminal로 drain하고 새 Worker claim을 중단한다.
   stuck job은 승인된 reconciliation 절차로 처리한 뒤 모든 Analysis Worker를
   pause/stop한다. `analysis_jobs`를 갱신하는 Web/Worker session과 장기 transaction이
   0이라는 DB/platform 증거 없이는 다음 단계로 가지 않는다.
6. 허용 maintenance budget에서 migration `015`를 숫자 순서로 적용한다. 5초
   lock timeout은 lock 획득만 제한하며 scan/build 실행 시간을 제한하지 않으므로
   step 2의 상한을 별도로 지켜야 한다. 완료 후 catalog, index, RPC owner/search
   path/ACL을 다시 수집한다.
7. 구 Web instance를 모두 drain하고 API traffic을 green으로 원자 전환한다.
   구 instance 0, 신 Web required flag true, 신 Worker artifact SHA를 확인한 뒤
   Worker를 재개하고 무과금/테스트 wallet smoke를 수행한다.
8. 분석 POST를 연다. 캐시된 구 client는 `400`을 받을 수 있으며 새로고침 안내로
   복구한다. 가용성보다 금전 정확성을 우선한다.
9. canary 계정으로 신규 1건, 응답 유실 HTTP replay 1건, payload conflict, 잔액
   부족, admission 거절을 확인한다. 100회 serial/32-way replay는 production HTTP
   rate limit을 우회하지 말고 격리된 DB gate 또는 승인된 비공개 staging harness로
   수행한다. 각각 job/usage/debit cardinality와 반환 job ID를 기록한다.
10. 최소 한 frontend cache TTL과 관측 기간 동안 missing/invalid header,
    replay/conflict, debit/job 불일치가 0인지 감시한다.
11. 관측 기간 뒤 별도 migration에서 v1 RPC 제거를 제안한다. 호출 0 증거,
    rollback 계획, fresh/upgrade gate 없이는 제거하지 않는다.

production Web은 `ANALYSIS_IDEMPOTENCY_KEY_REQUIRED=true`가 아니면 시작하지
않는다. 해당 값이 `false`인 public paid canary는 금지한다. POST 유지보수
차단이나 blue/green 원자 전환을 제공할 수 없는 플랫폼에서는 이 릴리스를
진행하지 않는다.

## 4. 롤백

- migration `015`를 역삭제하거나 기존 migration 파일을 수정하지 않는다.
- 이상 징후가 있으면 먼저 `POST /api/analyze`를 edge에서 차단한다. Worker가
  이미 claim한 job과 결제 webhook은 별도 runbook에 따라 처리한다.
- 구 Web으로 rollback해야 한다면 분석 POST를 계속 닫아 둔다. v1 경로를
  공개 유료 traffic에 다시 열지 않는다.
- ledger를 직접 수정하지 않는다. 불일치는 credit audit와 승인된 reconciliation
  절차로 조사한다.
- `request_id`·fingerprint는 payload purge 뒤에도 금전 감사와 replay 방지를 위해
  남긴다. 삭제/보존 법무 기간은 별도로 승인해야 한다.

## 5. 출시 증거와 관측 항목

필수 증거:

- migration history 15개, v2 function body digest, owner/search path/ACL
- 격리된 DB gate의 100회 serial과 32-way 동시 replay에서 동일 job/log ID,
  usage row 1, debit 1
- lost-response HTTP replay의 `202 → 200`과 동일 job ID
- payload conflict·invalid/missing header·admission 거절의 DB write 0
- owner/missing 동일 404, polling large-column read 0, `/result` 단일 fetch
- old Web instance 0, required flag true, client artifact commit SHA 일치

최소 metrics/alerts:

- `analysis_submit_new_total`, `analysis_submit_replay_total`
- `analysis_idempotency_conflict_total`, missing/invalid header count
- job 대비 usage ledger cardinality 불일치
- enqueue latency, DB lock wait, 5xx/429, queue oldest age
- `idempotencyProtected:false` 응답 수. 공개 유료 환경에서는 0이 아니면 alert다.

이 경계는 중복 분석 과금만 해결한다. payment reversal/inbox, queue capacity
admission, 최소권한 Worker role, retention, 자연어 해설 artifact는 각각 별도의
production gate다.
