# Local Real-time Winrate Timeline v1

로컬/dev에서 KataGo `analyzeTurns`와 `reportDuringSearchEvery`를 사용해 기보 전체 수순의 승률 그래프를 빠르게 채우는 기능이다. DB schema, Railway 설정, 결제, LLM 연결은 사용하지 않는다.

## Query 정책

- `KATAGO_WINRATE_TIMELINE_ENABLED=true`일 때만 quick scan을 실행한다.
- `moves`와 `initialStones`는 기존 SGF parser 결과를 그대로 전달한다.
- `analyzeTurns`는 `0..totalMoves`를 생성하되 `KATAGO_WINRATE_TIMELINE_MAX_TURNS`로 clamp한다.
- `maxVisits`는 `KATAGO_WINRATE_TIMELINE_MAX_VISITS`를 우선 사용하고, 없으면 legacy `KATAGO_WINRATE_TIMELINE_VISITS`를 읽는다.
- `reportDuringSearchEvery`는 `KATAGO_WINRATE_TIMELINE_REPORT_EVERY_SECONDS`를 사용한다.
- `includeOwnership=false`, `includeMovesOwnership=false`, `includePolicy=false`.
- KataGo stdout은 out-of-order일 수 있으므로 `turnNumber` 기준으로 merge한다.

## Local progress transport

- `KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS=true`일 때만 local/dev에서 progress 파일을 쓴다.
- production(`NODE_ENV=production`)에서는 local progress transport를 비활성화한다.
- progress file 위치는 `.tmp/katatalk-progress/<jobId>.jsonl`이다.
- progress event에는 `jobId`, `turnIndex`, `isDuringSearch`, `visits`, `winrate`, `scoreLead`, `currentPlayer`, `receivedAt`만 기록한다.
- SGF 원문, binary/model/config path, secret/API key는 기록하지 않는다.

## UI 정책

- 분석 중 client가 `/api/analyze/:jobId/timeline-progress`를 polling한다.
- partial point는 `isDuringSearch=true`, final point는 `isDuringSearch=false`로 표시한다.
- 아직 값이 없는 turn은 pending point로 흐리게 표시한다.
- completed 후에는 기존 완료 result의 `winrateTimelineV1`과 Product Review / ExplanationPlanV2 흐름을 유지한다.
- timeline 변화는 참고 흐름이며 손실 판정으로 표시하지 않는다.

## Local GPU timeline smoke

1. CUDA/OpenCL/TensorRT KataGo binary를 사용한다.
2. `KATAGO_REQUIRE_GPU_BACKEND=true`를 설정한다.
3. `KATAGO_WINRATE_TIMELINE_ENABLED=true`를 설정한다.
4. `KATAGO_WINRATE_TIMELINE_MAX_VISITS=50`을 설정한다.
5. `KATAGO_WINRATE_TIMELINE_REPORT_EVERY_SECONDS=0.5`를 설정한다.
6. `KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS=true`를 설정한다.
7. Worker를 실행한다.
8. startup log에서 `katagoBackend=cuda|opencl|tensorrt`, `katagoBackendCheckOk=true`, `katagoSmokeOk=true`를 확인한다.
9. SGF를 업로드한다.
10. 그래프가 pending → partial → final로 채워지는지 확인한다.
11. NVIDIA 환경에서는 `nvidia-smi`로 KataGo 프로세스/GPU 사용률을 확인한다.
