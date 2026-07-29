# KataGo 승률 축 검증

> 상태: **구성 파일에 기록된 승률 축에 대해 VERIFIED**
> 기준일: 2026-07-14
> 범위: 승률 관점 계약과 흑/백 표시 변환. 고객 기보 분석 품질과 사람 검수는 별도 출시에 필요한 근거다.

## 1. 결론

- KataGo 공식 Analysis Engine 문서는 모든 출력 승률이 analysis config의 `reportAnalysisWinratesAs` 관점을 따른다고 명시한다.
- Worker는 실제 `KATAGO_CONFIG_PATH` 파일에서 활성 설정을 정확히 하나 읽어야 시작한다.
- 선택 환경 변수 `KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED`가 실제 설정과 다르면 Worker 시작을 차단한다.
- 분석 결과에는 검증된 관점과 근거 출처를 기록한다. 관점 metadata가 없는 기존 결과는 변환하지 않고 `KataGo 출력 승률`로 유지한다.
- 현재 로컬 검증 config는 `BLACK`이며, UI는 흑 승률을 기본으로 표시하고 백 승률을 `1 - blackWinrate`로 전환한다.

공식 계약: [KataGo Analysis Engine documentation](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md)

## 2. 변환 계약

| config 값    | 저장 관점      |                                    흑 승률 |     백 승률 | 추가로 필요한 근거                                          |
| ------------ | -------------- | -----------------------------------------: | ----------: | ----------------------------------------------------------- |
| `BLACK`      | `black`        |                                      `raw` |   `1 - raw` | config 파싱 성공                                            |
| `WHITE`      | `white`        |                                  `1 - raw` |       `raw` | config 파싱 성공                                            |
| `SIDETOMOVE` | `side_to_move` | 현재 차례가 흑이면 `raw`, 백이면 `1 - raw` | `1 - black` | 각 root의 명시적 `currentPlayer` 또는 요청의 `playerToMove` |

`raw`는 유한한 숫자이며 `0..1` 범위로 제한한다. `SIDETOMOVE`에서 현재 차례 근거가 없거나 config 관점이 확인되지 않으면 흑/백 수치를 생성하지 않는다.

## 3. 안전 장치

- 주석을 제외한 활성 `reportAnalysisWinratesAs`가 정확히 하나여야 한다.
- 지원 표기는 KataGo config 계약과 같은 `BLACK`, `WHITE`, `SIDETOMOVE`뿐이다. 대소문자는 허용하지만 임의 별칭은 거부한다.
- 누락, 중복, 미지원 값, 읽을 수 없는 config, 기대값 불일치는 `KATAGO_WINRATE_PERSPECTIVE_UNVERIFIED`로 fail-closed 처리한다.
- Worker 시작 로그와 결과에는 정규화된 관점과 출처만 기록하며 config 경로와 본문은 노출하지 않는다.
- product quality gate는 실제 KataGo 결과에 검증된 관점 metadata가 없으면 실패한다.
- 기존 결과와 외부 fixture는 관점을 추측하지 않는다.

## 4. 실제 엔진 검증

검증 엔진은 KataGo `v1.16.4`, git revision `4b8de63bea2bd8790db96cd6f8daf86dc87be6f7`, CUDA `12.5.82`다. `KATAGO_MAX_VISITS=25`, multi-turn 2, timeline/deep search OFF, persistent root/multi-turn strict 조건에서 기본 fixture suite를 실행했다.

| 시나리오           |  수 | root current | turn current 표본 |         raw | 흑 표시 | 백 표시 | 품질 경고/실패 |
| ------------------ | --: | ------------ | ----------------- | ----------: | ------: | ------: | -------------: |
| 짧은 19x19         |   2 | B            | W                 | 0.470996491 |  47.10% |  52.90% |            0/0 |
| pass 포함 9x9      |   6 | B            | W                 | 0.999517352 |  99.95% |   0.05% |            0/0 |
| setup stone 접바둑 |   7 | B            | W                 | 0.995884948 |  99.59% |   0.41% |            0/0 |
| 24수 13x13         |  24 | B            | W, W              | 0.998548152 |  99.85% |   0.15% |            0/0 |

- 기대 결과: malformed 입력의 예상 실패를 포함해 5/5 통과
- 정상 product 결과: 4/4 통과
- 총 실행 시간: 25,779ms, 실행 시간 25,754ms
- p50 1,331ms, p95 20,889ms, 처리량 11.65 jobs/min
- 모든 행에서 `axis=black`, `source=config`, 흑+백 표시 합계 100%, 품질 경고/실패 0/0

이 실행은 낮은 visits의 합성 fixture로 변환 계약과 제품 경로를 확인한 것이다. 고객 수준 분석 정확도나 교육적 해설 품질의 근거로 사용하지 않는다.

## 5. 회귀 검증

- config 파서: 누락, 중복, 미지원 값, 기대값 불일치, 읽을 수 없는 경로, Worker fail-closed
- 정규화: `BLACK`, `WHITE`, `SIDETOMOVE`, current player 누락, 비정상 raw 값
- timeline: 흑/백 차례, setup stone, pass를 통과한 모든 점의 동일 축 변환
- result quality gate: 관점 metadata 누락 시 실패
- UI E2E: `390x844`, `430x932`, `1440x900`에서 흑/백 토글과 SVG 축 라벨 전환

## Contract CI verified; real-engine rerun pending

Contract fixtures verify initial-player admission and propagation: pre-mainline `PL` priority, first-move fallback, matching `HA>=2`/final black setup count, `HA[0]` no-handicap, and fixed 400 rejection for invalid conflicts and setup coordinates. Primary/spawn/persistent, multi-turn, deep search, benchmark, timeline, synthetic probe, and UI playback propagation are covered. The focused suite passed 207 tests, the complete local suite passed 84 files / 857 tests, and GitHub CI [run 30426033948](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/30426033948) passed type/unit/build/secret/format, Playwright, PostgreSQL, and production dependency gates for functional commit `e02f3d1`. Real-engine/staging reruns remain pending; the historical 2026-07-14 table above is unchanged.

## Strict SGF metadata admission CI verified; exporter/staging rerun pending

Functional commit `4a75b70` adds strict root `SZ`/`KM` cardinality, placement, launch-size, and exact-komi admission; missing-value provenance; common KataGo query propagation; root-only UI playback; and identity-only Clerk upload authentication before validation. Invalid fixtures leave wallet, debit, enqueue, and job state untouched, while an accepted upload provisions its wallet exactly once after admission. GitHub CI [run 30433097938](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/30433097938) passed 85 files / 871 tests plus formatting, type, secret, production Web/API/Worker build, Playwright, PostgreSQL migration/ACL/atomicity, and production dependency gates across all four jobs. Real-exporter, real-engine, and staging reruns remain pending; the historical 2026-07-14 table above is unchanged.

## 6. 배포 절차

1. Worker analysis config에 `reportAnalysisWinratesAs`를 정확히 하나 설정한다.
2. 같은 값을 `KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED`에 설정한다.
3. Worker 시작 로그에서 검증된 관점과 `source=config`를 확인한다.
4. strict product suite에서 관점 gate, 품질 경고/실패 0, 흑+백 변환을 확인한다.
5. 실제 고객 corpus와 독립 바둑 검수자 결과를 별도 AI-01/02/03 gate로 통과시킨다.

KataGo 버전, 모델 또는 analysis config를 변경할 때 이 검증을 다시 수행한다. BSI의 score 관점은 이번 승률 축 검증과 별도이며 아직 provisional이다.
