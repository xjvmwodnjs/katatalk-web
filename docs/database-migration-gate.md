# Database migration gate

## 목적

Supabase PostgreSQL 스키마는 번호가 매겨진 migration을 **`001` → `002` → … → `015` 숫자순**으로만 적용한다. 이미 이력이 있는 DB를 추측으로 baseline 처리하지 않는다. reviewed baseline이 없으면 gate는 fail-closed 한다.

## 실행 명령

- `pnpm db:migrate:supabase`: `PG*` 환경변수로 지정한 PostgreSQL 또는 CI container에 migration을 적용한다. 이력 없는 기존 DB는 검토·승인된 baseline manifest가 없으면 거부한다.
- `pnpm test:db:migrations`: fresh/upgrade, checksum, 권한·원자성·동시성 검증을 실행하고 `.tmp/database-gate`에 정제된 migration/security/structure artifact를 남긴다. 이 명령은 DB와 cluster role을 재생성하므로 `POSTGRES_CONTAINER_ID`와 `KATATALK_DB_GATE_CONFIRM=ephemeral-postgres`가 지정된 **폐기 가능한 PostgreSQL container에서만** 실행된다.
- `pnpm db:evidence:staging`: 같은 커밋의 PostgreSQL CI가 만든 `expected-staging-db-contract.json`과 실제 staging의 migration history·RPC/table/schema 권한 및 application structure hash를 비교하고, anon/authenticated PostgREST 거절을 확인한다. 대상 DB를 변경하지 않으며 실행별 고유 경로에 정제된 증거만 원자적으로 남긴다.

## 실제 staging 읽기 전용 증거

보호된 수동 workflow인 `.github/workflows/staging-db-evidence.yml`은 `master`의 동일 커밋에서 폐기 가능한 PostgreSQL 16 DB로 expected contract를 만들고, 그 파일의 SHA-256을 다음 job에 직접 전달한다. expected contract는 fresh와 `011 → 015` upgrade DB의 canonical security catalog hash 및 application structure hash가 모두 같은 경우에만 생성된다. staging에서 관찰한 값을 expected로 승격하거나 `--accept-current`로 drift를 승인하는 경로는 없다.

GitHub Actions 실행 [`30058581181`](https://github.com/xjvmwodnjs/katatalk-web/actions/runs/30058581181)에서 실제 PostgreSQL 16 catalog SQL, fresh/upgrade 동일성, migration history 누락, 함수 본문, table persistence, 독립 composite type drift fixture와 정제된 artifact 업로드가 모두 통과했다. 이 증거는 폐기 가능한 DB 계약을 검증한 것이며 실제 Supabase staging 결과를 대신하지 않는다.

DB 접속은 CLI 인자가 아닌 표준 `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE=postgres`, `PGSSLMODE=verify-full`로 전달한다. `PGPASSFILE`은 사용할 수 있지만 대상 식별을 우회하는 `PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE`은 거부한다. direct host는 `db.<project-ref>.supabase.co`, pooler는 `*.pooler.supabase.com`과 `PGUSER=postgres.<project-ref>` 조합이어야 하며 HTTP origin의 project ref와 일치해야 한다. 다음 값도 필요하다.

- `KATATALK_DB_EVIDENCE_CONFIRM=read-only-staging`
- `KATATALK_EXPECTED_DB_CONTRACT=<동일 커밋 expected contract 절대 경로>`
- `KATATALK_EXPECTED_DB_CONTRACT_SHA256=<동일 workflow가 계산한 contract 파일 SHA-256>`
- `KATATALK_EXPECTED_TARGET_SHA256=<보호된 staging environment의 승인 project-ref SHA-256>`
- `KATATALK_EVIDENCE_COMMIT_SHA=<검증할 40자리 커밋 SHA>` — GitHub Actions에서는 `GITHUB_SHA`를 사용한다.
- `STAGING_SUPABASE_URL=https://<staging-project>.supabase.co`
- `STAGING_SUPABASE_PUBLISHABLE_KEY=<publishable key 또는 legacy anon key>`
- `STAGING_SUPABASE_AUTH_JWT=<유효한 staging Supabase authenticated user JWT>`

`KATATALK_EXPECTED_TARGET_SHA256` 값은 승인된 project ref에 대해 `SHA-256("supabase-project:<project-ref>")`로 한 번 계산해 GitHub `staging` environment variable `STAGING_SUPABASE_PROJECT_SHA256`에 저장한다. raw project ref는 증거 artifact에 저장하지 않는다.

authenticated JWT는 staging Supabase Auth가 발급한 `role=authenticated` 토큰이어야 하고 issuer는 정확히 `<STAGING_SUPABASE_URL>/auth/v1`이어야 한다. collector 시작 시점 기준 최근 1시간 안에 발급되고 5분 이상 남았으며 전체 수명이 2시간 이하인 토큰만 허용한다. 보호된 secret은 workflow 실행 직전에 전용 staging 사용자로 갱신하고, 성공·실패 후 폐기 또는 rotation한다. 장기 수명 JWT를 저장하지 않으며 승인 지연으로 만료되면 새 토큰으로 다시 실행한다. 향후에는 GitHub OIDC를 신뢰하는 token broker로 이 수동 rotation을 대체한다. Clerk 토큰, `service_role` JWT, `sb_secret_*` key는 허용하지 않는다. 새 publishable key는 `apikey` header에만, authenticated user JWT는 별도 bearer header에 넣는다. HTTP credential은 메모리에 캡처한 직후 process environment에서 제거하고, `git`·`psql` 자식 프로세스에는 전달하지 않는다.

collector는 실제 `git rev-parse HEAD`와 요청 커밋을 비교하고 tracked dirty tree를 거부한다. DB 쿼리는 한 번의 `REPEATABLE READ READ ONLY` transaction에서 실행되며 `default_transaction_read_only`, statement/lock/idle timeout을 함께 적용한다. 조회 범위는 migration history와 `pg_catalog`뿐이다. 실제 staging에서는 migration runner, `security_contract.sql`, write RPC, DDL/DML, baseline 작성이 실행되지 않는다.

함수 본문, table persistence/replica identity/access method/tablespace/options/partition bound, column type/default/collation, constraint, index, RLS policy expression, trigger 정의는 DB 안의 extension-owned `pgcrypto.digest(bytea, text)`와 정규화된 catalog 값으로 구조 hash를 만든다. 예상 밖 public custom type도 실패시킨다. `quote_all_identifiers=off`와 non-pretty deparser 출력을 고정하고, expected contract의 PostgreSQL major와 staging major가 다르면 비교 전에 실패한다. 원문은 psql 출력이나 artifact로 내보내지 않는다. 알려진 public function/table 외의 application object도 별도로 탐지해 실패한다. 현재 workflow baseline은 PostgreSQL 16이므로 실제 Supabase major가 다르면 workflow의 폐기 DB image와 CI 지원 범위를 먼저 같은 major로 검토·변경해야 하며, hash mismatch를 승인으로 우회하면 안 된다.

HTTP probe는 부작용 없는 `get_analysis_worker_health`만 호출한다. anon 요청은 정확히 `401`/`42501`, authenticated 요청은 정확히 `403`/`42501`이어야 통과한다. redirect, 2xx, 404/PGRST202, 5xx, 잘못된 JWT, 64 KiB 초과 body, timeout은 모두 실패다.

artifact에는 commit·manifest hash, 기대 migration별 일치 boolean, 알려진 RPC/table의 권한 boolean, canonical security hash, application structure hash, 같은-project binding 결과, HTTP status/error code와 고정 failure code만 포함한다. DB URL/host/user/password, API key/JWT, row data, 함수 본문·policy 식, 예상 밖 role 이름, raw SQL/HTTP 오류 본문은 저장하지 않는다. 기존 파일은 덮어쓰지 않고 임시 파일을 만든 뒤 atomic rename하며, 실패 artifact도 이전 PASS와 혼동되지 않는 실행별 경로를 사용한다.

`staging` GitHub environment에는 master 배포 branch 제한, 독립 reviewer, self-review 방지, 관리자 우회 비활성화를 적용하고 다음 값을 둔다.

- secrets: `STAGING_PGHOST`, `STAGING_PGPORT`, `STAGING_PGUSER`, `STAGING_PGPASSWORD`
- secrets: `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, `STAGING_SUPABASE_AUTH_JWT`
- variable: `STAGING_SUPABASE_PROJECT_SHA256`

credential은 `staging-evidence` job의 collector step에만 주입한다. workflow 실행이 성공하기 전에는 실제 staging gate가 통과했다고 기록하지 않는다.

## 기존 DB 도입 경계

`katatalk_schema_migrations` 이력 없이 `profiles`, `credit_logs`, `analysis_jobs` 중 하나라도 있는 DB는 runner가 즉시 거절한다. 기존 Supabase 프로젝트를 자동으로 baseline하지 않는다. 실제 schema/ACL fingerprint와 적용 이력을 검토한 승인 artifact 및 잠긴 baseline 절차는 아직 별도 출시 게이트이며, 준비되기 전에는 기존 운영 DB에 이 runner를 사용하지 않는다.

## 013/014/015 보안 고정

`013_harden_security_definer_functions.sql`은 최초 11개 `SECURITY DEFINER` 함수의 owner, `search_path=pg_catalog`, 함수 ACL과 관련 table ACL을 고정한다. `014_reconcile_analysis_job_finalization.sql`은 12번째 privileged RPC를 추가하고 quarantine table의 service-role 직접 쓰기 권한을 제거한다. `015_analysis_request_idempotency.sql`은 동일한 동적 owner/search-path/ACL 경계의 13번째 v2 enqueue RPC와 owner-scoped request unique index를 추가하며, rolling deploy를 위해 v1 RPC를 보존한다. `PUBLIC`, `anon`, `authenticated`의 실행은 거부되어야 하며 실제 `anon`·`authenticated` 호출은 PostgreSQL `42501`을 반환해야 한다.

## CI 시나리오

1. **Fresh**: 빈 DB에 `001 → 015` 적용.
2. **Upgrade**: `011`까지 적용된 DB에 `012 → 013 → 014 → 015` 적용.
3. migration filename/checksum drift는 실패.
4. 실제 권한으로 `anon`·`authenticated`의 `42501` 거부를 확인.
5. rollback/fault-injection, quarantine recovery, terminal race, 100회 serial idempotency replay와 32-way paid-enqueue 경쟁을 확인.
6. fresh와 upgrade의 schema equivalence를 job 내부에서 비교하고 schema checksum, migration manifest, 정제된 RPC security snapshot만 artifact로 보존한다. 함수 본문이 포함될 수 있는 raw dump는 업로드하지 않는다.
7. fresh와 upgrade에서 동일한 읽기 전용 collector를 실행해 migration history, 13개 RPC, 6개 table, `public` schema의 direct/effective ACL과 RLS를 검증하고 canonical security hash 및 application structure hash가 같은지 확인한다.
8. SECURITY DEFINER 함수 본문 또는 table persistence만 변조한 별도 DB에서 좁은 권한 hash는 유지되지만 structure hash가 반드시 바뀌는지 확인한다.
9. application object가 있지만 migration history가 없는 별도 DB에서 collector의 history-absent 분기를 실제 실행하고 `BASELINE_REQUIRED`로 실패하는지 확인한다.
10. 같은 커밋에 묶인 `expected-staging-db-contract.json`과 정제된 fresh/upgrade evidence를 artifact로 보존한다.

이 gate가 통과하기 전에는 production migration을 승인하지 않는다.
