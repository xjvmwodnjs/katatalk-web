# Railway Staging Smoke Report v1

일시: 2026-05-17 12:49 KST

기준 브랜치: `feature/railway-staging-smoke-report-v1`

기준 master 커밋: `36442a6`

범위: Railway Web/Worker staging smoke report v1. 기능 코드 수정 없음.

## A. 실행 환경

- Railway CLI: `pnpm dlx @railway/cli`로 CLI 실행 가능 확인.
- Railway 인증 상태: 미인증. `railway status`가 `Unauthorized. Please login with railway login`으로 실패.
- Railway project link: 저장소 내 `.railway` 링크 없음.
- Staging Web URL: 현재 세션에서 확인 불가.
- Staging Worker service: 현재 세션에서 확인 불가.
- Supabase: `.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 존재 여부만 확인. 실제 값은 기록하지 않음.
- Supabase project identifier: `<redacted>.supabase.co`
- LLM 호출: 실행 안 함.
- 결제 live 호출: 실행 안 함.
- DB schema/migration 변경: 없음.
- Worker/KataGo 로직 변경: 없음.

## B. Web / Worker Env 확인 결과

Railway 접근 인증이 없어 실제 Web/Worker service variable은 조회하지 못했다.

확인하지 못한 항목:

- Web `ANALYSIS_WORKER_MODE=external`
- Web `ANALYSIS_ENGINE=katago`
- Web `KATATALK_ALLOW_MOCK_ANALYSIS=false`
- Web `KATATALK_LLM_COMMENTARY_ENABLED=false`
- Web에 `KATAGO_BINARY_PATH`, `KATAGO_CONFIG_PATH`, `KATAGO_MODEL_PATH` 없음
- Web `APP_BASE_URL`이 staging URL인지 여부
- Worker `ANALYSIS_WORKER_ID`
- Worker `KATAGO_*` 설정 존재 여부
- Worker `KATAGO_WINRATE_TIMELINE_ENABLED=false`
- Worker `KATAGO_DEEP_SEARCH_ENABLED=false`

## C. Supabase 006 / 007 확인 결과

Supabase URL/service-role 존재 여부는 확인했지만, 현재 접근 방식으로는 migration/schema catalog 확인을 완료하지 못했다.

Read-only 확인 시도 결과:

- `supabase_migrations.schema_migrations`: PostgREST에서 `Invalid schema: supabase_migrations`
- `information_schema.columns`: PostgREST에서 `Invalid schema: information_schema`
- `pg_catalog.pg_proc`: PostgREST에서 `Invalid schema: pg_catalog`

미확인 항목:

- 006 migration 적용 여부
- 007 migration 적용 여부
- `analysis_jobs.locked_at`, `locked_by`, `attempt_count`, `max_attempts`, `next_retry_at`, `last_error_code`
- `claim_next_analysis_job` signature 또는 `pronargs=2`
- service-role/RPC 권한
- `locked_at` 기반 heartbeat 갱신
- failed job refund path

다음 확인은 Supabase SQL editor 또는 DB 접속 권한이 있는 환경에서 read-only SQL로 수행해야 한다.

## D. SGF Sample 결과

Railway staging Web URL과 인증된 Railway service 접근이 없어 SGF 업로드를 실행하지 못했다.

- SGF sample 익명 ID: 미실행
- total moves: 미실행
- queued 상태: 미확인
- running 상태: 미확인
- completed 상태: 미확인
- failed 상태: 미확인

Private SGF 원문 전문은 기록하지 않았다.

## E. Completed / Failed / Latency 결과

- completed job: 없음
- failed job: 없음
- latency: 측정 불가
- `result.source=katago-worker-v1`: 미확인
- `meta.mock=false`: 미확인
- failed/refund: 미확인

이 보고서는 staging smoke Pass 보고서가 아니라, 접근 차단으로 인한 blocker report다.

## F. Product Review UI 확인 결과

completed staging job이 없어 deep link 결과 화면을 확인하지 못했다.

- `/?jobId=<completedJobId>` deep link: 미확인
- board 표시: 미확인
- winrate graph 표시: 미확인
- Product Review 후보 chip 표시: 미확인
- deterministic AI memo 표시: 미확인
- 참고도 보기 / PV overlay: 미확인
- 전체 수순 복귀: 미확인
- try-play 진입 / 착수 / undo / reset: 미확인
- viewport `390x844`: 미확인
- viewport `430x932`: 미확인
- desktop viewport: 미확인

## G. 발견 이슈

- Blocker: Railway CLI 인증이 없어 Web/Worker staging service, env, log, deploy 상태를 조회할 수 없음.
- Blocker: staging Web URL이 현재 세션에서 확인되지 않아 SGF 업로드와 deep link smoke를 실행할 수 없음.
- Blocker: Supabase catalog schema가 PostgREST로 노출되지 않아 006/007 migration, `analysis_jobs` lease/retry 컬럼, `claim_next_analysis_job` signature를 확인할 수 없음.
- Non-blocking: `pnpm dlx @railway/cli --version`은 성공했으므로 인증만 완료되면 CLI 기반 확인을 재시도할 수 있음.

## H. 다음 조치

1. 이 환경에서 `railway login` 또는 `RAILWAY_TOKEN` 설정을 완료한다.
2. Railway project/service를 link하거나 Web/Worker service 이름을 지정한다.
3. Staging Web URL을 확인한다.
4. Supabase SQL editor 또는 DB 접속 권한으로 006/007, lease/retry 컬럼, `claim_next_analysis_job` signature를 read-only로 확인한다.
5. 위 접근이 준비된 뒤 SGF 업로드부터 Product Review UI까지 staging smoke를 재실행한다.

## I. 최종 판정

- Railway Web/Worker staging smoke: Blocked
- Local code verification: 문서 작성 후 별도 검증
- master 병합 가능성: 실제 staging smoke 완료 전에는 권장하지 않음
