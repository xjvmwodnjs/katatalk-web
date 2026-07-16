# KataGo Operating Profile Benchmark - 2026-07-14

## 목적

로컬 CPU 환경의 실제 Worker product path에서 기본 운영 후보 설정인 root 200 visits, multi-turn 최대 6을 검증하고, persistent multi-turn 적용 전후를 비교한다. 이 문서의 직렬 측정 이후 공유 KataGo process C4도 별도 검증했으며 결과는 동시성 용량 보고서에 기록했다. 모든 측정은 합성 customer-style fixture를 사용하므로 실제 고객 corpus와 GPU 성능을 대신하지 않는다.

## 실행 프로필

```powershell
$env:KATAGO_MAX_VISITS='200'
$env:KATAGO_MULTI_TURN_MAX='6'
$env:KATAGO_WINRATE_TIMELINE_ENABLED='false'
$env:KATAGO_DEEP_SEARCH_ENABLED='false'
$env:KATAGO_PERSISTENT_ROOT_ENABLED='true'
$env:KATAGO_PERSISTENT_ROOT_STRICT='true'
$env:KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS='600000'
corepack pnpm katago:product-suite -- --customer-fixtures --strict-warnings --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --out-dir .tmp/katago-suite/operating-profile-200v-6t-2026-07-14
```

- 측정 시작: 2026-07-14T02:26:41.702Z
- 측정 종료: 2026-07-14T02:30:04.954Z
- suite 내부 경과 시간: 203,253ms
- 실행 환경: 현재 로컬 CPU KataGo worker

## 기준선 결과: persistent root만

- 성공: 4/4
- expected-pass failure rate: 0
- quality warning rows: 0
- quality failure rows: 0
- 성공 분석 p50: 53,004ms
- 성공 분석 p90/p95/max: 55,665ms

| Fixture              | Moves | Turns ok/failed | Total ms | Root ms | Non-root ms | BSI | ADI |
| -------------------- | ----: | --------------: | -------: | ------: | ----------: | --: | --: |
| 9x9 endgame + passes |    38 |             2/0 |   53,004 |  23,463 |      29,541 |   2 |   2 |
| 13x13 commented      |    80 |             4/0 |   41,504 |   4,124 |      37,380 |   4 |   4 |
| 19x19 120 moves      |   120 |             6/0 |   53,025 |   4,838 |      48,187 |   6 |   6 |
| 19x19 160 moves      |   160 |             6/0 |   55,665 |   4,562 |      51,103 |   6 |   6 |

첫 fixture의 root는 모델 cold start를 포함한다. 이후 persistent warm root는 4.1~4.8초였다. warm fixture에서는 non-root 구간이 전체 시간의 약 90~92%를 차지하므로 다음 최적화 대상은 multi-turn 분석이다.

## 최적화 후 결과: persistent root + multi-turn

root 분석에 사용한 동일한 process/model로 multi-turn query를 함께 실행하도록 구현한 뒤 같은 200/6 customer-style suite를 재측정했다.

```powershell
$env:KATAGO_PERSISTENT_ROOT_ENABLED='true'
$env:KATAGO_PERSISTENT_ROOT_STRICT='true'
$env:KATAGO_PERSISTENT_MULTI_TURN_ENABLED='true'
$env:KATAGO_PERSISTENT_MULTI_TURN_STRICT='true'
$env:KATAGO_PERSISTENT_MULTI_TURN_PER_JOB_CONCURRENCY='1'
corepack pnpm katago:product-suite -- --customer-fixtures --strict-warnings --max-successful-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --out-dir .tmp/katago-suite/persistent-multi-operating-200v-6t
```

- 성공: 4/4
- 전체 시간: 94,138ms
- 성공 분석 p50: 23,053ms
- 성공 분석 p95: 30,769ms
- quality warning/failure rows: 0/0

| Fixture              | Moves | Turns ok/failed | Total ms | Root ms | Multi-turn ms | BSI | ADI |
| -------------------- | ----: | --------------: | -------: | ------: | ------------: | --: | --: |
| 9x9 endgame + passes |    38 |             2/0 |   30,769 |  22,333 |         8,407 |   2 |   2 |
| 13x13 commented      |    80 |             4/0 |   23,053 |   4,349 |        18,697 |   4 |   4 |
| 19x19 120 moves      |   120 |             6/0 |   23,690 |   4,998 |        18,683 |   6 |   6 |
| 19x19 160 moves      |   160 |             6/0 |   16,605 |   2,323 |        14,272 |   6 |   6 |

## 전후 비교

| 200/6 실행 경로         | 전체 시간 |      p50 |      p95 | 품질 경고/실패 |
| ----------------------- | --------: | -------: | -------: | -------------: |
| persistent root만       | 203,253ms | 53,004ms | 55,665ms |            0/0 |
| persistent root + multi |  94,138ms | 23,053ms | 30,769ms |            0/0 |
| 감소율                  |     53.7% |    56.5% |    44.7% |              - |

합성 customer-style suite에서는 전체 시간이 절반 이하로 줄었고 p95도 30.8초까지 낮아졌다. 다만 실제 고객 기보 분포와 동시 요청에서는 달라질 수 있다.

## 판정

- RT-01 로컬 운영 후보 프로필 측정: 완료
- 합성 fixture engine runtime 임시 launch gate: p95 90초 이하
- 현재 측정 p95 30.8초로 임시 gate 대비 59.2초 여유
- 단일 작업 engine runtime 기준으로는 비동기 유료 베타 후보로 사용 가능
- 공개 유료 출시 판정은 계속 NO-GO

후속 RT-02에서 queue wait, engine runtime, end-to-end를 분리했고 단일 공유 process C4는 각각 p95 0ms, 71,882ms, 71,915ms로 120초 gate를 통과했다. 실제 corpus와 staging queue 근거는 여전히 필요하다.

## 계측 보강

이 측정 직후 결과의 `engine.phaseDurationsMs`에 다음 단계별 시간을 추가했다.

- parse
- root stage와 root analysis
- analysis plan
- multi-turn
- BSI/ADI/deep-search planning
- Deep Search
- winrate timeline
- quality gate 직전 total

이후 product suite Markdown에는 `Root/MT ms`가 자동 기록된다. 위 표의 첫 측정은 변경 전 결과이므로 non-root는 `total - root`로 계산했다.

CLI가 공유 process를 분석 완료 후 명시적으로 닫도록 보강한 뒤 `samples/test.sgf`를 25 visits, multi-turn 2로 실제 product smoke한 결과도 통과했다. 유휴 종료값을 10분으로 설정했지만 명령 자체는 22.6초에 반환해 자식 process 누수가 없음을 확인했다.

- total: 20,628ms
- root analysis: 19,973ms
- multi-turn: 508ms
- signal planning: 1ms
- Deep Search: 1ms
- timeline: 1ms
- quality warning/failure: 0/0

## 다음 작업

1. 실제 manifest corpus를 동일한 200/6 프로필로 실행한다.
2. bounded 단일 공유 process C4의 로컬 GO를 대상 GPU host에서 memory telemetry와 30~60분 soak까지 포함해 재검증한다. [`katago-concurrency-capacity-2026-07-14.md`](katago-concurrency-capacity-2026-07-14.md)를 참고한다.
3. staging queue에서 claim wait, shared-child crash, retry/refund를 포함한 end-to-end SLO를 검증한다.
4. timeline과 Deep Search를 각각 켜 비용을 분리 측정한다.
