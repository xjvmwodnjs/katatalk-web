# KataGo Product Benchmark - 2026-07-09

## Scope

목적은 실제 `analyzeSgfKatago` 제품 경로가 다양한 SGF에서 품질 게이트를 통과하는지, 그리고 현재 로컬 실행 프로파일의 대략적인 지연 시간이 어떤지 확인하는 것이다. 이 benchmark는 상용 품질 최종 판정이 아니라, 다음 런타임 아키텍처 판단을 위한 초기 측정이다.

공통 실행 프로파일:

```bash
KATAGO_MAX_VISITS=25
KATAGO_MULTI_TURN_MAX=2
KATAGO_WINRATE_TIMELINE_ENABLED=false
KATAGO_DEEP_SEARCH_ENABLED=false
```

## Commands

```bash
corepack pnpm katago:product-suite -- --default-fixtures --out-dir .tmp/katago-suite/latest-fast
corepack pnpm katago:product-suite -- --extended-fixtures --out-dir .tmp/katago-suite/latest-extended
corepack pnpm katago:product-suite -- --customer-fixtures --out-dir .tmp/katago-suite/customer-style-2026-07-10
corepack pnpm katago:product-suite -- --repeat 3 --out-dir .tmp/katago-suite/repeat-sample samples/test.sgf
corepack pnpm katago:persistent-benchmark -- --customer-fixtures --out-dir .tmp/katago-persistent-benchmark/customer-style-2026-07-10
```

`.tmp/` output은 ignore 대상이며 커밋하지 않는다.

## Default Fixture Suite

Report path:

```text
.tmp/katago-suite/latest-fast/benchmark-2026-07-09T05-27-13-584Z.md
```

Summary:

- Suite passed: `true`
- Expectation met: `5/5`
- Product passed: `4`
- Product failed: `1` (`malformed-not-sgf`, expected failure)
- All valid fixtures: `quality ok=true`, `failures=0`, `warnings=0`

| Fixture | Moves | Product | Duration ms | Quality | Turns ok/failed | BSI | ADI |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| short-2-move | 2 | passed | 39335 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| nine-by-nine-pass | 6 | passed | 39326 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| handicap-initial-stones | 7 | passed | 39653 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| midgame-24-move | 24 | passed | 39377 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| malformed-not-sgf | n/a | expected fail | n/a | n/a | n/a | n/a | n/a |

## Extended Fixture Suite

Report path:

```text
.tmp/katago-suite/latest-extended/benchmark-2026-07-09T05-45-51-300Z.md
```

Summary:

- Suite passed: `true`
- Expectation met: `3/3`
- Product passed: `3`
- Product failed: `0`
- All fixtures: `quality ok=true`, `failures=0`, `warnings=0`

| Fixture | Moves | Product | Duration ms | Quality | Turns ok/failed | BSI | ADI |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| synthetic-13x13-40-move | 40 | passed | 37729 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| synthetic-19x19-60-move | 60 | passed | 36440 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| synthetic-19x19-100-move | 100 | passed | 36892 | ok, f=0, w=0 | 2/0 | 2 | 2 |

## Repeat Sample Suite

Report path:

```text
.tmp/katago-suite/repeat-sample/benchmark-2026-07-09T06-05-07-771Z.md
```

Summary:

- Suite passed: `true`
- Expectation met: `3/3`
- Product passed: `3`
- Product failed: `0`
- All runs: `quality ok=true`, `failures=0`, `warnings=0`

| Fixture | Moves | Product | Duration ms | Quality | Turns ok/failed | BSI | ADI |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| test.sgf#1 | 2 | passed | 40225 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| test.sgf#2 | 2 | passed | 38658 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| test.sgf#3 | 2 | passed | 39537 | ok, f=0, w=0 | 1/0 | 1 | 1 |

## Gated Synthetic Suite - 2026-07-10

Report path:

```text
.tmp/katago-suite/gated-synthetic-2026-07-10/benchmark-2026-07-10T04-24-30-346Z.md
```

Command:

```bash
corepack pnpm katago:product-suite -- --default-fixtures --extended-fixtures --strict-warnings --max-successful-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --out-dir .tmp/katago-suite/gated-synthetic-2026-07-10
```

Summary:

- Suite passed: `true`
- Gate passed: `true`
- Expectation met: `8/8`
- Product passed: `7`
- Product failed: `1` (`malformed-not-sgf`, expected failure)
- Successful duration p50: `36365ms`
- Successful duration p95: `39518ms`
- Expected-pass failure rate: `0`
- Quality warning rows: `0`
- Quality failure rows: `0`

| Fixture | Moves | Product | Duration ms | Quality | Turns ok/failed | BSI | ADI |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| short-2-move | 2 | passed | 39518 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| nine-by-nine-pass | 6 | passed | 36002 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| handicap-initial-stones | 7 | passed | 35862 | ok, f=0, w=0 | 1/0 | 1 | 1 |
| midgame-24-move | 24 | passed | 36573 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| malformed-not-sgf | n/a | expected fail | n/a | n/a | n/a | n/a | n/a |
| synthetic-13x13-40-move | 40 | passed | 36125 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| synthetic-19x19-60-move | 60 | passed | 36535 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| synthetic-19x19-100-move | 100 | passed | 36365 | ok, f=0, w=0 | 2/0 | 2 | 2 |

## Customer-Style Synthetic Suite - 2026-07-10

Report path:

```text
.tmp/katago-suite/customer-style-2026-07-10/benchmark-2026-07-10T05-54-58-678Z.md
```

Command:

```bash
corepack pnpm katago:product-suite -- --customer-fixtures --strict-warnings --max-successful-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0 --out-dir .tmp/katago-suite/customer-style-2026-07-10
```

Summary:

- Suite passed: `true`
- Gate passed: `true`
- Expectation met: `4/4`
- Product passed: `4`
- Product failed: `0`
- Successful duration p50: `36143ms`
- Successful duration p95: `38197ms`
- Expected-pass failure rate: `0`
- Quality warning rows: `0`
- Quality failure rows: `0`

| Fixture | Moves | Product | Duration ms | Quality | Turns ok/failed | BSI | ADI |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| customer-style-9x9-endgame-passes | 38 | passed | 38197 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| customer-style-13x13-commented-80-move | 80 | passed | 36088 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| customer-style-19x19-120-move | 120 | passed | 36158 | ok, f=0, w=0 | 2/0 | 2 | 2 |
| customer-style-19x19-long-160-move | 160 | passed | 36143 | ok, f=0, w=0 | 2/0 | 2 | 2 |

## Persistent Root Benchmark - 2026-07-10

Report path:

```text
.tmp/katago-persistent-benchmark/customer-style-2026-07-10/persistent-benchmark-2026-07-10T06-57-26-698Z.md
```

Command:

```bash
corepack pnpm katago:persistent-benchmark -- --customer-fixtures --out-dir .tmp/katago-persistent-benchmark/customer-style-2026-07-10
```

Summary:

- Benchmark passed: `true`
- Expectation met: `4/4`
- Spawn root duration p50: `17914ms`
- Spawn root duration p95: `17964ms`
- Persistent root duration p50: `801ms`
- Persistent root duration p95: `18125ms` (includes the first cold request)
- Persistent warm root duration p50: `801ms`
- Persistent warm root duration p95: `2269ms`
- Speedup ratio p50: `7.92x`

| Target | Moves | Spawn ms | Persistent ms | Speedup |
| --- | ---: | ---: | ---: | ---: |
| customer-style-9x9-endgame-passes | 38 | 17871 | 18125 | 0.99 |
| customer-style-13x13-commented-80-move | 80 | 17914 | 734 | 24.41 |
| customer-style-19x19-120-move | 120 | 17916 | 801 | 22.37 |
| customer-style-19x19-long-160-move | 160 | 17964 | 2269 | 7.92 |

Interpretation:

- 첫 persistent 요청은 모델 로딩 때문에 spawn baseline과 비슷하다.
- 같은 long-lived KataGo process에서 이어지는 warm 요청은 `734-2269ms` 범위로 내려간다.
- 이 시점의 benchmark는 root KataGo analysis latency만 검증했다. 이후 product-path 통합 결과는 아래 2026-07-10 추가 측정을 따른다.

## Persistent Product Path Suite - 2026-07-10

root benchmark 이후 `KATAGO_PERSISTENT_ROOT_ENABLED=true`를 실제 Worker product path에 통합하고 customer-style fixture 4건을 다시 실행했다. 당시 상세 산출물은 `.tmp/katago-suite/customer-style-persistent-2026-07-10/`에 생성했으며 저장소 정리 과정에서 제거하고 아래 집계만 보존한다.

```powershell
$env:KATAGO_MAX_VISITS='25'
$env:KATAGO_MULTI_TURN_MAX='2'
$env:KATAGO_WINRATE_TIMELINE_ENABLED='false'
$env:KATAGO_DEEP_SEARCH_ENABLED='false'
$env:KATAGO_PERSISTENT_ROOT_ENABLED='true'
corepack pnpm katago:product-suite -- --customer-fixtures --strict-warnings
```

- 성공: `4/4`
- 전체 시간: `97695ms`
- 성공 분석 p50: `19979ms`
- 성공 분석 p95: `37081ms`
- quality warning/failure rows: `0/0`
- 첫 cold 요청 이후 root 구간: `451ms`, `476ms`, `494ms`

따라서 persistent root의 product-path 통합은 완료됐다. 다만 이 결과는 synthetic fixture와 낮은 visits 프로필이므로 실제 고객 corpus, 기본 운영 프로필, timeline/Deep Search, 동시성과 queue wait 검증을 대체하지 않는다.

## Findings

1. 제품 경로 신뢰성은 개선됐다. default + extended 기준 유효 fixture 7개 모두 `quality ok=true`, `failures=0`, `warnings=0` 이다.
2. malformed SGF는 제품 실패가 아니라 입력 검증 실패로 정상 처리됐다.
3. 지연 시간은 SGF 길이에 거의 비례하지 않는다. 2수 fixture가 약 39.3초이고 100수 fixture가 약 36.9초다.
4. 현재 로컬 프로파일에서는 KataGo 프로세스 시작, 모델 로드, 또는 고정 초기화 비용이 지배적일 가능성이 높다.
5. 동일 SGF 3회 반복에서도 38.6-40.2초 범위를 벗어나지 않았다. 단순 반복 실행만으로 의미 있는 warm-path 개선은 확인되지 않았다.
6. 2026-07-10 gated synthetic suite는 p95 39.5초, expected-pass failure rate 0, quality warning/failure row 0으로 launch gate를 통과했다.
7. 2026-07-10 customer-style synthetic suite는 metadata/comment/pass/장기 대국 패턴 4개를 p95 38.2초, expected-pass failure rate 0, quality warning/failure row 0으로 통과했다.
8. 2026-07-10 persistent root benchmark는 spawn root p95 18.0초 대비 persistent warm root p95 2.3초를 보여줬다. long-lived KataGo process 방향은 성능상 타당하다.
9. 이 결과만으로는 상용 UX를 확정할 수 없다. 실제 고객형 SGF corpus, 높은 visits, timeline ON, Deep Search ON, full product persistent worker 또는 GPU/전용 worker benchmark가 추가로 필요하다.

## Runtime Recommendation

공개 유료 서비스 기준으로는 요청마다 새 `katago analysis` 프로세스를 띄우는 구조를 그대로 유지하면 대기 시간이 커질 위험이 높다. persistent root benchmark에서 warm 요청이 1초 안팎까지 내려가는 것이 확인됐으므로, 현재 spawn-per-analysis 구조는 로컬/스테이징 smoke 용도로만 보고 상용 paid UX는 persistent KataGo worker 또는 GPU/전용 worker host를 전제로 설계한다.

새 product suite report는 이후 실행부터 성공 분석 duration `p50`/`p90`/`p95`, expected-pass failure rate, quality warning/failure row count를 자동 기록한다. `--max-successful-p95-ms`, `--max-expected-pass-failure-rate`, `--max-quality-warning-rows`, `--max-quality-failure-rows` 를 지정하면 기준 초과 시 suite가 실패한다. 이 문서의 기존 2026-07-09 측정값은 해당 stats/gate 필드 추가 전 산출물이므로 표에 있는 개별 duration으로 해석한다.

남은 최소 추가 측정:

- `KATAGO_MAX_VISITS=100`, `200` 비교
- `KATAGO_MULTI_TURN_MAX=6` 비교
- `KATAGO_WINRATE_TIMELINE_ENABLED=true` 비교
- `KATAGO_DEEP_SEARCH_ENABLED=true` 는 GPU/전용 worker에서만 소규모로 비교
- persistent process / worker pool prototype에서 queue wait, p50/p95, timeout, 실패율을 분리 측정
