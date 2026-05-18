# KataGo GPU Backend Validation v1

이 문서는 로컬/Worker에서 KataGo가 GPU backend로 실행되는지 확인하는 절차를 설명한다. 실제 binary, model, config 경로는 문서나 로그에 기록하지 않는다.

## 전제

- 코드만으로 CPU(Eigen) build KataGo를 GPU build로 바꿀 수 없다.
- `KATAGO_BINARY_PATH`는 OpenCL 또는 CUDA backend가 포함된 KataGo 실행 파일을 가리켜야 한다.
- `KATAGO_CONFIG_PATH`는 analysis용 config를 가리켜야 한다.
- `KATAGO_MODEL_PATH`는 사용할 model 파일을 가리켜야 한다.
- repository에는 실제 경로, secret, API key를 커밋하지 않는다.

## Backend 값

Worker startup에서 backend check 결과를 다음 enum으로 기록한다.

- `cuda`: CUDA backend로 감지됨
- `opencl`: OpenCL backend로 감지됨
- `eigen`: Eigen/CPU backend로 감지됨
- `unknown`: 출력, 실패, timeout 등으로 backend를 확정하지 못함

로그는 `katagoBackend=<value>`와 boolean 상태만 남기며 실제 path 값은 남기지 않는다.

## Env

```env
KATAGO_REQUIRE_GPU_BACKEND=false
KATAGO_BACKEND_CHECK_TIMEOUT_MS=10000
```

- `KATAGO_REQUIRE_GPU_BACKEND=false`: 기본값. `eigen` 또는 `unknown`이어도 경고성 startup log만 남기고 계속 진행한다.
- `KATAGO_REQUIRE_GPU_BACKEND=true`: `cuda` 또는 `opencl`이 아니면 Worker startup에서 실패한다.
- `KATAGO_BACKEND_CHECK_TIMEOUT_MS`: backend check timeout. 기본값은 `10000`ms다.

## Local GPU Smoke

1. `KATAGO_BINARY_PATH`가 OpenCL/CUDA KataGo를 가리키도록 로컬 env에 설정한다.
2. `KATAGO_CONFIG_PATH`가 analysis용 config를 가리키는지 확인한다.
3. `KATAGO_REQUIRE_GPU_BACKEND=true`를 설정한다.
4. Worker를 실행한다.
5. startup log에서 `katagoBackend=opencl` 또는 `katagoBackend=cuda`를 확인한다.
6. NVIDIA GPU 환경에서는 분석 중 `nvidia-smi`에서 KataGo 프로세스와 GPU 사용률을 확인한다.

`katagoBackend=eigen`이면 CPU 실행이다. 이 경우 GPU build KataGo binary와 GPU runtime/driver 설치 상태를 별도로 확인해야 한다.

## Realtime Timeline Smoke

1. OpenCL/CUDA KataGo binary를 사용한다.
2. `KATAGO_REQUIRE_GPU_BACKEND=true`를 설정한다.
3. `KATAGO_WINRATE_TIMELINE_ENABLED=true`를 설정한다.
4. `KATAGO_WINRATE_TIMELINE_MAX_VISITS=50`을 설정한다.
5. `KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS=true`를 설정한다.
6. Worker를 실행한다.
7. startup log에서 `katagoBackend=opencl` 또는 `katagoBackend=cuda`, `backendCheckOk=true`를 확인한다.
8. SGF 업로드 후 승률 그래프가 pending → partial → final로 채워지는지 확인한다.
9. NVIDIA GPU 환경에서는 분석 중 `nvidia-smi`로 KataGo 프로세스/GPU 사용률을 확인한다.
