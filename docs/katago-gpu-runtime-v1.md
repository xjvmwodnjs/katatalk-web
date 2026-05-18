# KataGo GPU Runtime Integration v1

로컬 RTX GPU에서 KataGo Analysis Engine이 실제 GPU backend로 실행되는지 검증하는 절차다. 코드가 CPU(Eigen) KataGo binary를 GPU binary로 바꿀 수는 없으므로 OpenCL/CUDA/TensorRT build와 model/config는 사용자가 로컬에 직접 준비해야 한다.

## Backend Check Modes

- `KATAGO_BACKEND_CHECK_MODE=version`: `katago version` 출력에서 backend를 감지한다. 기본값이다.
- `KATAGO_BACKEND_CHECK_MODE=analysis_smoke`: `katago analysis -config <config> -model <model>`에 짧은 JSON query를 넣어 실제 analysis 응답을 확인한다.
- `KATAGO_BACKEND_CHECK_MODE=version_then_smoke`: version check와 analysis smoke가 모두 통과해야 한다. 로컬 GPU smoke 권장값이다.

GPU backend 판정은 `cuda`, `opencl`, `tensorrt`만 true다. `eigen`, `unknown`은 GPU로 보지 않는다.

## Analysis Smoke Query

Smoke query는 SGF 원문 없이 빈 보드 기준 JSON 한 줄만 stdin으로 전달한다.

- `analyzeTurns=[0]`
- `maxVisits=KATAGO_BACKEND_CHECK_SMOKE_VISITS` (기본 `10`)
- `includeOwnership=false`
- `includePolicy=false`
- `analysisPVLen=1`

JSON 응답에 `rootInfo` 또는 `moveInfos`가 있고 process exit code가 `0`이면 smoke ok로 본다. stderr/stdout에서 `cuda`, `opencl`, `tensorrt`, `eigen` 키워드도 backend 판정에 사용하지만 raw output은 로그에 남기지 않는다.

## Recommended Local Env

PowerShell 예시는 placeholder만 사용한다. 실제 path는 문서나 Git에 남기지 않는다.

```powershell
$env:ANALYSIS_ENGINE = "katago"
$env:ANALYSIS_WORKER_MODE = "external"
$env:KATATALK_ALLOW_MOCK_ANALYSIS = "false"
$env:KATAGO_BINARY_PATH = "<KATAGO_GPU_BINARY_PATH>"
$env:KATAGO_CONFIG_PATH = "<KATAGO_ANALYSIS_CONFIG_PATH>"
$env:KATAGO_MODEL_PATH = "<KATAGO_MODEL_PATH>"
$env:KATAGO_REQUIRE_GPU_BACKEND = "true"
$env:KATAGO_BACKEND_CHECK_MODE = "version_then_smoke"
$env:KATAGO_BACKEND_CHECK_SMOKE_VISITS = "10"
$env:KATAGO_WINRATE_TIMELINE_ENABLED = "true"
$env:KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS = "true"
$env:KATAGO_WINRATE_TIMELINE_MAX_VISITS = "50"
```

Web과 Worker를 별도 process로 띄우는 경우, realtime timeline progress를 보려면 양쪽에 `KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS=true`가 필요하다. Worker만 true이면 progress 파일은 생겨도 Web endpoint가 progress unavailable로 응답할 수 있다.

## Worker Startup 확인

Worker startup log에는 enum/boolean만 남는다.

```text
katagoBackend=cuda
katagoGpuBackend=true
katagoBackendCheckOk=true
katagoBackendCheckMode=version_then_smoke
katagoSmokeOk=true
hasBinaryPath=true
hasConfigPath=true
hasModelPath=true
```

`KATAGO_REQUIRE_GPU_BACKEND=true`일 때 `katagoGpuBackend=true`와 `katagoBackendCheckOk=true`가 아니면 Worker startup이 실패한다. `katagoBackend=eigen`이면 CPU 실행이다. `katagoBackend=unknown`이면 GPU binary가 아니거나 runtime 초기화 실패, 또는 출력에서 backend를 판정하지 못한 상태일 수 있다.

## Config Sanity

`KATAGO_CONFIG_PATH`는 analysis용 config를 권장한다. startup check는 파일 내용을 로그로 출력하지 않고 다음 boolean만 확인한다.

- config file exists
- analysis config로 보이는 key 존재 여부
- `cudaDeviceToUse` 또는 `openclDeviceToUse` 같은 GPU device key 존재 여부

이 sanity check는 warning 성격이다. 특정 key가 없다는 이유만으로 startup fail-fast하지 않는다. require mode의 핵심 fail 조건은 GPU backend 판정과 smoke ok 여부다.

## NVIDIA 확인

NVIDIA 환경에서는 Worker 실행 후 별도 PowerShell에서 확인한다.

```powershell
nvidia-smi
```

분석 중 `katago.exe`가 process 목록에 보이고 GPU utilization 또는 memory 사용량이 증가하는지 확인한다. CUDA/TensorRT가 가능하면 NVIDIA 환경에서 유리할 수 있지만, 로컬 개발은 OpenCL/CUDA부터 먼저 확인한다.

## Realtime Timeline Smoke

1. Worker 단독 실행.
2. startup log에서 `katagoBackend=cuda|opencl|tensorrt` 확인.
3. `katagoBackendCheckOk=true` 확인.
4. `katagoSmokeOk=true` 확인.
5. Web에서 SGF 업로드.
6. 승률 그래프가 pending -> partial -> final로 채워지는지 확인.
7. `nvidia-smi`에서 `katago.exe` GPU 사용 여부 확인.
8. 첫 partial까지 latency와 completed까지 latency를 기록.

## 비노출 정책

로그와 문서에는 실제 `KATAGO_BINARY_PATH`, `KATAGO_CONFIG_PATH`, `KATAGO_MODEL_PATH`, SGF 원문, secret/API key, raw stderr/stdout dump를 남기지 않는다.
