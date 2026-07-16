# KataGo Corpus Manifest v1

이 문서는 실제 고객형 SGF를 KataTalk 출시 품질 근거로 사용할 때 적용하는 계약이다. 단순히 디렉터리의 모든 파일을 실행하는 방식과 달리, 각 기보의 무결성·익명화·입력 범위·분석 기대치·사람 검수 상태를 명시적으로 고정한다.

## 보장 범위

`katago:corpus-validate`는 다음 조건을 KataGo 실행 전에 검사한다.

- manifest version과 필드 구조
- 최소 10개의 서로 다른 SGF
- 상대 경로 confinement와 symlink 탈출 차단
- 파일당 1MB 이하, UTF-8, SHA-256 일치
- 중복 id, 경로, 파일 내용 차단
- 9x9, 13x13, 19x19, 접바둑, pass, setup stone, 100수 이상 기보 coverage
- SGF 식별 가능 metadata 제거
- 기대 board size와 move 범위
- 선택적으로 기보당 서로 다른 검수자 2명의 승인과 rejection 부재

`katago:product-suite -- --corpus-manifest ...`는 여기에 실제 분석 결과 조건을 추가한다.

- 최소 visits
- 성공한 multi-turn 수
- 실패한 multi-turn 상한
- 최소 BSI/ADI signal 수
- quality warning/failure 상한

이 검사는 사람의 바둑 판단을 자동으로 대체하지 않는다. checksum과 metadata 검사는 파일 무결성과 기본 익명화만 보장하며, 코멘트 안의 자유 형식 개인정보와 데이터 사용 동의는 담당자가 별도로 확인해야 한다.

## 보관 위치

실제 SGF와 manifest는 커밋하지 않고 기본적으로 아래처럼 ignore된 로컬 디렉터리에 둔다.

```text
.local/katago-corpus/
  manifest.json
  games/
    game-001.sgf
    ...
```

manifest 밖의 절대 경로와 상위 디렉터리 경로는 허용하지 않는다.

## Manifest 예시

아래는 한 entry의 형식만 보여 주는 축약 예시다. 실제 manifest는 서로 다른 10건 이상과 모든 required coverage를 포함해야 한다.

```json
{
  "version": 1,
  "id": "commercial-corpus-2026-07-v1",
  "minimumEntries": 10,
  "requiredCoverage": [
    "board-9",
    "board-13",
    "board-19",
    "handicap",
    "pass",
    "setup-stones",
    "long-game"
  ],
  "entries": [
    {
      "id": "game-001",
      "sgf": "games/game-001.sgf",
      "sha256": "64-character-lowercase-sha256",
      "provenance": "customer-consented",
      "anonymized": true,
      "expected": {
        "productPass": true,
        "boardSize": 19,
        "minMoves": 80,
        "maxMoves": 350,
        "minVisits": 200,
        "minTurnsOk": 2,
        "maxTurnsFailed": 0,
        "minBsiSignals": 1,
        "minAdiSignals": 1,
        "maxQualityWarnings": 0,
        "maxQualityFailures": 0
      },
      "reviews": [
        {
          "reviewerId": "reviewer-a",
          "reviewedAt": "2026-07-14T00:00:00.000Z",
          "verdict": "approved",
          "scores": {
            "criticalMomentAccuracy": 5,
            "candidateUsefulness": 4,
            "educationalUsefulness": 4
          }
        },
        {
          "reviewerId": "reviewer-b",
          "reviewedAt": "2026-07-14T00:00:00.000Z",
          "verdict": "approved",
          "scores": {
            "criticalMomentAccuracy": 4,
            "candidateUsefulness": 4,
            "educationalUsefulness": 4
          }
        }
      ]
    }
  ]
}
```

`provenance`는 `customer-consented`, `licensed-public`, `internal` 중 하나다. 이름이나 이메일 대신 내부에서만 의미가 있는 pseudonymous reviewer id를 사용한다.

## 익명화

validator는 다음 SGF property가 남아 있으면 실패한다.

```text
AN BR BT CP DT EV GN ON PB PC PW RO SO US WR WT
```

플레이어 이름뿐 아니라 랭크, 팀, 이벤트, 날짜, 장소, 라운드, 출처처럼 조합 시 개인을 식별할 수 있는 metadata도 제거한다. `C[]` 등 자유 형식 코멘트는 자동 판정에 한계가 있으므로 수동 검토한다.

SHA-256은 익명화가 끝난 최종 파일에서 계산한다.

```powershell
(Get-FileHash -Algorithm SHA256 .local/katago-corpus/games/game-001.sgf).Hash.ToLowerInvariant()
```

익명화 이후 파일이 한 바이트라도 바뀌면 manifest checksum을 의도적으로 다시 승인해야 한다.

## 사람 검수 기준

두 검수자는 서로 독립적으로 다음 항목을 1~5점으로 평가한다.

- `criticalMomentAccuracy`: 중요한 장면 선택이 실제 대국 검토에 타당한가
- `candidateUsefulness`: 후보 수순과 PV가 해당 장면의 대안을 이해하는 데 유용한가
- `educationalUsefulness`: 결과가 사용자의 다음 학습 행동으로 연결되는가

`approved`는 세 항목 모두 제품에 노출 가능한 수준이라고 검수자가 판단한 경우에만 사용한다. 한 명이라도 `rejected`이면 `--require-human-review` 출시 게이트가 실패한다.

## 실행 순서

1. KataGo를 실행하지 않는 빠른 사전 검사:

```powershell
corepack pnpm katago:corpus-validate -- .local/katago-corpus/manifest.json
```

2. 사람 검수까지 포함한 출시 사전 검사:

```powershell
corepack pnpm katago:corpus-validate -- .local/katago-corpus/manifest.json --require-human-review
```

3. 실제 분석 결과 strict gate:

```powershell
$env:KATAGO_PERSISTENT_ROOT_ENABLED='true'
$env:KATAGO_MAX_VISITS='200'
$env:KATAGO_MULTI_TURN_MAX='6'
corepack pnpm katago:product-suite -- --corpus-manifest .local/katago-corpus/manifest.json --require-human-review --strict-warnings --max-successful-p95-ms 120000 --max-expected-pass-failure-rate 0 --max-quality-warning-rows 0 --max-quality-failure-rows 0
```

명령이 성공해도 보고서의 각 corpus check와 p50/p95를 확인한다. 실제 queue wait와 동시성은 이 suite가 아니라 별도 운영 부하 검증에서 측정한다.

## 완료 판정

AI-01/AI-02/AI-03은 다음 근거가 모두 있을 때만 완료한다.

- 실제 사용 허가와 익명화가 확인된 서로 다른 SGF 10건 이상
- 모든 필수 coverage
- manifest 사전 검사 통과
- 운영 프로필 product suite 경고·실패 0
- 기보별 독립 검수자 2명 승인
- 결과 report와 검수 기록의 보관 위치가 운영 문서에 기록됨
