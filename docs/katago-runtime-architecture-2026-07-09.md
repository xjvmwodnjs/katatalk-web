# KataGo Runtime Architecture Decision - 2026-07-09

## Decision

현재 요청마다 `katago analysis` 프로세스를 새로 실행하는 구조는 로컬/스테이징 smoke와 기능 검증에는 사용할 수 있지만, 공개 유료 서비스의 기본 런타임으로는 채택하지 않는다.

상용 베타의 목표 구조는 다음과 같다.

1. Web/API는 분석 job을 enqueue하고 결과 polling/deep link만 담당한다.
2. KataGo 실행은 Web/API와 분리된 worker에서만 수행한다.
3. Worker는 long-lived KataGo process, warm worker pool, 또는 GPU/전용 host 형태로 운영한다.
4. CPU 단일 spawn-per-analysis 경로는 fallback 또는 staging verification 용도로만 둔다.

## Evidence

공통 프로파일:

```bash
KATAGO_MAX_VISITS=25
KATAGO_MULTI_TURN_MAX=2
KATAGO_WINRATE_TIMELINE_ENABLED=false
KATAGO_DEEP_SEARCH_ENABLED=false
```

실측 결과:

- default synthetic suite: 유효 fixture 4개 모두 `quality ok=true`, duration `39326-39653ms`
- extended synthetic suite: 40/60/100수 fixture 모두 `quality ok=true`, duration `36440-37729ms`
- `samples/test.sgf` 3회 반복: `40225ms`, `38658ms`, `39537ms`
- customer-style persistent root benchmark:
  - spawn root p95: `17964ms`
  - persistent root p95: `18125ms` including first cold request
  - persistent warm root p95: `2269ms`
  - speedup p50: about `7.92x`

해석:

- 2수부터 100수까지 실행 시간이 36-40초대에 몰려 있다.
- spawn-per-analysis 반복에서는 뚜렷한 warm-path 개선이 없다.
- long-lived KataGo process에서는 첫 cold 요청 이후 root 분석 warm latency가 크게 줄어든다.
- 현재 빠른 smoke 프로파일은 timeline과 Deep Search를 꺼 둔 상태다.
- visits, multi-turn 수, timeline, Deep Search를 상용 수준으로 올리면 지연 시간은 더 커질 가능성이 높다.

## Product Implication

유료 크레딧 분석 서비스에서 사용자는 분석 대기 시간을 가격과 품질의 일부로 받아들인다. 따라서 다음 조건을 충족하기 전에는 공개 paid 트래픽을 받지 않는다.

- 예상 대기 시간 p50/p95가 측정되어 있다.
- queue wait와 engine runtime이 분리 측정된다.
- timeout, retry, refund 정책이 실제 worker 실패와 연결되어 있다.
- 긴 작업 중 UI가 queued/running/progress/failed/refunded 상태를 명확히 보여 준다.
- 품질 게이트 실패가 유료 완료로 저장되지 않는다.

## Required Next Work

1. Persistent KataGo root product integration을 운영 프로필로 검증한다.
   - `KATAGO_PERSISTENT_ROOT_ENABLED=true` feature flag로 실제 worker product path에 통합됐다.
   - 세션 실패 시 one-shot 경로로 fallback하며 기본 idle timeout은 60초다.
   - customer-style product suite 4건은 4/4 성공, p50 `19979ms`, p95 `37081ms`, 품질 경고/실패 0이었다.
   - 다음 목표는 실제 고객 corpus와 root 200 visits, multi-turn 6, timeline/Deep Search 조합 검증이다.
   - 2026-07-14 persistent root+multi-turn strict의 200 visits/6 turns 측정은 4/4, p50 `23053ms`, p95 `30769ms`, 품질 경고/실패 0으로 통과했다.
   - 로컬 C1 burst는 품질 4/4, queue p95 `68406ms`, E2E p95 `70651ms`, 처리량 `3.4 jobs/min`이었다. queue SLO는 실패했고 C2/4는 메모리 사전 검사에서 차단돼 로컬 용량은 NO-GO다.
   - 다음 목표는 실제 manifest corpus, 전용 host/staging 동시성 2/4, timeline/Deep Search 개별 비용 검증이다.

2. GPU 또는 전용 worker host benchmark를 실행한다.
   - `KATAGO_MAX_VISITS=100`, `200`
   - `KATAGO_MULTI_TURN_MAX=6`
   - `KATAGO_WINRATE_TIMELINE_ENABLED=true`
   - `KATAGO_DEEP_SEARCH_ENABLED=true` 는 후보 1개부터 시작
   - 로컬 단일 lane peak 증가량 약 `2128MiB`를 기준으로 시작 시 free memory 8GiB 이상에서 동시성 2, 12GiB 이상에서 동시성 4를 다시 측정

3. 실제 고객형 SGF corpus를 준비한다.
   - short, mid-game, full game, handicap, pass, resignation-like edge, malformed SGF를 포함한다.
   - corpus는 `.tmp/` 또는 `.local/`에 두고 원문 SGF를 커밋하지 않는다.

4. 운영 SLO 초안을 만든다.
   - queue wait p50/p95
   - engine runtime p50/p95
   - completed/failed/refunded 비율
   - quality gate warning/failure 비율
   - credit cost per analysis

## Current Status

Runtime architecture decision은 "spawn-per-analysis를 상용 기본값으로 쓰지 않는다"에서 root와 multi-turn의 동일 persistent process/model 재사용까지 진행됐다. 200 visits/6 turns customer-style suite는 4/4, p50 `23053ms`, p95 `30769ms`였고 root-only 기준선보다 전체 시간이 53.7% 줄었다. C1 burst도 queue p95 `68406ms`, E2E p95 `70651ms`, peak delta `2128MiB`로 개선됐지만 queue 30초 SLO를 통과하지 못했다. 다음 성능 작업은 실제 고객 corpus, 전용 host와 staging queue의 동시성 2/4, timeline/Deep Search 비용 검증이다. 상세 수치는 [`katago-concurrency-capacity-2026-07-14.md`](katago-concurrency-capacity-2026-07-14.md)에 있다.
