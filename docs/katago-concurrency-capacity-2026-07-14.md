# KataGo Concurrency Capacity Benchmark - 2026-07-14

## 목적과 범위

운영 후보 프로필에서 queue wait, engine runtime, end-to-end latency, 처리량, 메모리 여유를 분리 측정한다. 1차 측정은 격리된 장기 실행 Worker 프로세스 `N`개를 사용했고, 2차 측정은 production Worker에 bounded in-process concurrency를 추가해 한 KataGo process/model을 최대 4개 job이 공유하도록 했다.

이 측정은 단일 Windows 호스트의 로컬 용량 시험이다. Supabase claim 경합, staging 네트워크, 여러 호스트의 autoscaling, GPU 메모리, 실제 고객 corpus는 검증하지 않는다.

## 구현

`corepack pnpm katago:concurrency-benchmark`는 다음을 자동화한다.

- 동시성 1/2/4별 독립 Node Worker runner 실행
- 각 runner 안에서 persistent root session을 재사용하고, opt-in이면 multi-turn도 동일 process/model 사용
- 모든 작업을 동시에 queue에 넣고 빈 lane에 순서대로 배정
- queue wait, engine, end-to-end, root, multi-turn latency의 p50/p95 집계
- 품질 warning/failure 0 강제
- whole-system 메모리 250ms sampling과 다음 동시성의 사전 안전 차단
- JSON/Markdown 근거 생성

메모리는 프로세스별 RSS가 아니라 시스템 전체 사용량 변화이므로 근삿값이다. 안전 차단을 해제하는 `--force-memory-risk`는 disposable benchmark host에서만 사용한다.

`corepack pnpm katago:product-suite -- --concurrency 4`는 권장 공유 프로세스 구조를 별도로 검증한다.

- 입력 순서를 보존하는 bounded C1~C4 scheduler
- 각 job의 queue wait, engine duration, end-to-end latency 기록
- queue/engine/E2E p95와 품질 failure/warning gate
- 병렬 결과 JSON의 UUID 파일명으로 덮어쓰기 방지
- 종료 시 in-flight drain 후 공유 KataGo child 명시 정리

Worker에서 C2~C4를 사용하려면 persistent root/multi-turn enabled+strict, job별 multi-turn concurrency `1`, Deep Search/timeline OFF 조합을 시작 시 강제한다. 조건을 어기면 job을 claim하기 전에 Worker가 실패한다.

## SLO 초안

| 항목               |                        기준 |
| ------------------ | --------------------------: |
| queue wait p95     |               30,000ms 이하 |
| engine runtime p95 |              120,000ms 이하 |
| end-to-end p95     |              120,000ms 이하 |
| 성공 처리량        |              1 job/min 이상 |
| 가용 시스템 메모리 |          1,024MiB 이상 유지 |
| 품질               | 모든 작업 warning/failure 0 |

## 실행 프로필

```powershell
$env:KATAGO_MAX_VISITS='200'
$env:KATAGO_MULTI_TURN_MAX='6'
$env:KATAGO_WINRATE_TIMELINE_ENABLED='false'
$env:KATAGO_DEEP_SEARCH_ENABLED='false'
$env:KATAGO_PERSISTENT_ROOT_ENABLED='true'
$env:KATAGO_PERSISTENT_ROOT_STRICT='true'
$env:KATAGO_PERSISTENT_MULTI_TURN_ENABLED='true'
$env:KATAGO_PERSISTENT_MULTI_TURN_STRICT='true'
$env:KATAGO_ANALYSIS_TIMEOUT_MS='180000'
corepack pnpm katago:concurrency-benchmark -- --levels 1,2,4 --jobs 4 --out-dir .tmp/katago-concurrency/persistent-multi-200v-6t --job-timeout-ms 600000
```

- fixture: synthetic customer-style 19x19, 120 moves
- 호스트: Intel Core i7-13700H, logical CPU 20개, RAM 32,327.5MiB
- runner 시작 전 다른 프로세스가 사용 중인 메모리를 포함

## 결과

### 운영 프로필: 200 visits / multi-turn 6

품질은 4/4 통과했지만 latency와 동시 처리 용량 SLO는 통과하지 못했다.

|   C | 상태           | 품질 |      Queue p50/p95 |    Engine p50/p95 |         E2E p50/p95 |        처리량 |          Peak delta\* |              Min free\* |
| --: | -------------- | ---: | -----------------: | ----------------: | ------------------: | ------------: | --------------------: | ----------------------: |
|   1 | completed      |  4/4 | 69,883 / 177,667ms | 55,813 / 69,880ms | 125,696 / 233,990ms | 1.03 jobs/min |            3,418.3MiB |              1,679.9MiB |
|   2 | memory skipped |    - |                  - |                 - |                   - |             - |  예상 필요 7,860.6MiB | 실행 전 free 5,590.5MiB |
|   4 | memory skipped |    - |                  - |                 - |                   - |             - | 예상 필요 14,697.2MiB | 실행 전 free 5,616.4MiB |

\* whole-system 근사치.

동시성 1의 작업별 결과:

| Job |     Queue |   Engine |       E2E |     Root | Multi-turn | 품질 |
| --: | --------: | -------: | --------: | -------: | ---------: | ---- |
|   1 |       0ms | 69,880ms |  69,883ms | 23,667ms |   46,165ms | PASS |
|   2 |  69,883ms | 55,813ms | 125,696ms |  1,130ms |   54,680ms | PASS |
|   3 | 125,696ms | 51,970ms | 177,667ms |    748ms |   51,220ms | PASS |
|   4 | 177,667ms | 56,323ms | 233,990ms |    322ms |   55,996ms | PASS |

### 빠른 프로토콜 확인: 25 visits / multi-turn 2

동시성 1에서 품질 2/2, engine p95 43,308ms, queue p95 43,309ms, end-to-end p95 63,970ms, 1.88 jobs/min이었다. Peak delta는 3,985.2MiB였고 minimum free는 1,933.4MiB였다. 동시성 2는 예상 필요 8,994.4MiB 대비 실행 전 free 5,926.4MiB로 차단됐다.

## persistent multi-turn 적용 후 재측정

root와 선택된 multi-turn query를 동일한 KataGo process/model에서 실행하도록 전환한 뒤 같은 200/6, 4-job burst를 재측정했다.

|   C | 상태           | 품질 |     Queue p50/p95 |   Engine p50/p95 |       E2E p50/p95 |       처리량 |         Peak delta\* |              Min free\* |
| --: | -------------- | ---: | ----------------: | ---------------: | ----------------: | -----------: | -------------------: | ----------------------: |
|   1 | completed      |  4/4 | 55,367 / 68,406ms | 3,726 / 55,365ms | 64,680 / 70,651ms | 3.4 jobs/min |           2,128.0MiB |              2,006.9MiB |
|   2 | memory skipped |    - |                 - |                - |                 - |            - | 예상 필요 5,280.0MiB | 실행 전 free 4,191.5MiB |
|   4 | memory skipped |    - |                 - |                - |                 - |            - | 예상 필요 9,536.0MiB | 실행 전 free 4,163.0MiB |

동시성 1의 작업별 결과:

| Job |    Queue |   Engine |      E2E |     Root | Multi-turn | 품질 |
| --: | -------: | -------: | -------: | -------: | ---------: | ---- |
|   1 |      0ms | 55,365ms | 55,367ms | 24,918ms |   30,419ms | PASS |
|   2 | 55,367ms |  9,312ms | 64,680ms |  1,097ms |    8,213ms | PASS |
|   3 | 64,680ms |  3,726ms | 68,406ms |    438ms |    3,284ms | PASS |
|   4 | 68,406ms |  2,244ms | 70,651ms |    258ms |    1,984ms | PASS |

| 지표                    | 기존 root-only | persistent multi |   변화 |
| ----------------------- | -------------: | ---------------: | -----: |
| Queue p95               |      177,667ms |         68,406ms | -61.5% |
| Engine p95              |       69,880ms |         55,365ms | -20.8% |
| E2E p95                 |      233,990ms |         70,651ms | -69.8% |
| 처리량                  |  1.03 jobs/min |     3.4 jobs/min |  3.3배 |
| Whole-system peak delta |     3,418.3MiB |       2,128.0MiB | -37.7% |

반복 작업은 동일 120수 fixture를 사용하므로 warm query cache의 영향을 받을 수 있다. 실제 고객 corpus의 서로 다른 기보로 staging burst를 재현하기 전에는 이 처리량을 일반화하지 않는다.

## 단일 공유 KataGo process C4 재측정

격리 Worker를 여러 개 띄우는 대신 production Worker 한 프로세스 안에서 job 4개를 동시에 처리하고, root와 multi-turn query를 KataGo child 하나에 multiplex했다. 같은 job 안의 multi-turn query는 한 번에 하나만 보내 job 간 공정성을 확보했다. 입력은 서로 다른 9x9/13x13/19x19 고객형 fixture 4개다.

```powershell
$env:KATAGO_MAX_VISITS='200'
$env:KATAGO_MULTI_TURN_MAX='6'
$env:KATAGO_ANALYSIS_TIMEOUT_MS='180000'
$env:KATAGO_MULTI_TURN_QUERY_TIMEOUT_MS='180000'
$env:KATAGO_PERSISTENT_ROOT_ENABLED='true'
$env:KATAGO_PERSISTENT_ROOT_STRICT='true'
$env:KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS='600000'
$env:KATAGO_PERSISTENT_MULTI_TURN_ENABLED='true'
$env:KATAGO_PERSISTENT_MULTI_TURN_STRICT='true'
$env:KATAGO_PERSISTENT_MULTI_TURN_PER_JOB_CONCURRENCY='1'
$env:KATAGO_WINRATE_TIMELINE_ENABLED='false'
$env:KATAGO_DEEP_SEARCH_ENABLED='false'
corepack pnpm katago:product-suite -- --customer-fixtures --concurrency 4 --strict-warnings --max-successful-p95-ms 120000 --max-queue-p95-ms 30000 --max-end-to-end-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0
```

2026-07-14 실행 결과:

| 지표                      |              결과 |              SLO | 판정 |
| ------------------------- | ----------------: | ---------------: | ---- |
| 성공/기대 일치            |               4/4 |              4/4 | PASS |
| 전체 wall time            |          71,928ms |                - | 기록 |
| engine p50/p95            | 58,726 / 71,882ms | p95 <= 120,000ms | PASS |
| queue p50/p95             |           0 / 0ms |  p95 <= 30,000ms | PASS |
| E2E p50/p95               | 58,728 / 71,915ms | p95 <= 120,000ms | PASS |
| 처리량                    |  약 3.34 jobs/min |     >= 1 job/min | PASS |
| 품질 warning/failure rows |             0 / 0 |            0 / 0 | PASS |

| Fixture            |   Engine | Queue |      E2E |     Root | Multi-turn | 품질 |
| ------------------ | -------: | ----: | -------: | -------: | ---------: | ---- |
| 9x9 endgame/passes | 45,636ms |   0ms | 45,668ms | 27,578ms |   18,043ms | PASS |
| 13x13 commented 80 | 58,726ms |   0ms | 58,728ms | 22,797ms |   35,888ms | PASS |
| 19x19 120          | 71,882ms |   0ms | 71,915ms | 28,687ms |   43,187ms | PASS |
| 19x19 160          | 70,048ms |   0ms | 70,078ms | 23,334ms |   46,703ms | PASS |

네 결과 모두 `rootAnalysisMode=persistent`, `multiTurnAnalysisMode=persistent`였고 persistent multi-turn 실패는 0건이었다. 직렬 customer-style 4건 wall time 94,138ms와 비교하면 전체 완료 시간이 23.6% 감소했다. 최초 실행에는 메모리 표본이 없었고, 아래 mini-soak에서 whole-system memory gate를 추가했다.

## Round-robin C4 mini-soak와 메모리

`--repeat 2`의 순서를 round 단위로 바꿔 각 C4 wave에 9x9, 13x13, 19x19 120수, 19x19 160수 fixture가 하나씩 들어가도록 했다. 실행 중 250ms 간격으로 whole-system memory를 표본화하고 처리량·메모리 gate를 함께 적용했다.

```powershell
corepack pnpm katago:product-suite -- --customer-fixtures --repeat 2 --concurrency 4 --strict-warnings --max-successful-p95-ms 120000 --max-queue-p95-ms 120000 --max-end-to-end-p95-ms 180000 --min-throughput-jobs-per-minute 1 --max-peak-used-delta-mib 4096 --min-free-memory-mib 1024 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0
```

| 지표                         |              결과 |             Gate | 판정 |
| ---------------------------- | ----------------: | ---------------: | ---- |
| 성공/기대 일치               |               8/8 |              8/8 | PASS |
| 실행 시간                    |          81,686ms |                - | 기록 |
| engine p50/p95               | 22,396 / 75,296ms | p95 <= 120,000ms | PASS |
| queue p95                    |          72,572ms |     <= 120,000ms | PASS |
| E2E p95                      |          81,686ms |     <= 180,000ms | PASS |
| 처리량                       |     5.88 jobs/min |     >= 1 job/min | PASS |
| whole-system peak used delta |        2,059.9MiB |      <= 4,096MiB | PASS |
| whole-system minimum free    |          8,423MiB |      >= 1,024MiB | PASS |
| 품질 warning/failure rows    |             0 / 0 |            0 / 0 | PASS |

두 번째 warm wave의 engine duration은 9,112~22,396ms였고, 8개 결과 모두 root/multi-turn persistent 경로와 `persistentFailedCount=0`을 기록했다. 메모리는 시스템의 다른 프로세스 변동을 포함한 근삿값이며 Worker RSS나 GPU VRAM을 직접 측정한 값은 아니다.

개별 persistent multi-turn query 실패가 공유 session을 닫아 다른 job의 pending query를 중단시키던 fault-domain도 제거했다. query 실패는 해당 turn/job에만 남고 session 생명주기는 소유자인 root manager가 관리한다. 별도 child crash 테스트는 동시 pending query가 모두 reject·정리되고 다음 요청에서 새 child로 복구되는 것을 검증한다.

## 판정

- **권장 단일 공유 프로세스 구조의 로컬 C4 판정: GO**
- **격리 KataGo process를 C2/C4로 늘리는 기존 구조: NO-GO**. 모델 메모리가 Worker 수에 비례해 늘어나며 이 호스트에서는 사전 안전 차단됐다.
- 공유 C4는 4건 순간 gate와 8건 round-robin mini-soak에서 engine/queue/E2E/throughput/품질 gate를 통과했다. Worker는 설정 검증, job별 lease/heartbeat, query 실패 격리, child crash pending 정리, shutdown drain을 제공한다.
- RT-02의 로컬 구현·합성 고객형 fixture·whole-system memory gate는 완료했다. 다만 실제 Supabase queue, 실제 고객 corpus, 30~60분 soak, Worker RSS/GPU VRAM telemetry가 없어 RT-02 전체는 계속 진행 중이다.
- 공개 paid 트래픽 판정은 여전히 NO-GO다. staging에서 같은 C4 gate와 환불/재claim 경로를 통과해야 한다.

## 다음 조치

1. staging GPU Worker에서 `ANALYSIS_WORKER_CONCURRENCY=4`와 동일 strict 공유 세션 프로필로 C4를 재측정한다.
2. 서로 다른 실제 manifest corpus 10~20건을 burst 입력으로 사용해 합성 fixture 편향을 제거한다.
3. Worker RSS/GPU VRAM, queue depth, claim wait, engine/E2E, 실패·환불을 중앙 telemetry로 수집하고 30~60분 soak를 실행한다.
4. shared child가 중간 종료될 때 동시 in-flight job이 모두 실패·환불되고 stale lease가 안전하게 복구되는지 staging fault injection으로 검증한다.
5. 부하가 한 process의 C4 상한을 넘으면 같은 호스트의 model process를 무조건 늘리지 말고 GPU memory 기준으로 host 단위 수평 확장한다.
